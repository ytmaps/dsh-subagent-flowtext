import { randomUUID } from 'node:crypto'
import type { ContentBlock } from '@deepseek-ai/dsh-llm'
import { SessionId } from '@deepseek-ai/dsh-session'
import type {
  ResolvedSubagentStartRequest,
  SubagentResult,
  SubagentRun,
  SubagentStopReason,
} from '@deepseek-ai/dsh-subagent'
import { FlowTextClient, FlowTextClientError } from './client.js'
import type { FlowTextRunPolicy, FlowTextTaskSnapshot } from './protocol.js'

/** How unattended FlowText approval requests are resolved. */
export type FlowTextApprovalDecision = 'deny' | 'once' | 'session'

/** Fully resolved inputs for one remote FlowText run. */
export interface FlowTextRunSpec {
  readonly client: FlowTextClient
  readonly clientId: string
  readonly modelId?: string
  readonly activePath?: string
  readonly contextPaths: readonly string[]
  readonly policy: FlowTextRunPolicy
  readonly runOptions: Readonly<Record<string, unknown>>
  readonly approvalDecision: FlowTextApprovalDecision
  readonly maxPromptBytes: number
  readonly maxAnswerBytes: number
  readonly onError?: (error: Error) => void
}

const TERMINAL_STATUSES = new Set(['completed', 'failed', 'cancelled', 'timed_out', 'interrupted'])

function utf8Bytes(value: string): number {
  return new TextEncoder().encode(value).byteLength
}

function promptText(blocks: readonly ContentBlock[]): string {
  const texts: string[] = []
  for (const block of blocks) {
    if (block.type !== 'text') throw new Error('subagent-flowtext: only text prompt blocks are supported')
    if (block.text.trim()) texts.push(block.text)
  }
  const result = texts.join('\n\n').trim()
  if (!result) throw new Error('subagent-flowtext: prompt must contain non-empty text')
  return result
}

function safeDiagnostic(error: unknown): string {
  const message = error instanceof FlowTextClientError
    ? `${error.code}: ${error.message}`
    : (error instanceof Error ? error.message : String(error))
  const clean = message.replace(/\s+/g, ' ').trim()
  const bytes = new TextEncoder().encode(clean)
  if (bytes.byteLength <= 4096) return clean
  return new TextDecoder().decode(bytes.slice(0, 4093)) + '...'
}

function reportError(spec: FlowTextRunSpec, error: Error): void {
  try {
    spec.onError?.(error)
  } catch {
    // A diagnostic sink is observational and cannot change run settlement.
  }
}

function taskStopReason(task: FlowTextTaskSnapshot): SubagentStopReason {
  switch (task.status) {
    case 'completed': return 'completed'
    case 'cancelled': return 'aborted'
    case 'failed':
    case 'timed_out':
    case 'interrupted': return 'error'
    default: return 'error'
  }
}

type ResultWithDiagnostic = SubagentResult & { readonly diagnostic?: string }

function failedResult(stopReason: SubagentStopReason, diagnostic: string, output: ContentBlock[] = []): SubagentResult {
  const result: ResultWithDiagnostic = { output, stopReason, diagnostic }
  return result
}

function taskResult(task: FlowTextTaskSnapshot, maxAnswerBytes: number): SubagentResult {
  const reason = taskStopReason(task)
  const answer = String(task.result?.answer ?? '')
  if (utf8Bytes(answer) > maxAnswerBytes) {
    return failedResult('error', 'FLOWTEXT_ANSWER_TOO_LARGE: FlowText answer exceeds maxAnswerBytes')
  }
  const output: ContentBlock[] = answer ? [{ type: 'text', text: answer }] : []
  if (reason === 'completed' && task.result?.success === true) return { output, stopReason: 'completed' }
  const detail = task.error ? `${task.error.code}: ${task.error.message}` : `FlowText task ended with status ${task.status}`
  return failedResult(reason === 'completed' ? 'error' : reason, safeDiagnostic(detail), output)
}

async function waitForTerminal(
  task: FlowTextTaskSnapshot,
  spec: FlowTextRunSpec,
  signal: AbortSignal,
): Promise<FlowTextTaskSnapshot> {
  let snapshot = task
  let after = task.lastSeq
  while (!TERMINAL_STATUSES.has(snapshot.status)) {
    if (snapshot.status === 'waiting_input') {
      throw new Error('FLOWTEXT_INPUT_REQUIRED: the remote task requires user input')
    }
    if (snapshot.status === 'waiting_approval') {
      const approval = snapshot.pendingApproval
      if (approval === undefined) throw new Error('FLOWTEXT_INVALID_APPROVAL: task is waiting without approval details')
      await spec.client.resolveApproval(snapshot.taskId, approval.requestId, spec.approvalDecision, signal)
    }
    const events = await spec.client.waitForEvents(snapshot.taskId, after, signal)
    after = Math.max(after, events.lastSeq)
    snapshot = await spec.client.getTask(snapshot.taskId, signal)
  }
  return snapshot
}

/**
 * Publish one remote FlowText task and own it until terminal settlement.
 * @param request - resolved one-shot Harness delegation.
 * @param spec - client, authority, bounds, and unattended approval policy.
 * @returns a remote SubagentRun whose disposal cancels and awaits the task.
 */
export async function startFlowTextRun(
  request: ResolvedSubagentStartRequest,
  spec: FlowTextRunSpec,
): Promise<SubagentRun> {
  if (request.signal.aborted) throw new Error('subagent-flowtext: request was aborted before task creation')
  const goal = promptText(request.prompt)
  if (utf8Bytes(goal) > spec.maxPromptBytes) throw new Error('subagent-flowtext: prompt exceeds maxPromptBytes')
  const requestId = randomUUID()
  const initial = await spec.client.createTask({
    clientId: spec.clientId,
    requestId,
    goal,
    ...(spec.modelId === undefined ? {} : { modelId: spec.modelId }),
    context: {
      ...(spec.activePath === undefined ? {} : { activePath: spec.activePath }),
      ...(spec.contextPaths.length === 0 ? {} : { paths: spec.contextPaths }),
    },
    policy: spec.policy,
    runOptions: spec.runOptions,
  }, request.signal)

  const controller = new AbortController()
  let cancelPromise: Promise<void> | undefined
  const cancel = (): Promise<void> => {
    controller.abort()
    cancelPromise ??= spec.client.cancelTask(initial.taskId).catch((error: unknown) => {
      reportError(spec, error instanceof Error ? error : new Error(String(error)))
    })
    return cancelPromise
  }
  const onRequestAbort = (): void => { void cancel() }
  request.signal.addEventListener('abort', onRequestAbort, { once: true })
  if (request.signal.aborted) void cancel()

  let settled = false
  const result = waitForTerminal(initial, spec, controller.signal)
    .then(task => taskResult(task, spec.maxAnswerBytes))
    .catch(async (error: unknown): Promise<SubagentResult> => {
      if (controller.signal.aborted || request.signal.aborted) {
        await cancel()
        return failedResult('aborted', 'FlowText task was cancelled')
      }
      const normalized = error instanceof Error ? error : new Error(String(error))
      reportError(spec, normalized)
      await cancel()
      return failedResult('error', safeDiagnostic(normalized))
    })
    .finally(() => {
      settled = true
      request.signal.removeEventListener('abort', onRequestAbort)
    })

  let disposePromise: Promise<void> | undefined
  return {
    id: SessionId(initial.taskId),
    localAgent: undefined,
    result,
    dispose() {
      disposePromise ??= (async () => {
        if (!settled) await cancel()
        await result
      })()
      return disposePromise
    },
  }
}

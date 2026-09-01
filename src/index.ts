/** DeepSeek Harness direct FlowText Agent adapter. */

import type { Context } from '@deepseek-ai/cordis'
import z from '@deepseek-ai/schemastery'
import { FlowTextClient } from './client.js'
import { FileCredentialStore } from './credentials.js'
import {
  FLOWTEXT_DIRECT_MODEL,
  FLOWTEXT_DIRECT_PROVIDER,
  FlowTextDirectAdapter,
} from './direct-adapter.js'
import type { FlowTextRunPolicy } from './protocol.js'
import type { FlowTextProgressMode } from './progress.js'
import type { FlowTextRunSpec } from './run.js'

export const name = 'flowtext-direct'
export const inject = ['llm']

const DEFAULT_BASE_URL = 'http://127.0.0.1:27124/flowtext-agent/v1'

export interface Config {
  baseUrl?: string
  token?: string
  autoPair?: boolean
  credentialPath?: string
  clientName?: string
  clientId?: string
  modelId?: string
  activePath?: string
  contextPaths?: string[]
  policy?: FlowTextRunPolicy
  runOptions?: Record<string, unknown>
  requestTimeoutMs?: number
  longPollMs?: number
  maxResponseBytes?: number
  maxPromptBytes?: number
  maxAnswerBytes?: number
  progressMode?: FlowTextProgressMode
}

const PolicySchema = z.object({
  allowRead: z.boolean(),
  allowWrite: z.boolean(),
  allowWeb: z.boolean(),
  allowCli: z.boolean(),
  allowImageGeneration: z.boolean(),
  allowedPaths: z.array(z.string()),
  deniedPaths: z.array(z.string()),
  maxSteps: z.number(),
  timeoutMs: z.number(),
  maxReadFiles: z.number(),
  maxWriteFiles: z.number(),
  approvalMode: z.union(['never', 'dangerous', 'always'] as const),
})

export const Config: z<Config> = z.object({
  baseUrl: z.string().default(DEFAULT_BASE_URL),
  token: z.string().min(24),
  autoPair: z.boolean().default(true),
  credentialPath: z.string(),
  clientName: z.string().min(1).default('DeepSeek Harness'),
  clientId: z.string().min(1).default('deepseek-harness'),
  modelId: z.string(),
  activePath: z.string(),
  contextPaths: z.array(z.string()).default([]),
  policy: PolicySchema,
  runOptions: z.dict(z.any()).default({}),
  requestTimeoutMs: z.number().default(30_000),
  longPollMs: z.number().default(25_000),
  maxResponseBytes: z.number().default(2 * 1024 * 1024),
  maxPromptBytes: z.number().default(1024 * 1024),
  maxAnswerBytes: z.number().default(1024 * 1024),
  progressMode: z.union(['off', 'summary'] as const).default('summary'),
})

type ResolvedConfig = Required<Omit<Config, 'token' | 'credentialPath' | 'modelId' | 'activePath'>> & {
  token: string | undefined
  credentialPath: string | undefined
  modelId: string | undefined
  activePath: string | undefined
}

function assertPositiveInteger(name: string, value: number, maximum: number): void {
  if (!Number.isSafeInteger(value) || value <= 0 || value > maximum) {
    throw new Error(`dsh-subagent-flowtext: ${name} must be a positive safe integer no greater than ${maximum}`)
  }
}

interface AgentRequestContext {
  on(
    event: 'agent/request',
    listener: (
      payload: { signal: AbortSignal },
      next: () => Promise<import('@deepseek-ai/dsh-llm').LlmCallConfig>,
    ) => Promise<import('@deepseek-ai/dsh-llm').LlmCallConfig>,
  ): () => void
}

/** Register the only execution route: FlowText Agent direct mode. */
export function apply(ctx: Context, config: Config): void {
  const resolved: ResolvedConfig = {
    baseUrl: config.baseUrl ?? DEFAULT_BASE_URL,
    token: config.token,
    autoPair: config.autoPair ?? true,
    credentialPath: config.credentialPath,
    clientName: config.clientName ?? 'DeepSeek Harness',
    clientId: config.clientId ?? 'deepseek-harness',
    modelId: config.modelId,
    activePath: config.activePath,
    contextPaths: config.contextPaths ?? [],
    policy: config.policy ?? {},
    runOptions: config.runOptions ?? {},
    requestTimeoutMs: config.requestTimeoutMs ?? 30_000,
    longPollMs: config.longPollMs ?? 25_000,
    maxResponseBytes: config.maxResponseBytes ?? 2 * 1024 * 1024,
    maxPromptBytes: config.maxPromptBytes ?? 1024 * 1024,
    maxAnswerBytes: config.maxAnswerBytes ?? 1024 * 1024,
    progressMode: config.progressMode ?? 'summary',
  }
  assertPositiveInteger('requestTimeoutMs', resolved.requestTimeoutMs, 10 * 60 * 1000)
  assertPositiveInteger('longPollMs', resolved.longPollMs, 30_000)
  assertPositiveInteger('maxResponseBytes', resolved.maxResponseBytes, 16 * 1024 * 1024)
  assertPositiveInteger('maxPromptBytes', resolved.maxPromptBytes, 16 * 1024 * 1024)
  assertPositiveInteger('maxAnswerBytes', resolved.maxAnswerBytes, 16 * 1024 * 1024)

  const client = new FlowTextClient({
    baseUrl: resolved.baseUrl,
    autoPair: resolved.autoPair,
    clientId: resolved.clientId,
    clientName: resolved.clientName,
    credentialStore: new FileCredentialStore(resolved.credentialPath),
    ...(resolved.token === undefined ? {} : { token: resolved.token }),
    requestTimeoutMs: resolved.requestTimeoutMs,
    longPollMs: resolved.longPollMs,
    maxResponseBytes: resolved.maxResponseBytes,
  })
  const spec: FlowTextRunSpec = {
    client,
    clientId: resolved.clientId,
    ...(resolved.modelId === undefined ? {} : { modelId: resolved.modelId }),
    ...(resolved.activePath === undefined ? {} : { activePath: resolved.activePath }),
    contextPaths: resolved.contextPaths,
    policy: resolved.policy,
    runOptions: resolved.runOptions,
    maxPromptBytes: resolved.maxPromptBytes,
    maxAnswerBytes: resolved.maxAnswerBytes,
    progressMode: resolved.progressMode,
    onError: error => ctx.logger.warn(`flowtext-direct: ${error.message}`),
  }
  ctx.llm.registerAdapter(
    [FLOWTEXT_DIRECT_PROVIDER],
    new FlowTextDirectAdapter(FLOWTEXT_DIRECT_PROVIDER, FLOWTEXT_DIRECT_MODEL, spec),
  )

  const requestContext = ctx as unknown as AgentRequestContext
  requestContext.on('agent/request', async (_payload, next) => {
    const current = await next()
    const { reasoningEffort: _reasoningEffort, ...withoutReasoningEffort } = current
    return {
      ...withoutReasoningEffort,
      provider: FLOWTEXT_DIRECT_PROVIDER,
      model: FLOWTEXT_DIRECT_MODEL,
    }
  })
}

export type { FlowTextRunSpec } from './run.js'
export type { FlowTextProgressMode } from './progress.js'
export type { FlowTextRunPolicy } from './protocol.js'
export type { FlowTextCredentialStore } from './credentials.js'
export { FLOWTEXT_DIRECT_MODEL, FLOWTEXT_DIRECT_PROVIDER, FlowTextDirectAdapter } from './direct-adapter.js'

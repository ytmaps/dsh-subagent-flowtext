/** DeepSeek Harness one-shot SubagentProvider for FlowText Agent Gateway v1. */

import type { Context } from '@deepseek-ai/cordis'
import z from '@deepseek-ai/schemastery'
import type {
  ResolvedSubagentStartRequest,
  SubagentCapabilities,
  SubagentProvider,
} from '@deepseek-ai/dsh-subagent'
import { FlowTextClient } from './client.js'
import type { FlowTextRunPolicy } from './protocol.js'
import { startFlowTextRun, type FlowTextApprovalDecision, type FlowTextRunSpec } from './run.js'

export const name = 'subagent-flowtext'
export const inject = ['subagents']

const DEFAULT_BASE_URL = 'http://127.0.0.1:27124/flowtext-agent/v1'

/** Plugin configuration for one named FlowText provider. */
export interface Config {
  /** Provider name registered on `ctx.subagents`. */
  providerName?: string
  /** FlowText Gateway v1 base URL. Only loopback HTTP URLs are accepted. */
  baseUrl?: string
  /** FlowText Bearer token. Prefer `!!js process.env.FLOWTEXT_AGENT_TOKEN`. */
  token: string
  /** Stable client identity used for task recovery and idempotency. */
  clientId?: string
  /** Optional FlowText model id fixed for this provider instance. */
  modelId?: string
  /** Optional Obsidian vault-relative active note path. */
  activePath?: string
  /** Optional vault-relative paths supplied as task context. */
  contextPaths?: string[]
  /** Authority requested for every task; FlowText server settings remain authoritative. */
  policy?: FlowTextRunPolicy
  /** FlowText run options such as `thinkingEnabled`. */
  runOptions?: Record<string, unknown>
  /** Automatic response to FlowText approval requests. */
  approvalDecision?: FlowTextApprovalDecision
  /** Normal HTTP request timeout. */
  requestTimeoutMs?: number
  /** Gateway event long-poll duration. */
  longPollMs?: number
  /** Maximum accepted Gateway response size. */
  maxResponseBytes?: number
  /** Maximum UTF-8 prompt size sent to FlowText. */
  maxPromptBytes?: number
  /** Maximum UTF-8 final answer size returned to the parent. */
  maxAnswerBytes?: number
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
  providerName: z.string().min(1).default('flowtext'),
  baseUrl: z.string().default(DEFAULT_BASE_URL),
  token: z.string().min(24).required(),
  clientId: z.string().min(1).default('deepseek-harness'),
  modelId: z.string(),
  activePath: z.string(),
  contextPaths: z.array(z.string()).default([]),
  policy: PolicySchema,
  runOptions: z.dict(z.any()).default({}),
  approvalDecision: z.union(['deny', 'once', 'session'] as const).default('deny'),
  requestTimeoutMs: z.number().default(30_000),
  longPollMs: z.number().default(25_000),
  maxResponseBytes: z.number().default(2 * 1024 * 1024),
  maxPromptBytes: z.number().default(1024 * 1024),
  maxAnswerBytes: z.number().default(1024 * 1024),
})

type ResolvedConfig = Required<Omit<Config, 'modelId' | 'activePath'>> & Pick<Config, 'modelId' | 'activePath'>

function assertPositiveInteger(name: string, value: number, maximum: number): void {
  if (!Number.isSafeInteger(value) || value <= 0 || value > maximum) {
    throw new Error(`subagent-flowtext: ${name} must be a positive safe integer no greater than ${maximum}`)
  }
}

class FlowTextProvider implements SubagentProvider {
  readonly capabilities: SubagentCapabilities = {
    outputSchema: false,
    depthLimit: false,
    toolFilter: false,
    persona: false,
  }
  readonly inheritsParentContext = false

  constructor(
    readonly name: string,
    private readonly ctx: Context,
    private readonly config: ResolvedConfig,
    private readonly client: FlowTextClient,
  ) {}

  start(request: ResolvedSubagentStartRequest) {
    const spec: FlowTextRunSpec = {
      client: this.client,
      clientId: this.config.clientId,
      ...(this.config.modelId === undefined ? {} : { modelId: this.config.modelId }),
      ...(this.config.activePath === undefined ? {} : { activePath: this.config.activePath }),
      contextPaths: this.config.contextPaths,
      policy: this.config.policy,
      runOptions: this.config.runOptions,
      approvalDecision: this.config.approvalDecision,
      maxPromptBytes: this.config.maxPromptBytes,
      maxAnswerBytes: this.config.maxAnswerBytes,
      onError: error => this.ctx.logger.warn(`subagent-flowtext "${this.name}": ${error.message}`),
    }
    return startFlowTextRun(request, spec)
  }
}

/**
 * Register one Profile-named FlowText provider.
 * @param ctx - Cordis context carrying the subagent registry.
 * @param config - Gateway endpoint, token, authority, bounds, and provider name.
 */
export function apply(ctx: Context, config: Config): void {
  const resolved: ResolvedConfig = {
    providerName: config.providerName ?? 'flowtext',
    baseUrl: config.baseUrl ?? DEFAULT_BASE_URL,
    token: config.token,
    clientId: config.clientId ?? 'deepseek-harness',
    ...(config.modelId === undefined ? {} : { modelId: config.modelId }),
    ...(config.activePath === undefined ? {} : { activePath: config.activePath }),
    contextPaths: config.contextPaths ?? [],
    policy: config.policy ?? {},
    runOptions: config.runOptions ?? {},
    approvalDecision: config.approvalDecision ?? 'deny',
    requestTimeoutMs: config.requestTimeoutMs ?? 30_000,
    longPollMs: config.longPollMs ?? 25_000,
    maxResponseBytes: config.maxResponseBytes ?? 2 * 1024 * 1024,
    maxPromptBytes: config.maxPromptBytes ?? 1024 * 1024,
    maxAnswerBytes: config.maxAnswerBytes ?? 1024 * 1024,
  }
  assertPositiveInteger('requestTimeoutMs', resolved.requestTimeoutMs, 10 * 60 * 1000)
  assertPositiveInteger('longPollMs', resolved.longPollMs, 30_000)
  assertPositiveInteger('maxResponseBytes', resolved.maxResponseBytes, 16 * 1024 * 1024)
  assertPositiveInteger('maxPromptBytes', resolved.maxPromptBytes, 16 * 1024 * 1024)
  assertPositiveInteger('maxAnswerBytes', resolved.maxAnswerBytes, 16 * 1024 * 1024)
  const client = new FlowTextClient({
    baseUrl: resolved.baseUrl,
    token: resolved.token,
    requestTimeoutMs: resolved.requestTimeoutMs,
    longPollMs: resolved.longPollMs,
    maxResponseBytes: resolved.maxResponseBytes,
  })
  ctx.subagents.registerProvider(new FlowTextProvider(resolved.providerName, ctx, resolved, client))
}

export type { FlowTextApprovalDecision, FlowTextRunSpec } from './run.js'
export type { FlowTextRunPolicy } from './protocol.js'

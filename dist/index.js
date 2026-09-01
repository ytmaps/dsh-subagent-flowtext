/** DeepSeek Harness one-shot SubagentProvider for FlowText Agent Gateway v1. */
import z from '@deepseek-ai/schemastery';
import { FlowTextClient } from './client.js';
import { FileCredentialStore } from './credentials.js';
import { startFlowTextRun } from './run.js';
export const name = 'subagent-flowtext';
export const inject = ['subagents'];
const DEFAULT_BASE_URL = 'http://127.0.0.1:27124/flowtext-agent/v1';
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
    approvalMode: z.union(['never', 'dangerous', 'always']),
});
export const Config = z.object({
    providerName: z.string().min(1).default('flowtext'),
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
    approvalDecision: z.union(['deny', 'once', 'session']).default('deny'),
    requestTimeoutMs: z.number().default(30_000),
    longPollMs: z.number().default(25_000),
    maxResponseBytes: z.number().default(2 * 1024 * 1024),
    maxPromptBytes: z.number().default(1024 * 1024),
    maxAnswerBytes: z.number().default(1024 * 1024),
});
function assertPositiveInteger(name, value, maximum) {
    if (!Number.isSafeInteger(value) || value <= 0 || value > maximum) {
        throw new Error(`subagent-flowtext: ${name} must be a positive safe integer no greater than ${maximum}`);
    }
}
class FlowTextProvider {
    name;
    ctx;
    config;
    client;
    capabilities = {
        outputSchema: false,
        depthLimit: false,
        toolFilter: false,
        persona: false,
    };
    inheritsParentContext = false;
    constructor(name, ctx, config, client) {
        this.name = name;
        this.ctx = ctx;
        this.config = config;
        this.client = client;
    }
    start(request) {
        const spec = {
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
        };
        return startFlowTextRun(request, spec);
    }
}
/**
 * Register one Profile-named FlowText provider.
 * @param ctx - Cordis context carrying the subagent registry.
 * @param config - Gateway endpoint, token, authority, bounds, and provider name.
 */
export function apply(ctx, config) {
    const resolved = {
        providerName: config.providerName ?? 'flowtext',
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
        approvalDecision: config.approvalDecision ?? 'deny',
        requestTimeoutMs: config.requestTimeoutMs ?? 30_000,
        longPollMs: config.longPollMs ?? 25_000,
        maxResponseBytes: config.maxResponseBytes ?? 2 * 1024 * 1024,
        maxPromptBytes: config.maxPromptBytes ?? 1024 * 1024,
        maxAnswerBytes: config.maxAnswerBytes ?? 1024 * 1024,
    };
    assertPositiveInteger('requestTimeoutMs', resolved.requestTimeoutMs, 10 * 60 * 1000);
    assertPositiveInteger('longPollMs', resolved.longPollMs, 30_000);
    assertPositiveInteger('maxResponseBytes', resolved.maxResponseBytes, 16 * 1024 * 1024);
    assertPositiveInteger('maxPromptBytes', resolved.maxPromptBytes, 16 * 1024 * 1024);
    assertPositiveInteger('maxAnswerBytes', resolved.maxAnswerBytes, 16 * 1024 * 1024);
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
    });
    ctx.subagents.registerProvider(new FlowTextProvider(resolved.providerName, ctx, resolved, client));
}
//# sourceMappingURL=index.js.map
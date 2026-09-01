/** DeepSeek Harness one-shot SubagentProvider for FlowText Agent Gateway v1. */
import type { Context } from '@deepseek-ai/cordis';
import z from '@deepseek-ai/schemastery';
import type { FlowTextRunPolicy } from './protocol.js';
import { type FlowTextApprovalDecision } from './run.js';
export declare const name = "subagent-flowtext";
export declare const inject: string[];
/** Plugin configuration for one named FlowText provider. */
export interface Config {
    /** Provider name registered on `ctx.subagents`. */
    providerName?: string;
    /** Force every DSH agent request through FlowText instead of exposing it as an optional tool. */
    directMode?: boolean;
    /** DSH LLM provider route used by direct mode. */
    directProvider?: string;
    /** DSH display model used by direct mode. */
    directModel?: string;
    /** FlowText Gateway v1 base URL. Only loopback HTTP URLs are accepted. */
    baseUrl?: string;
    /** Optional legacy FlowText Bearer token. Omit to use secure local pairing. */
    token?: string;
    /** Pair automatically through a one-time FlowText approval prompt. */
    autoPair?: boolean;
    /** Local mode-0600 credential file override. */
    credentialPath?: string;
    /** Human-readable name shown by FlowText during pairing. */
    clientName?: string;
    /** Stable client identity used for task recovery and idempotency. */
    clientId?: string;
    /** Optional FlowText model id fixed for this provider instance. */
    modelId?: string;
    /** Optional Obsidian vault-relative active note path. */
    activePath?: string;
    /** Optional vault-relative paths supplied as task context. */
    contextPaths?: string[];
    /** Authority requested for every task; FlowText server settings remain authoritative. */
    policy?: FlowTextRunPolicy;
    /** FlowText run options such as `thinkingEnabled`. */
    runOptions?: Record<string, unknown>;
    /** Automatic response to FlowText approval requests. */
    approvalDecision?: FlowTextApprovalDecision;
    /** Normal HTTP request timeout. */
    requestTimeoutMs?: number;
    /** Gateway event long-poll duration. */
    longPollMs?: number;
    /** Maximum accepted Gateway response size. */
    maxResponseBytes?: number;
    /** Maximum UTF-8 prompt size sent to FlowText. */
    maxPromptBytes?: number;
    /** Maximum UTF-8 final answer size returned to the parent. */
    maxAnswerBytes?: number;
}
export declare const Config: z<Config>;
/**
 * Register one Profile-named FlowText provider.
 * @param ctx - Cordis context carrying the subagent registry.
 * @param config - Gateway endpoint, token, authority, bounds, and provider name.
 */
export declare function apply(ctx: Context, config: Config): void;
export type { FlowTextApprovalDecision, FlowTextRunSpec } from './run.js';
export type { FlowTextRunPolicy } from './protocol.js';
export type { FlowTextCredentialStore } from './credentials.js';
export { FLOWTEXT_DIRECT_MODEL, FLOWTEXT_DIRECT_PROVIDER, FlowTextDirectAdapter } from './direct-adapter.js';

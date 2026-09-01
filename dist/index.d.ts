/** DeepSeek Harness direct FlowText Agent adapter. */
import type { Context } from '@deepseek-ai/cordis';
import z from '@deepseek-ai/schemastery';
import type { FlowTextRunPolicy } from './protocol.js';
export declare const name = "flowtext-direct";
export declare const inject: string[];
export interface Config {
    baseUrl?: string;
    token?: string;
    autoPair?: boolean;
    credentialPath?: string;
    clientName?: string;
    clientId?: string;
    modelId?: string;
    activePath?: string;
    contextPaths?: string[];
    policy?: FlowTextRunPolicy;
    runOptions?: Record<string, unknown>;
    requestTimeoutMs?: number;
    longPollMs?: number;
    maxResponseBytes?: number;
    maxPromptBytes?: number;
    maxAnswerBytes?: number;
}
export declare const Config: z<Config>;
/** Register the only execution route: FlowText Agent direct mode. */
export declare function apply(ctx: Context, config: Config): void;
export type { FlowTextRunSpec } from './run.js';
export type { FlowTextRunPolicy } from './protocol.js';
export type { FlowTextCredentialStore } from './credentials.js';
export { FLOWTEXT_DIRECT_MODEL, FLOWTEXT_DIRECT_PROVIDER, FlowTextDirectAdapter } from './direct-adapter.js';

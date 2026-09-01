import { LlmAdapter, type GenerateOptions, type LlmModelInfo, type LlmProviderInfo, type ResolvedRetryPolicy, type StreamChunk } from '@deepseek-ai/dsh-llm';
import { type FlowTextRunSpec } from './run.js';
/** Stable DSH route used when FlowText owns the whole task loop. */
export declare const FLOWTEXT_DIRECT_PROVIDER = "flowtext-direct";
/** Display-only model id for the remote FlowText agent. */
export declare const FLOWTEXT_DIRECT_MODEL = "flowtext-agent";
/**
 * DSH model adapter that delegates one complete user task to FlowText.
 * DSH system prompts, tools, assistant history, and tool results are intentionally not forwarded.
 */
export declare class FlowTextDirectAdapter extends LlmAdapter {
    private readonly provider;
    private readonly model;
    private readonly spec;
    constructor(provider: string, model: string, spec: FlowTextRunSpec);
    providerInfo(provider: string): LlmProviderInfo;
    providerRetryPolicy(_provider: string): ResolvedRetryPolicy;
    listModels(provider: string): Promise<readonly LlmModelInfo[]>;
    stream(options: GenerateOptions): AsyncIterable<StreamChunk>;
}

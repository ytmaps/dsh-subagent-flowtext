import { LlmAdapter, } from '@deepseek-ai/dsh-llm';
import { startFlowTextRun } from './run.js';
/** Stable DSH route used when FlowText owns the whole task loop. */
export const FLOWTEXT_DIRECT_PROVIDER = 'flowtext-direct';
/** Display-only model id for the remote FlowText agent. */
export const FLOWTEXT_DIRECT_MODEL = 'flowtext-agent';
function latestUserTask(options) {
    const message = options.messages.findLast(item => item.role === 'user' && item.source.kind === 'user');
    if (message === undefined)
        throw new Error('flowtext-direct: no user task was found in the DSH request');
    const text = [];
    for (const block of message.content) {
        if (block.type !== 'text') {
            throw new Error('flowtext-direct: the latest user task contains unsupported non-text content');
        }
        if (block.text.trim())
            text.push(block.text);
    }
    const goal = text.join('\n\n').trim();
    if (!goal)
        throw new Error('flowtext-direct: the latest user task is empty');
    return goal;
}
function failure(result) {
    const message = result.diagnostic?.trim() || `FlowText task ended with ${result.stopReason}`;
    return {
        message,
        code: result.stopReason === 'aborted' ? 'ABORTED' : 'FLOWTEXT_DIRECT_FAILED',
    };
}
/**
 * DSH model adapter that delegates one complete user task to FlowText.
 * DSH system prompts, tools, assistant history, and tool results are intentionally not forwarded.
 */
export class FlowTextDirectAdapter extends LlmAdapter {
    provider;
    model;
    spec;
    constructor(provider, model, spec) {
        super();
        this.provider = provider;
        this.model = model;
        this.spec = spec;
    }
    providerInfo(provider) {
        return { id: provider, name: 'FlowText Direct' };
    }
    providerRetryPolicy(_provider) {
        return {
            mode: 'normal',
            maxRetries: 0,
            retryableCodes: [],
            initialDelayMs: 500,
            maxDelayMs: 10_000,
            jitterRatio: 0,
        };
    }
    async listModels(provider) {
        return [{
                provider,
                id: this.model,
                name: 'FlowText Agent',
                description: 'FlowText owns the complete agent loop; DSH receives only the final result.',
                inputModalities: ['text'],
            }];
    }
    async *stream(options) {
        if (options.provider !== this.provider) {
            throw new Error(`flowtext-direct: unexpected provider route ${options.provider}`);
        }
        if (options.model !== this.model) {
            throw new Error(`flowtext-direct: unsupported model ${options.model}`);
        }
        const signal = options.signal ?? new AbortController().signal;
        const request = {
            prompt: [{ type: 'text', text: latestUserTask(options) }],
            signal,
        };
        const run = await startFlowTextRun(request, this.spec, {
            ...(options.sessionId === undefined ? {} : { conversationId: String(options.sessionId) }),
        });
        try {
            const result = await run.result;
            if (result.stopReason !== 'completed') {
                yield {
                    type: 'finish',
                    reason: result.stopReason === 'aborted'
                        ? { kind: 'aborted', failure: failure(result) }
                        : { kind: 'error', failure: failure(result) },
                };
                return;
            }
            const answer = result.output
                .filter((block) => block.type === 'text')
                .map(block => block.text)
                .join('\n\n');
            if (answer) {
                yield { type: 'block-start', index: 0, blockType: 'text' };
                yield { type: 'text-delta', index: 0, text: answer };
                yield { type: 'block-end', index: 0, block: { type: 'text', text: answer } };
            }
            yield { type: 'usage', usage: { inputTokens: 0, outputTokens: 0 } };
            yield { type: 'finish', reason: { kind: 'stop' } };
        }
        finally {
            await run.dispose();
        }
    }
}
//# sourceMappingURL=direct-adapter.js.map
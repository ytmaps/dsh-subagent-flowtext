import type { ResolvedSubagentStartRequest, SubagentRun } from '@deepseek-ai/dsh-subagent';
import { FlowTextClient } from './client.js';
import type { FlowTextRunPolicy } from './protocol.js';
/** How unattended FlowText approval requests are resolved. */
export type FlowTextApprovalDecision = 'deny' | 'once' | 'session';
/** Fully resolved inputs for one remote FlowText run. */
export interface FlowTextRunSpec {
    readonly client: FlowTextClient;
    readonly clientId: string;
    readonly modelId?: string;
    readonly activePath?: string;
    readonly contextPaths: readonly string[];
    readonly policy: FlowTextRunPolicy;
    readonly runOptions: Readonly<Record<string, unknown>>;
    readonly approvalDecision: FlowTextApprovalDecision;
    readonly maxPromptBytes: number;
    readonly maxAnswerBytes: number;
    readonly onError?: (error: Error) => void;
}
/**
 * Publish one remote FlowText task and own it until terminal settlement.
 * @param request - resolved one-shot Harness delegation.
 * @param spec - client, authority, bounds, and unattended approval policy.
 * @returns a remote SubagentRun whose disposal cancels and awaits the task.
 */
export declare function startFlowTextRun(request: ResolvedSubagentStartRequest, spec: FlowTextRunSpec): Promise<SubagentRun>;

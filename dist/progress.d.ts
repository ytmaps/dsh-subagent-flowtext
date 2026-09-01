import type { FlowTextTaskEvent, FlowTextTaskSnapshot } from './protocol.js';
export type FlowTextProgressMode = 'off' | 'summary';
/** Convert an opaque FlowText event into a bounded, non-executable DSH status line. */
export declare function summarizeFlowTextEvent(event: FlowTextTaskEvent): string | undefined;
export declare function summarizeTerminalTask(task: FlowTextTaskSnapshot): string;

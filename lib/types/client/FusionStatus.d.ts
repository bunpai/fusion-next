import type { FusionStatus as StatusView } from '../status.js';
export type FusionTaskView = NonNullable<StatusView['task']>;
/** Task overview: stage, detail, recovery controls, and the pair/model card. */
export declare function FusionTaskOverview({ sessionId, task }: {
    sessionId: string;
    task: FusionTaskView;
}): import("react").JSX.Element;
/** Activity ledger: usage totals, per-role split, context checks, requests, tools. */
export declare function FusionTaskActivity({ task }: {
    task: FusionTaskView;
}): import("react").JSX.Element;
/** Visible-session polling reads the plugin ledger; it never sends a chat message. */
export declare function FusionStatus({ sessionId, attentionOnly }: {
    sessionId: string;
    attentionOnly?: boolean;
}): import("react").JSX.Element | null;

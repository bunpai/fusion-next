import type { ToolCallViewProps } from '@deepseek-ai/dsh-client-ui-tool/client';
export declare const fusionControlTools: readonly ["fusion_dispatch", "fusion_next_read_state", "fusion_next_delegate_text", "fusion_next_explore", "fusion_next_delegate", "fusion_next_rework", "fusion_next_wait", "fusion_next_review_result", "fusion_next_submit_result", "fusion_next_takeover", "fusion_next_finish_direct", "fusion_next_read_evidence"];
/** Keep internal coordination out of the normal conversation. Errors remain visible. */
export declare function FusionTool({ block, sessionId, callId, toolName, cwd, openFile }: ToolCallViewProps): import("react").JSX.Element;

import type { ToolCallViewProps } from '@deepseek-ai/dsh-client-ui-tool/client';
export declare const fusionControlTools: readonly ["fusion_dispatch"];
/** Keep internal coordination out of the normal conversation. Errors remain visible. */
export declare function FusionTool({ block, sessionId, callId, toolName, cwd, openFile }: ToolCallViewProps): import("react").JSX.Element;

import type { ModelDirectoryState } from '@deepseek-ai/dsh-client-ui-model-selection/client';
import type { ObservableSnapshot } from '@deepseek-ai/dsh-client-store';
export interface FusionHintProps {
    sessionId: string;
    directory: ObservableSnapshot<ModelDirectoryState>;
    load(): void;
}
/** Collapsed Fusion attention ledger above the composer; renders nothing while the task needs no attention. */
export declare function FusionDockAttention({ sessionId }: FusionHintProps): import("react").JSX.Element;
/** Additive composer hint. The original selector and its selection state stay native. */
export declare function FusionHint({ sessionId, directory, load }: FusionHintProps): import("react").JSX.Element | null;

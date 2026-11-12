import type { ModelDirectoryState } from '@deepseek-ai/dsh-client-ui-model-selection/client';
import type { ObservableSnapshot } from '@deepseek-ai/dsh-client-store';
export interface FusionPairPickerProps {
    sessionId: string;
    directory: ObservableSnapshot<ModelDirectoryState>;
    load(): void;
}
/**
 * Composer executor picker: the session's normal model menu is the planner;
 * this second dropdown sets the executor for this session (bound like a normal
 * model). Closing the executor returns the session to a plain model session.
 */
export declare function FusionPairPicker({ sessionId, directory, load }: FusionPairPickerProps): import("react").JSX.Element;

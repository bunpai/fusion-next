import type { ModelDirectoryState } from '@deepseek-ai/dsh-client-ui-model-selection/client';
import type { ObservableSnapshot } from '@deepseek-ai/dsh-client-store';
export interface FusionPairPickerProps {
    sessionId: string;
    directory: ObservableSnapshot<ModelDirectoryState>;
    load(): void;
}
/**
 * Composer tool-row executor picker, next to the native model selector: the
 * session's own model is the planner; picking an executor here turns Fusion
 * Next on for this session, choosing Off returns it to a plain session.
 */
export declare function FusionPairPicker({ sessionId, directory, load }: FusionPairPickerProps): import("react").JSX.Element;

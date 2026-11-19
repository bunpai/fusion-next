import type { ReviewTicket, TaskId } from '../contracts.js';
import type { ReviewClassification } from './protocol.js';
import type { FusionStore } from '../task/store.js';
/**
 * Offline producer: persist the captured ticket and outbox row before any adapter send.
 * The model callback may read the latest TaskState only for seq/CAS.
 */
/**
 * @deprecated Accidental export — remnant of the removed v0.2 review-ticket ceremony.
 * Replaced-by: the fusion_dispatch AuditBundle pipeline (src/host/dispatch-v3.ts + src/host/audit-v3.ts).
 * Planned removal: next major version. Migrate by reading audit results off the dispatch bundle
 * or the runtime:<taskId> document instead of this module.
 */
export declare function persistReviewRequest(store: FusionStore, taskId: TaskId, ids: {
    ticketId: string;
    requestId: string;
}, payloadRef: string): Readonly<ReviewTicket>;
export declare function loadReviewOutboxByRequestId(store: FusionStore, taskId: TaskId, requestId: string): {
    row: import("../contracts.js").OutboxRow;
    ticket: Readonly<ReviewTicket>;
};
export declare function appendCapturedReviewResult(store: FusionStore, taskId: TaskId, ticket: Readonly<ReviewTicket>, outcome: {
    requestId: string;
    terminalEvidenceRef: string;
    classification: ReviewClassification;
}): ReturnType<FusionStore['append']>;

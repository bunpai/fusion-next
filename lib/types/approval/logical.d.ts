import type { Digest, LogicalApproval, SnapshotId } from '../contracts.js';
/**
 * @deprecated Accidental export — remnant of the removed v0.2 review-ticket ceremony.
 * Replaced-by: the fusion_dispatch AuditBundle pipeline (src/host/dispatch-v3.ts + src/host/audit-v3.ts).
 * Planned removal: next major version. Migrate by reading audit results off the dispatch bundle
 * or the runtime:<taskId> document instead of this module.
 */
export interface ApprovalScope {
    argsDigest: Digest;
    snapshot: SnapshotId;
    permissionPolicyDigest: Digest;
}
export declare function answerApproval(approval: LogicalApproval, state: 'approved' | 'rejected' | 'withdrawn', decisionBy?: 'human' | 'preauthorized-policy'): LogicalApproval;
export declare function consumeApproval(approval: LogicalApproval, scope: ApprovalScope): LogicalApproval;
export declare function neverMeansDeny(policy: string): boolean;
export declare function pendingDoesNotExpire(_approval: LogicalApproval, _nowMs: number): true;

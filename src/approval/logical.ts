import type { Digest, LogicalApproval, SnapshotId } from '../contracts.js'
import { APPROVAL_SCOPE, FusionError } from '../errors.js'

/**
 * @deprecated Accidental export — remnant of the removed v0.2 review-ticket ceremony.
 * Replaced-by: the fusion_dispatch AuditBundle pipeline (src/host/dispatch-v3.ts + src/host/audit-v3.ts).
 * Planned removal: next major version. Migrate by reading audit results off the dispatch bundle
 * or the runtime:<taskId> document instead of this module.
 */

export interface ApprovalScope {
  argsDigest: Digest
  snapshot: SnapshotId
  permissionPolicyDigest: Digest
}

export function answerApproval(
  approval: LogicalApproval,
  state: 'approved' | 'rejected' | 'withdrawn',
  decisionBy: 'human' | 'preauthorized-policy' = 'human',
): LogicalApproval {
  if (approval.state !== 'pending') {
    throw new FusionError(APPROVAL_SCOPE, `approval ${approval.id} is ${approval.state}`)
  }
  return { ...approval, state, decisionBy }
}

export function consumeApproval(approval: LogicalApproval, scope: ApprovalScope): LogicalApproval {
  if (approval.state === 'consumed') {
    throw new FusionError(APPROVAL_SCOPE, `approval ${approval.id} already consumed`)
  }
  if (approval.state !== 'approved') {
    throw new FusionError(APPROVAL_SCOPE, `approval ${approval.id} is ${approval.state}, not approved`)
  }
  if (
    approval.argsDigest !== scope.argsDigest
    || approval.snapshot !== scope.snapshot
    || approval.permissionPolicyDigest !== scope.permissionPolicyDigest
  ) {
    throw new FusionError(APPROVAL_SCOPE, `approval ${approval.id} scope no longer matches`)
  }
  return { ...approval, state: 'consumed' }
}

export function neverMeansDeny(policy: string): boolean {
  return policy === 'never'
}

export function pendingDoesNotExpire(_approval: LogicalApproval, _nowMs: number): true {
  return true
}

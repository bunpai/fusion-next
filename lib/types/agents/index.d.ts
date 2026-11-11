import { type AgentReportRecord, type AssignmentRecord, type AssignmentRole, type ReportStatus } from '../lifecycle/index.js';
import type { RunManager } from '../run-manager/index.js';
import { type HostCapabilityReport } from '../host-capabilities/index.js';
export type BriefSpec = {
    objective: string;
    constraints: string[];
    contextRefs: string[];
};
export type AssignSpec = {
    assignmentId: string;
    role: AssignmentRole;
    workerAgentId?: string;
    brief: BriefSpec;
    writeScope: string[];
};
export type ReportSpec = {
    reportId: string;
    assignmentId: string;
    generationId: string;
    summary: string;
    status: ReportStatus;
    artifacts: string[];
};
/** E01 agent manager.
 *
 * Owns the task-brief/assignment ledger: a Lead assigns work (DIRECT = executes itself without a
 * worker, DELEGATE = hands a brief to a worker agent), revises briefs monotonically (Lead→worker
 * direction), receives journaled reports (worker→Lead direction) that are FENCED against stale
 * generations (plan D02: a late report can never commit into a new generation), and records
 * Takeover (Q06) when a Lead takes control of a stalled assignment.
 *
 * All state lives in lifecycle events + the SQLite projection; nothing here mutates outside a
 * RunManager transaction. */
export declare class AgentManager {
    private readonly manager;
    private readonly capabilityReport;
    constructor(manager: RunManager, capabilityReport: HostCapabilityReport);
    assign(runId: string, spec: AssignSpec): AssignmentRecord;
    reviseBrief(runId: string, assignmentId: string, briefRevision: number, spec: BriefSpec): void;
    report(runId: string, spec: ReportSpec): AgentReportRecord;
    complete(runId: string, assignmentId: string, reportId: string): void;
    fail(runId: string, assignmentId: string, reportId: string): void;
    takeover(runId: string, assignmentId: string, byAgentId: string, reason: string): void;
    get(assignmentId: string): AssignmentRecord | undefined;
    list(runId: string): AssignmentRecord[];
    private append;
}

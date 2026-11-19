#!/usr/bin/env node
// Fusion dispatch metrics — reads runtime:<taskId> + usage-index:<taskId> docs from a profile sqlite.
// Usage: node benchmark/rebench/fusion-metrics.mjs <state.sqlite path> [taskId-substring-filter]
import { DatabaseSync } from 'node:sqlite'
const db = new DatabaseSync(process.argv[2])
const filter = process.argv[3]
const docs = db.prepare("SELECT id, json FROM documents WHERE id LIKE 'runtime:%' OR id LIKE 'usage-index:%'")
  .all().filter(d => !filter || d.id.includes(filter))
const out = { dispatches: 0, escalations: 0, resendSuspects: 0, stalled: 0, quarantined: 0, totalWallMs: 0, totalWorkerSteps: 0, bundleBytes: [], failureSignatures: {}, usage: {} }
for (const d of docs) {
  const j = JSON.parse(d.json)
  if (d.id.startsWith('runtime:')) {
    for (const r of j.dispatches ?? []) {
      out.dispatches++
      if (r.status === 'failed') out.escalations++
      if (r.status === 'stalled') out.stalled++
      if (r.status === 'quarantined') out.quarantined++
      if (r.resendSuspect) out.resendSuspects++
      out.totalWallMs += r.wallMs ?? 0
      out.totalWorkerSteps += r.workerSteps ?? 0
      if (r.bundleBytes) out.bundleBytes.push(r.bundleBytes)
      if (r.failureSignature) out.failureSignatures[r.failureSignature] = (out.failureSignatures[r.failureSignature] ?? 0) + 1
    }
  } else if (d.id.startsWith('usage-index:')) {
    const k = (j.role ?? 'lead') + '|' + j.provider + '/' + (j.model ?? '?')
    const u = out.usage[k] ??= { calls: 0, freshIn: 0, cacheRead: 0, out: 0 }
    u.calls++
    u.freshIn += j.input?.tokens ?? 0
    u.cacheRead += j.cacheRead?.tokens ?? 0
    u.out += j.output?.tokens ?? 0
  }
}
const avg = a => a.length ? Math.round(a.reduce((x, y) => x + y, 0) / a.length) : 0
console.log(JSON.stringify({
  dispatches: out.dispatches, escalations: out.escalations, resendSuspects: out.resendSuspects,
  stalled: out.stalled, quarantined: out.quarantined,
  totalWallMs: out.totalWallMs, totalWorkerSteps: out.totalWorkerSteps,
  avgBundleBytes: avg(out.bundleBytes), failureSignatures: out.failureSignatures, usage: out.usage,
}, null, 2))

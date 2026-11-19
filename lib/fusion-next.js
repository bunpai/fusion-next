import { createHash, randomUUID } from "node:crypto";
import { homedir } from "node:os";
import { dirname, isAbsolute, join, relative, resolve, sep } from "node:path";
import z from "@deepseek-ai/schemastery";
import { SessionId as SessionId$1 } from "@deepseek-ai/dsh-session";
import { LlmAdapter, LlmError, ReasoningEffortId, createUserMessage, isAgentLoopRequest } from "@deepseek-ai/dsh-llm";
import { existsSync, lstatSync, mkdirSync, readFileSync, readdirSync, readlinkSync, realpathSync, renameSync, rmSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { setImmediate } from "node:timers/promises";
import { DatabaseSync } from "node:sqlite";
import { defineTool } from "@deepseek-ai/dsh-tools";
import { JobId } from "@deepseek-ai/dsh-jobs";
import { execFile, execFileSync } from "node:child_process";
import { readFile } from "node:fs/promises";
//#region src/bilingual.ts
/** Host-side messages reach the UI and the command line as text; they carry both languages. */
const bi = (zh, en) => `${zh} / ${en}`;
//#endregion
//#region src/digest.ts
function sha256Hex(data) {
	return createHash("sha256").update(data).digest("hex");
}
function sortKeys(value) {
	if (Array.isArray(value)) return value.map(sortKeys);
	if (value && typeof value === "object") {
		const record = value;
		return Object.fromEntries(Object.keys(record).filter((key) => !key.startsWith("_")).sort().map((key) => [key, sortKeys(record[key])]));
	}
	return value;
}
function canonicalJson(value) {
	return JSON.stringify(sortKeys(value));
}
function digestOf(value) {
	return sha256Hex(canonicalJson(value));
}
//#endregion
//#region src/errors.ts
var FusionError = class extends Error {
	code;
	constructor(code, message) {
		super(message);
		this.code = code;
		this.name = "FusionError";
	}
};
const FUSION_NEXT_CONTEXT_BUDGET = "FUSION_NEXT_CONTEXT_BUDGET";
const REVISION_CONFLICT = "REVISION_CONFLICT";
const REVISION_STALE = "REVISION_STALE";
const EVENT_CONFLICT = "EVENT_CONFLICT";
const FLUSH_FAILED = "FLUSH_FAILED";
const CHECKSUM_MISMATCH = "CHECKSUM_MISMATCH";
const PROFILE_UNAVAILABLE = "PROFILE_UNAVAILABLE";
const SPEND_UNAUTHORIZED = "SPEND_UNAUTHORIZED";
const APPROVAL_SCOPE = "APPROVAL_SCOPE";
const OUTCOME_UNKNOWN = "OUTCOME_UNKNOWN";
const NEEDS_REPAIR = "NEEDS_REPAIR";
const USAGE_MERGE_CONFLICT = "USAGE_MERGE_CONFLICT";
const USAGE_LEDGER_REQUIRED = "USAGE_LEDGER_REQUIRED";
const CONTROL_BLOCKED = "CONTROL_BLOCKED";
const REVIEW_RESULT_CONFLICT = "REVIEW_RESULT_CONFLICT";
const REVIEW_TICKET_REQUIRED = "REVIEW_TICKET_REQUIRED";
const WORK_ORDER_CONFLICT = "WORK_ORDER_CONFLICT";
const STORE_MIGRATION_REQUIRED = "STORE_MIGRATION_REQUIRED";
//#endregion
//#region src/usage/ledger.ts
const known = (tokens) => ({
	state: "known",
	tokens: safeTokens(tokens)
});
const unknown = () => ({ state: "unknown" });
const na = () => ({ state: "not_applicable" });
function requireThat$2(condition, code, message = code) {
	if (!condition) throw new FusionError(USAGE_MERGE_CONFLICT, message);
}
function safeTokens(n) {
	requireThat$2(Number.isSafeInteger(n) && n >= 0, "INVALID_TOKEN_COUNT");
	return n;
}
function same(a, b) {
	return digestOf(a) === digestOf(b);
}
function freezeDeep(value) {
	if (value && typeof value === "object") {
		for (const child of Object.values(value)) freezeDeep(child);
		Object.freeze(value);
	}
	return value;
}
function newLedger(key) {
	requireThat$2(Object.values(key).every((value) => typeof value === "string" && value.length > 0), "INVALID_REQUEST_KEY");
	return freezeDeep({
		schemaVersion: 2,
		key: structuredClone(key),
		observations: []
	});
}
function validCount(value) {
	requireThat$2(value && [
		"known",
		"unknown",
		"not_applicable"
	].includes(value.state), "INVALID_COUNT");
	if (value.state === "known") safeTokens(value.tokens);
}
function validateBill(bill) {
	validCount(bill.uncachedInput);
	validCount(bill.cacheRead);
	validCount(bill.output);
	validCount(bill.reasoning.tokens);
	requireThat$2([
		"included",
		"separate",
		"unknown",
		"not_applicable"
	].includes(bill.reasoning.kind), "INVALID_REASONING_CONTRACT");
	if (bill.reasoning.kind === "included" && bill.reasoning.tokens.state === "known" && bill.output.state === "known") requireThat$2(bill.reasoning.tokens.tokens <= bill.output.tokens, "REASONING_EXCEEDS_OUTPUT");
	if (bill.reasoning.kind === "not_applicable") requireThat$2(bill.reasoning.tokens.state === "not_applicable", "REASONING_NOT_APPLICABLE_CONFLICT");
	const write = bill.cacheWrite;
	requireThat$2([
		"aggregate",
		"details",
		"unknown",
		"not_applicable"
	].includes(write.kind), "INVALID_CACHE_LAYOUT");
	if (write.kind === "aggregate") {
		validCount(write.tokens);
		requireThat$2(write.rateKey.length > 0, "RATE_KEY_REQUIRED");
	}
	if (write.kind === "details") {
		requireThat$2(Object.keys(write.buckets).length > 0, "EMPTY_CACHE_DETAIL");
		for (const bucket of Object.values(write.buckets)) {
			validCount(bucket.tokens);
			requireThat$2(bucket.rateKey.length > 0, "RATE_KEY_REQUIRED");
		}
	}
}
function addCount(first, second) {
	if (first.state === "unknown" || second.state === "unknown") return unknown();
	if (first.state === "not_applicable") return second;
	if (second.state === "not_applicable") return first;
	return known(first.tokens + second.tokens);
}
function addWrites(first, second) {
	if (first.kind === "unknown" || second.kind === "unknown") return { kind: "unknown" };
	if (first.kind === "not_applicable") return second;
	if (second.kind === "not_applicable") return first;
	requireThat$2(first.kind === second.kind, "CACHE_LAYOUT_MIX_REQUIRES_EXPLICIT_CONVERSION");
	if (first.kind === "aggregate" && second.kind === "aggregate") {
		requireThat$2(first.rateKey === second.rateKey, "CACHE_RATE_CONFLICT");
		return {
			kind: "aggregate",
			rateKey: first.rateKey,
			tokens: addCount(first.tokens, second.tokens)
		};
	}
	requireThat$2(first.kind === "details" && second.kind === "details", "CACHE_LAYOUT_CONFLICT");
	const keys = [.../* @__PURE__ */ new Set([...Object.keys(first.buckets), ...Object.keys(second.buckets)])].sort();
	return {
		kind: "details",
		buckets: Object.fromEntries(keys.map((key) => {
			const left = first.buckets[key];
			const right = second.buckets[key];
			if (!left) return [key, right];
			if (!right) return [key, left];
			requireThat$2(left.rateKey === right.rateKey, "CACHE_RATE_CONFLICT");
			return [key, {
				rateKey: left.rateKey,
				tokens: addCount(left.tokens, right.tokens)
			}];
		}))
	};
}
function addBill(first, second) {
	requireThat$2(first.reasoning.kind === second.reasoning.kind, "DELTA_REASONING_CONTRACT_CONFLICT");
	return {
		uncachedInput: addCount(first.uncachedInput, second.uncachedInput),
		cacheRead: addCount(first.cacheRead, second.cacheRead),
		output: addCount(first.output, second.output),
		cacheWrite: addWrites(first.cacheWrite, second.cacheWrite),
		reasoning: {
			kind: first.reasoning.kind,
			tokens: addCount(first.reasoning.tokens, second.reasoning.tokens)
		}
	};
}
function projectLedger(ledger) {
	const finals = ledger.observations.filter((item) => item.mode === "final");
	if (finals.length) {
		for (const item of finals) requireThat$2(same(item.bill, finals[0].bill), "CONFLICTING_FINAL_BILLS");
		return {
			authority: "final",
			bill: finals[0].bill
		};
	}
	const base = ledger.observations.filter((item) => item.mode === "snapshot").sort((a, b) => a.sequence - b.sequence).at(-1);
	const deltas = ledger.observations.filter((item) => item.mode === "delta" && (!base || item.sequence > base.sequence)).sort((a, b) => a.sequence - b.sequence);
	let bill = base?.bill;
	for (const delta of deltas) bill = bill ? addBill(bill, delta.bill) : delta.bill;
	return {
		authority: bill ? "provisional" : "none",
		bill
	};
}
function ingestObservation(ledger, observation) {
	requireThat$2(ledger.schemaVersion === 2 && same(ledger.key, observation.key), "REQUEST_SCOPE_MISMATCH");
	requireThat$2(observation.id.length > 0 && Number.isSafeInteger(observation.sequence) && observation.sequence >= 0, "INVALID_OBSERVATION_ID_OR_SEQUENCE");
	requireThat$2([
		"snapshot",
		"delta",
		"final"
	].includes(observation.mode), "INVALID_OBSERVATION_MODE");
	validateBill(observation.bill);
	const existing = ledger.observations.find((item) => item.id === observation.id);
	if (existing) {
		requireThat$2(digestOf(existing) === digestOf(observation), "OBSERVATION_ID_CONFLICT");
		return ledger;
	}
	const sameSlot = ledger.observations.find((item) => item.sequence === observation.sequence);
	if (sameSlot) {
		requireThat$2(sameSlot.mode === observation.mode && same(sameSlot.bill, observation.bill), "OBSERVATION_SEQUENCE_CONFLICT");
		requireThat$2(observation.mode !== "delta", "DELTA_REQUIRES_STABLE_EVENT_ID");
	}
	const next = freezeDeep({
		...ledger,
		observations: [...ledger.observations, structuredClone(observation)]
	});
	projectLedger(next);
	return next;
}
function ingestDurable(ledger, observation) {
	return ingestObservation(structuredClone(ledger), structuredClone(observation));
}
function restoreLedger(raw) {
	requireThat$2(raw && typeof raw === "object", "INVALID_LEDGER");
	const value = raw;
	requireThat$2(value.schemaVersion === 2 && value.key && Array.isArray(value.observations), "UNSUPPORTED_LEDGER_FORMAT");
	for (const field of [
		"provider",
		"model",
		"requestId",
		"attemptId",
		"contractDigest"
	]) requireThat$2(typeof value.key[field] === "string" && value.key[field].length, "INVALID_REQUEST_KEY");
	let state = newLedger(structuredClone(value.key));
	for (const item of value.observations ?? []) state = ingestDurable(state, item);
	return state;
}
function splitInput(total, cached, includesCache) {
	if (includesCache === false) return total;
	if (includesCache === null) {
		if (cached.state === "not_applicable" || cached.state === "known" && cached.tokens === 0) return total;
		return unknown();
	}
	if (total.state !== "known" || cached.state !== "known") return unknown();
	requireThat$2(cached.tokens <= total.tokens, "CACHE_EXCEEDS_INPUT");
	return known(total.tokens - cached.tokens);
}
//#endregion
//#region src/host/history.ts
function taskSummary(state, createdAt, updatedAt) {
	return {
		id: state.taskId,
		sessionId: state.parent,
		seq: state.seq,
		createdAt,
		updatedAt,
		title: state.currentWorkOrder?.goal?.slice(0, 160) || "对话任务",
		phase: state.phase,
		verification: state.verification,
		mode: state.control.mode
	};
}
function usageSummary(row) {
	const projection = projectLedger(restoreLedger(row.ledger));
	return {
		id: row.nativeInvocationId,
		taskId: row.taskId,
		role: row.role,
		provider: row.ledger.key.provider,
		model: row.ledger.key.model,
		purpose: row.purpose ?? "conversation",
		startedAt: row.startedAt,
		outcome: row.outcome,
		authority: projection.authority,
		input: projection.bill?.uncachedInput ?? { state: "unknown" },
		output: projection.bill?.output ?? { state: "unknown" },
		cacheRead: projection.bill?.cacheRead ?? { state: "unknown" }
	};
}
/** Once at plugin startup; GET never writes, starts agents, or scans full task/usage snapshots. */
function backfillHistory(store) {
	for (const id of store.listTaskIds()) {
		if (store.readDocument(`task-index:${id}`)) continue;
		const state = store.load(id), events = store.events(id);
		store.writeDocument(`task-index:${id}`, 0, taskSummary(state, events[0].createdAt, events.at(-1).createdAt));
	}
	for (const id of store.listDocumentIds("usage:")) {
		const projectionId = `usage-index:${id.slice(6)}`;
		if (store.readDocument(projectionId)) continue;
		store.writeDocument(projectionId, 0, usageSummary(store.readDocument(id).value));
	}
}
const empty$1 = () => ({
	calls: 0,
	final: 0,
	provisional: 0,
	unreported: 0,
	input: {
		known: 0,
		reported: 0
	},
	output: {
		known: 0,
		reported: 0
	},
	cacheRead: {
		known: 0,
		reported: 0
	}
});
function add(total, row) {
	total.calls++;
	total[row.authority === "none" ? "unreported" : row.authority]++;
	for (const key of [
		"input",
		"output",
		"cacheRead"
	]) {
		const count = row[key];
		if (count.state === "known") {
			total[key].known += count.tokens;
			total[key].reported++;
		}
	}
}
function readScorecard(store, limit = 50) {
	if (!Number.isSafeInteger(limit) || limit < 1 || limit > 200) throw new Error("Scorecard limit must be 1–200");
	const tasks = store.listDocumentIds("task-index:").map((id) => store.readDocument(id).value).sort((a, b) => b.createdAt.localeCompare(a.createdAt) || b.id.localeCompare(a.id)).slice(0, limit);
	const usage = /* @__PURE__ */ new Map();
	for (const id of store.listDocumentIds("usage-index:")) {
		const row = store.readDocument(id).value;
		const u = usage.get(row.taskId) ?? {
			leadIn: 0,
			leadOut: 0,
			workerIn: 0,
			workerOut: 0,
			cacheRead: 0
		};
		const tok = (c) => c?.state === "known" ? c.tokens ?? 0 : 0;
		const role = row.role === "worker" ? "worker" : "lead";
		u[`${role}In`] += tok(row.input);
		u[`${role}Out`] += tok(row.output);
		u.cacheRead += tok(row.cacheRead);
		usage.set(row.taskId, u);
	}
	const cards = tasks.map((task) => {
		const binding = store.readDocument(`binding:${task.sessionId}`)?.value;
		const runtime = store.readDocument(`runtime:${task.id}`)?.value;
		let passed = 0;
		const checkIds = store.listDocumentIds(`check-invocation:${task.id}:`);
		for (const id of checkIds) {
			const inv = store.readDocument(id).value;
			if (inv.evidence?.state === "completed" && inv.evidence.exitCode === 0) passed++;
		}
		const u = usage.get(task.id) ?? {
			leadIn: 0,
			leadOut: 0,
			workerIn: 0,
			workerOut: 0,
			cacheRead: 0
		};
		const route = (r) => r ? {
			provider: r.provider,
			model: r.model
		} : null;
		return {
			taskId: task.id,
			sessionId: task.sessionId,
			title: task.title,
			phase: task.phase,
			verification: task.verification,
			mode: task.mode,
			createdAt: task.createdAt,
			updatedAt: task.updatedAt,
			wallMs: Math.max(0, Date.parse(task.updatedAt) - Date.parse(task.createdAt)),
			lead: route(binding?.profile?.lead),
			worker: route(binding?.profile?.worker),
			...u,
			reworkRounds: runtime?.reworkRounds ?? 0,
			submitted: runtime?.submitted?.status ?? null,
			checks: {
				total: (runtime?.checks ?? []).length || checkIds.length,
				passed
			}
		};
	});
	return {
		observedAt: (/* @__PURE__ */ new Date()).toISOString(),
		totalTasks: store.listDocumentIds("task-index:").length,
		cards
	};
}
function readHistory(store, cursor = "", limit = 20) {
	if (!Number.isSafeInteger(limit) || limit < 1 || limit > 50) throw new Error("History page size must be 1–50");
	const tasks = store.listDocumentIds("task-index:").map((id) => store.readDocument(id).value).sort((a, b) => b.createdAt.localeCompare(a.createdAt) || b.id.localeCompare(a.id));
	const all = store.listDocumentIds("usage-index:").map((id) => store.readDocument(id).value);
	const groups = /* @__PURE__ */ new Map(), byTask = /* @__PURE__ */ new Map(), totals = empty$1();
	for (const row of all) {
		add(totals, row);
		const own = byTask.get(row.taskId) ?? empty$1();
		add(own, row);
		byTask.set(row.taskId, own);
		const key = JSON.stringify([
			row.role,
			row.provider,
			row.model,
			row.purpose
		]);
		const group = groups.get(key) ?? {
			role: row.role,
			provider: row.provider,
			model: row.model,
			purpose: row.purpose,
			...empty$1()
		};
		add(group, row);
		groups.set(key, group);
	}
	const takeovers = {
		total: 0,
		tasks: 0,
		reasons: {}
	}, takeoversByTask = /* @__PURE__ */ new Map();
	for (const id of store.listDocumentIds("lead-takeover:")) {
		const row = store.readDocument(id).value;
		takeovers.total++;
		takeovers.reasons[row.reason] = (takeovers.reasons[row.reason] ?? 0) + 1;
		takeoversByTask.set(row.taskId, (takeoversByTask.get(row.taskId) ?? 0) + 1);
	}
	takeovers.tasks = takeoversByTask.size;
	const start = cursor ? tasks.findIndex((task) => task.id === cursor) + 1 : 0;
	if (cursor && start === 0) throw new Error("History cursor is no longer available");
	const page = tasks.slice(start, start + limit);
	return {
		observedAt: (/* @__PURE__ */ new Date()).toISOString(),
		totalTasks: tasks.length,
		tasks: page.map((task) => ({
			...task,
			usage: byTask.get(task.id) ?? empty$1(),
			takeovers: takeoversByTask.get(task.id) ?? 0
		})),
		nextCursor: start + limit < tasks.length ? page.at(-1).id : null,
		takeovers,
		totals,
		groups: [...groups.values()].sort((a, b) => b.calls - a.calls),
		actualBilledUsd: null,
		savingsPercent: null,
		upstreamHttpCalls: null
	};
}
//#endregion
//#region src/host/native-selection.ts
const FUSION_NEXT_PROVIDER = "fusion-next";
const FUSION_NEXT_MODEL = "auto";
const isFusionSelection = (route) => route?.provider === "fusion-next" && route.model === "auto";
/**
* Virtual local provider: the session and agent model state stay on
* fusion-next/auto (UI identity + journal intent), while every stream is
* dispatched through the configured Lead's physical route. Auxiliary callers
* (session title) take the same route and never block a turn.
*/
var FusionCatalogAdapter = class extends LlmAdapter {
	leadModelInfo;
	dispatch;
	resolveLead;
	constructor(leadModelInfo, dispatch, resolveLead) {
		super();
		this.leadModelInfo = leadModelInfo;
		this.dispatch = dispatch;
		this.resolveLead = resolveLead;
	}
	providerInfo(provider) {
		return {
			id: provider,
			name: "Fusion Next"
		};
	}
	async listModels(provider) {
		return [];
	}
	async resolveModel(provider, model) {
		if (provider !== "fusion-next" || model !== "auto") throw new Error("Unknown local Fusion selection");
		const lead = await this.leadModelInfo?.().catch(() => void 0);
		const leadModalities = lead?.inputModalities ?? [];
		const context = lead?.context ?? { contextWindow: 128e3 };
		return {
			provider,
			id: model,
			name: "Fusion Next · 自动",
			description: "Lead 与 Worker 协作。在设置 → Fusion 中配置模型。",
			inputModalities: [.../* @__PURE__ */ new Set(["text", ...leadModalities])],
			context,
			...lead?.defaultMaxTokens === void 0 ? {} : { defaultMaxTokens: lead.defaultMaxTokens },
			...lead?.reasoning === void 0 ? {} : { reasoning: lead.reasoning }
		};
	}
	async *stream(options) {
		const route = this.resolveLead?.(options);
		if (!route || !this.dispatch) {
			yield {
				type: "finish",
				reason: {
					kind: "error",
					failure: new LlmError("Fusion 尚未就绪。请前往设置 → Fusion Next 配置 Lead 和 Worker。", "FUSION_NEXT_NOT_READY").failure
				}
			};
			return;
		}
		yield* this.dispatch({
			...options,
			provider: route.provider,
			model: route.model,
			reasoningEffort: route.reasoningEffort === void 0 ? void 0 : ReasoningEffortId(route.reasoningEffort)
		}, route);
	}
};
/** Public native lifecycle integration. No model-menu replacement or Host patch. */
function installNativeFusionSelection(ctx, input) {
	const pending = /* @__PURE__ */ new Map();
	const failures = /* @__PURE__ */ new Map();
	const desired = /* @__PURE__ */ new Map();
	const sessionSelection = (agent) => {
		const data = agent.session.snapshotEvents().findLast((event) => event.type === "model/selection")?.data;
		if (data && !isFusionSelection(data)) {
			const echoed = input.appliedRoutes?.read(agent.id);
			if (echoed && data.provider === echoed.provider && data.model === echoed.model) return {
				provider: FUSION_NEXT_PROVIDER,
				model: FUSION_NEXT_MODEL
			};
		}
		return data;
	};
	const selection = (agent) => sessionSelection(agent) ?? desired.get(agent.id) ?? input.selection(agent);
	const selected = (agent) => input.coordinator()?.bindings.read(agent.id)?.binding.selected === true;
	const change = (agent) => {
		if (agent.session.header.parentSession || pending.has(agent.id)) return;
		const coordinator = input.coordinator(), route = selection(agent);
		if (!coordinator) return;
		const fusionRoute = isFusionSelection(route);
		const worker = route !== void 0 && !fusionRoute ? input.workerOf?.(agent.session.id) : void 0;
		if (fusionRoute || route !== void 0 && worker !== void 0) {
			const resolved = fusionRoute ? input.profile() : input.sessionProfile?.(agent.session.id, route, worker) ?? input.profile();
			if (!selected(agent) && resolved) {
				failures.delete(agent.id);
				coordinator.selectBeforeAssembly(agent, resolved);
			}
			if (selected(agent)) {
				if (fusionRoute) {
					const intent = agent.session.snapshotEvents().findLast((event) => event.type === "model/selection");
					if (!isFusionSelection(intent?.data)) agent.session.append("model/selection", {
						provider: FUSION_NEXT_PROVIDER,
						model: FUSION_NEXT_MODEL
					});
				} else input.leadChanged?.(agent.session.id, route);
				if (input.activate) try {
					input.activate(agent.session.id);
				} catch (error) {
					failures.set(agent.id, String(error));
				}
				failures.delete(agent.id);
			}
			return;
		}
		if (!selected(agent)) return;
		if (input.suspend) try {
			input.suspend(agent.session.id);
		} catch (error) {
			failures.set(agent.id, String(error));
		}
		const transition = (async () => {
			if (agent.status !== "idle") await coordinator.pause(agent);
			await coordinator.clear(agent);
			failures.delete(agent.id);
		})().catch((error) => {
			failures.set(agent.id, String(error));
		}).finally(() => {
			pending.delete(agent.id);
		});
		pending.set(agent.id, transition);
	};
	const disposers = [
		ctx.on("session/event", (session, event) => {
			if (event.type !== "model/selection") return;
			desired.set(session.id, event.data);
			const agent = ctx.agents.get(SessionId$1(session.id));
			if (agent && (agent.status === "idle" || !isFusionSelection(event.data))) change(agent);
			else if (agent && !selected(agent)) agent.cancel({
				kind: "hook",
				reason: "Fusion selection takes effect after this turn settles"
			}, { keepInbox: true });
		}),
		ctx.on("agent/status", ({ agent, status }) => {
			if (status !== "running" || agent.session.header.parentSession) return;
			if (pending.has(agent.id) && selected(agent)) {
				agent.cancel({
					kind: "hook",
					reason: "Model switch is draining the previous Fusion task"
				}, { keepInbox: true });
				return;
			}
			try {
				change(agent);
			} catch (error) {
				failures.set(agent.id, String(error));
			}
		}),
		ctx.on("agent/request", async (payload, next) => {
			const config = await next(), agent = payload.agent;
			if (agent.session.header.parentSession) return config;
			const route = selection(agent);
			if (pending.has(agent.id) && selected(agent) || failures.has(agent.id)) throw new Error(failures.get(agent.id) ?? "Fusion 正在完成模型切换，请稍后继续");
			if (isFusionSelection(route)) {
				if (!selected(agent)) throw new Error("请先在设置 → Fusion Next 配置 Lead 和 Worker，再继续此会话。");
			} else if (selected(agent)) {
				if (!input.workerOf?.(agent.session.id)) throw new Error("先停止当前 Fusion 任务，再切换模型。");
			} else if (route !== void 0 && input.workerOf?.(agent.session.id)) {
				const worker = input.workerOf(agent.session.id);
				if (!input.coordinator()) await input.ensureCoordinator?.(agent.session.id, route, worker);
				change(agent);
			}
			return config;
		}, { prepend: true })
	];
	return () => {
		for (const dispose of disposers.reverse()) dispose();
	};
}
//#endregion
//#region src/profile/keepalive.ts
/** No provider-name heuristic can establish cache support for a DSH route. */
function keepaliveChoice(value) {
	if (value === void 0) return void 0;
	if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("Invalid cache keepalive selection");
	const raw = value;
	const valid = (item) => typeof item === "boolean" || item === "auto";
	if (Object.keys(raw).some((key) => key !== "lead" && key !== "worker") || !valid(raw.lead) || !valid(raw.worker)) throw new Error("Cache keepalive requires explicit Lead and Worker choices (true, false or \"auto\")");
	return {
		lead: raw.lead,
		worker: raw.worker
	};
}
//#endregion
//#region src/profile/compactor.ts
/** A separate summary model is never inferred from a provider name or enabled by default. */
function compactorChoice(value) {
	if (value === void 0) return void 0;
	if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error(bi("压缩模型配置无效", "Invalid compaction model setting"));
	const raw = value, route = raw.route;
	if (Object.keys(raw).some((key) => key !== "route" && key !== "maxOutputTokens") || !route || typeof route !== "object" || Array.isArray(route) || Object.keys(route).some((key) => ![
		"provider",
		"model",
		"reasoningEffort"
	].includes(key)) || typeof route.provider !== "string" || !route.provider.trim() || typeof route.model !== "string" || !route.model.trim() || route.reasoningEffort !== void 0 && (typeof route.reasoningEffort !== "string" || !route.reasoningEffort.trim()) || !Number.isSafeInteger(raw.maxOutputTokens) || Number(raw.maxOutputTokens) < 1 || Number(raw.maxOutputTokens) > 128e3) throw new Error(bi("请选择压缩模型，并设置 1–128000 的输出 Token 上限", "Choose a compaction model and an output limit of 1–128000 tokens"));
	return {
		route: {
			provider: route.provider,
			model: route.model,
			...route.reasoningEffort === void 0 ? {} : { reasoningEffort: route.reasoningEffort }
		},
		maxOutputTokens: Number(raw.maxOutputTokens)
	};
}
/** All physical routes in a frozen configuration share the same explicit spending authorization. */
function profileRoutes(profile) {
	return [
		profile.lead,
		profile.worker,
		...profile.compactor ? [profile.compactor.route] : []
	];
}
//#endregion
//#region src/host/settings.ts
/** Saved Lead route from a raw settings or profile document, or undefined when unconfigured or pointed at Fusion itself. */
function savedLeadRoute(value) {
	if (!value || typeof value !== "object" || Array.isArray(value)) return void 0;
	const route = value.lead;
	if (!route || typeof route !== "object" || Array.isArray(route)) return void 0;
	const provider = route.provider, model = route.model;
	if (typeof provider !== "string" || typeof model !== "string" || provider === "fusion-next") return void 0;
	return {
		provider,
		model
	};
}
/** Configuration chooses registered physical models; it cannot create adapters. */
function validatePairChoice(value, catalog) {
	if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error(bi("请选择 Lead 和 Worker", "Choose a Lead and a Sidekick"));
	const raw = value;
	const route = (role, candidate) => {
		const item = candidate;
		if (!item || typeof item.provider !== "string" || typeof item.model !== "string") throw new Error(bi(`请选择 ${role} 模型`, `Choose the ${role} model`));
		if (item.provider === "fusion-next") throw new Error(bi("Fusion 必须选择真实模型", "Fusion needs real models, not Fusion itself"));
		const model = catalog.groups.find((group) => group.id === item.provider)?.models.find((model) => model.id === item.model);
		if (!model) throw new Error(bi(`${role} 模型已不可用，请刷新后重选`, `The ${role} model is no longer available; refresh and choose again`));
		if (item.reasoningEffort !== void 0 && (typeof item.reasoningEffort !== "string" || !model.reasoning?.efforts.some((effort) => effort.id === item.reasoningEffort))) throw new Error(bi(`${role} 不支持所选推理强度`, `${role} does not support the selected reasoning level`));
		return {
			provider: item.provider,
			model: item.model,
			...item.reasoningEffort === void 0 ? {} : { reasoningEffort: item.reasoningEffort }
		};
	};
	const cacheKeepalive = keepaliveChoice(raw.cacheKeepalive);
	const compactor = compactorChoice(raw.compactor);
	let leadConfinement;
	if (raw.leadConfinement !== void 0) {
		if (raw.leadConfinement !== "read-only" && raw.leadConfinement !== "user-mode") throw new Error(bi("规划模型权限必须是 read-only 或 user-mode", "Lead confinement must be read-only or user-mode"));
		leadConfinement = raw.leadConfinement;
	}
	let outputTokens;
	if (raw.outputTokens !== void 0) {
		const value = raw.outputTokens;
		if (!value || typeof value !== "object" || Array.isArray(value) || Object.entries(value).some(([role, tokens]) => !["lead", "worker"].includes(role) || !Number.isSafeInteger(tokens) || Number(tokens) < 1 || Number(tokens) > 128e3)) throw new Error(bi("每次响应上限必须是 1–128000 的整数 Token 数", "The per-response limit must be an integer of 1–128000 tokens"));
		outputTokens = { ...value };
	}
	return {
		lead: route("lead", raw.lead),
		worker: route("worker", raw.worker),
		...outputTokens === void 0 ? {} : { outputTokens },
		...cacheKeepalive === void 0 ? {} : { cacheKeepalive },
		...leadConfinement === void 0 ? {} : { leadConfinement },
		...compactor === void 0 ? {} : { compactor: {
			...compactor,
			route: route("压缩 · Compaction", compactor.route)
		} }
	};
}
function profileFromChoice(pair) {
	const { outputTokens, ...routes } = pair;
	return {
		schemaVersion: 1,
		id: "fusion-auto",
		version: outputTokens?.worker === 128e3 ? "0.1.0-worker-128k" : "0.1.0-faithful",
		enabled: true,
		quality: "experimental",
		...routes,
		workerUpgradePath: [],
		dataPolicyId: "native-host-workspace-policy",
		evidenceCampaignIds: [],
		...outputTokens === void 0 ? {} : { context: Object.fromEntries(Object.entries(outputTokens).map(([role, reserveOutputTokens]) => [role, { reserveOutputTokens }])) }
	};
}
/** Product defaults; explicit legacy/benchmark profiles retain their old contract. */
function modelProfileFromChoice(pair) {
	const { outputTokens: _output, leadConfinement, ...native } = pair;
	return {
		...profileFromChoice(native),
		version: "0.2.0-enforced-v3",
		interactionMode: "model-like",
		workflowPolicy: "enforced-v3",
		...leadConfinement === void 0 || leadConfinement === "read-only" ? {} : { leadConfinement }
	};
}
/** Keep existing default settings stable; expose explicit larger/smaller limits on reload. */
function choiceFromProfile(profile) {
	const outputTokens = Object.fromEntries(["lead", "worker"].filter((role) => profile.context[role].reserveOutputTokens !== 8e3).map((role) => [role, profile.context[role].reserveOutputTokens]));
	return {
		lead: profile.lead,
		worker: profile.worker,
		...profile.interactionMode !== "model-like" && Object.keys(outputTokens).length ? { outputTokens } : {},
		...profile.compactor === void 0 ? {} : { compactor: profile.compactor },
		...profile.leadConfinement === void 0 || profile.leadConfinement === "read-only" ? {} : { leadConfinement: profile.leadConfinement },
		...profile.cacheKeepalive === void 0 ? {} : { cacheKeepalive: profile.cacheKeepalive }
	};
}
//#endregion
//#region src/host/cache-defaults.ts
/**
* Default prompt-cache behaviour for the models most people pair in Fusion, from each provider's official
* documentation. Matching uses the model id (stable across DSH setups), never the route name, except for the
* routes of this project's own OAuth plugins, whose billing we know. Everything here is a default: the user's
* per-model setting always wins, and the runtime can shorten an interval it observes to be too long.
*/
const CACHE_DEFAULTS_CHECKED = "2026-09-27";
const CACHE_FAMILIES = [
	{
		id: "openai",
		label: "OpenAI",
		match: /^(gpt-|o\d|codex|chatgpt)/i,
		discount: "1/10",
		keepalive: "auto",
		intervalSeconds: 285,
		lifetime: {
			zh: "空闲 5–10 分钟，最长 1 小时；部分新模型至少 30 分钟（ChatGPT 订阅通道实测：空闲 10 分钟仍命中，15 分钟已过期）",
			en: "5–10 min idle, up to 1 h; some newer models ≥ 30 min (ChatGPT subscription measured: still cached after 10 idle min, gone at 15)"
		},
		docs: "https://developers.openai.com/api/docs/guides/prompt-caching"
	},
	{
		id: "anthropic",
		label: "Anthropic",
		match: /^claude/i,
		discount: "1/10",
		keepalive: "auto",
		intervalSeconds: 270,
		lifetime: {
			zh: "5 分钟，每次命中重新计时（可选 1 小时）",
			en: "5 min, refreshed on each hit (1 h option)"
		},
		docs: "https://platform.claude.com/docs/en/build-with-claude/prompt-caching"
	},
	{
		id: "google",
		label: "Google",
		match: /^gemini/i,
		discount: "1/10",
		keepalive: "auto",
		intervalSeconds: 285,
		lifetime: {
			zh: "隐式缓存自动，时长未公布",
			en: "implicit, lifetime not published"
		},
		docs: "https://ai.google.dev/gemini-api/docs/caching"
	},
	{
		id: "deepseek",
		label: "DeepSeek",
		match: /^deepseek/i,
		discount: "1/10–1/50",
		keepalive: "off",
		intervalSeconds: 285,
		lifetime: {
			zh: "硬盘缓存，通常保留几小时到几天（等待期间不会过期，无需保活）",
			en: "disk cache, hours to days (no keepalive needed)"
		},
		docs: "https://api-docs.deepseek.com/guides/kv_cache/"
	},
	{
		id: "xai",
		label: "xAI",
		match: /^grok/i,
		discount: "≈1/6",
		keepalive: "auto",
		intervalSeconds: 285,
		lifetime: {
			zh: "自动，时长未公布，内存紧张时可能被清除",
			en: "automatic, lifetime not published, evicted under memory pressure"
		},
		docs: "https://docs.x.ai/developers/advanced-api-usage/prompt-caching"
	},
	{
		id: "zhipu",
		label: "Z.AI / 智谱",
		match: /^glm/i,
		discount: "≈1/5",
		keepalive: "auto",
		intervalSeconds: 285,
		lifetime: {
			zh: "自动，时长未公布",
			en: "automatic, lifetime not published"
		},
		docs: "https://docs.bigmodel.cn/cn/guide/capabilities/cache"
	},
	{
		id: "moonshot",
		label: "Moonshot / Kimi",
		match: /^kimi|^moonshot/i,
		discount: "1/10",
		keepalive: "auto",
		intervalSeconds: 270,
		lifetime: {
			zh: "默认 5 分钟，每次命中重新计时（可选 1 小时）",
			en: "5 min default, refreshed on each hit (1 h tier)"
		},
		docs: "https://platform.moonshot.ai/docs/pricing/chat-k3"
	},
	{
		id: "alibaba",
		label: "Alibaba / Qwen",
		match: /^qwen/i,
		discount: "1/5",
		keepalive: "auto",
		intervalSeconds: 270,
		lifetime: {
			zh: "隐式缓存由系统管理；显式缓存 5 分钟",
			en: "implicit cache system-managed; explicit cache 5 min"
		},
		docs: "https://help.aliyun.com/zh/model-studio/context-cache"
	},
	{
		id: "xiaomi",
		label: "Xiaomi MiMo",
		match: /^mimo/i,
		discount: "≈1/120",
		keepalive: "auto",
		intervalSeconds: 285,
		lifetime: {
			zh: "自动，时长未公布",
			en: "automatic, lifetime not published"
		},
		docs: "https://mimo.mi.com/docs/en-US/price/pay-as-you-go"
	},
	{
		id: "stepfun",
		label: "StepFun",
		match: /^step/i,
		discount: "1/5",
		keepalive: "auto",
		intervalSeconds: 285,
		lifetime: {
			zh: "自动，时长未公布",
			en: "automatic, lifetime not published"
		},
		docs: "https://platform.stepfun.com/docs/guide/prompt_cache"
	},
	{
		id: "meta",
		label: "Meta Muse",
		match: /^muse/i,
		discount: "≈1/8",
		keepalive: "auto",
		intervalSeconds: 285,
		lifetime: {
			zh: "自动；可申请 24 小时保留但不保证",
			en: "automatic; 24 h retention is a hint, not a guarantee"
		},
		docs: "https://dev.meta.ai/docs/pricing-rate-limits"
	},
	{
		id: "minimax",
		label: "MiniMax",
		match: /^minimax/i,
		discount: "1/5",
		keepalive: "auto",
		intervalSeconds: 270,
		lifetime: {
			zh: "5 分钟，每次命中重新计时",
			en: "5 min, refreshed on each hit"
		},
		docs: "https://platform.minimax.io/docs/api-reference/text-prompt-caching"
	}
];
const OWN_ROUTES = [
	{
		match: /^pi-zai-coding/,
		label: "GLM Coding Plan",
		keepalive: "off",
		reason: {
			zh: "按请求次数计额度，保活会占用次数",
			en: "quota counts requests; keepalive pings would use it"
		}
	},
	{
		match: /^pi-kimi-coding/,
		label: "Kimi Code",
		keepalive: "off",
		reason: {
			zh: "订阅按请求次数计额度",
			en: "subscription quota counts requests"
		}
	},
	{
		match: /^pi-github-copilot/,
		label: "GitHub Copilot",
		keepalive: "off",
		reason: {
			zh: "每次请求都算一次高级请求",
			en: "every request counts as a premium request"
		}
	},
	{
		match: /^agy-/,
		label: "Antigravity",
		keepalive: "off",
		reason: {
			zh: "按请求次数限额",
			en: "request-count limits"
		}
	},
	{
		match: /^pi-openai-codex/,
		label: "ChatGPT (Codex)",
		keepalive: "auto",
		intervalSeconds: 480,
		reason: {
			zh: "按用量计，缓存命中能省额度；实测缓存空闲 10 分钟仍在",
			en: "usage-based; cache hits save quota; measured cache still warm after 10 idle min"
		}
	},
	...[
		[/^pi-anthropic/, "Claude"],
		[/^pi-xai/, "xAI"],
		[/^pi-openrouter/, "OpenRouter"]
	].map(([match, label]) => ({
		match,
		label,
		keepalive: "auto",
		reason: {
			zh: "按用量计，缓存命中能省额度",
			en: "usage-based; cache hits save quota"
		}
	}))
];
/** Defaults for one physical route; the model id selects the family, our own routes set the billing mode. */
function cacheDefaults(provider, model) {
	const family = CACHE_FAMILIES.find((item) => item.match.test(model));
	const route = OWN_ROUTES.find((item) => item.match.test(provider));
	if (route) return {
		keepalive: route.keepalive,
		intervalSeconds: route.intervalSeconds ?? family?.intervalSeconds ?? 285,
		source: "route",
		family,
		route
	};
	if (family) return {
		keepalive: family.keepalive,
		intervalSeconds: family.intervalSeconds,
		source: "family",
		family
	};
	return {
		keepalive: "auto",
		intervalSeconds: 285,
		source: "generic"
	};
}
const MIN_INTERVAL = 60;
const MAX_INTERVAL = 3540;
/** A request reused its prefix when most of its input came from the cache. */
const cacheHit = (cacheRead, input) => cacheRead > 0 && cacheRead / (cacheRead + input) >= .5;
const key$1 = (provider, model) => `${provider}\u0001${model}`;
const clampInterval = (seconds) => Math.min(MAX_INTERVAL, Math.max(MIN_INTERVAL, Math.round(seconds)));
var CachePolicy = class {
	store;
	constructor(store) {
		this.store = store;
	}
	setting(provider, model) {
		return this.store.readDocument(`cache-setting:${key$1(provider, model)}`)?.value;
	}
	/** Save or clear (null) the user's choice; invalid values are refused, not coerced. */
	save(provider, model, setting) {
		const id = `cache-setting:${key$1(provider, model)}`, prior = this.store.readDocument(id);
		if (setting === null) {
			if (prior) this.store.writeDocument(id, prior.revision, {});
			return;
		}
		if (setting.mode !== void 0 && ![
			"auto",
			"on",
			"off"
		].includes(setting.mode)) throw new Error("Keepalive mode must be auto, on or off");
		if (setting.intervalSeconds !== void 0 && (!Number.isFinite(setting.intervalSeconds) || setting.intervalSeconds < MIN_INTERVAL || setting.intervalSeconds > MAX_INTERVAL)) throw new Error(`Keepalive interval must be ${MIN_INTERVAL}–${MAX_INTERVAL} seconds`);
		this.store.writeDocument(id, prior?.revision ?? 0, {
			...setting.mode ? { mode: setting.mode } : {},
			...setting.intervalSeconds ? { intervalSeconds: Math.round(setting.intervalSeconds) } : {}
		});
	}
	stats(provider, model) {
		return this.store.readDocument(`cache-stats:${key$1(provider, model)}`)?.value;
	}
	/**
	* Record a request that followed a wait (or any keepalive ping). Pings that keep missing at the current
	* interval shorten it by a quarter: a too-long interval wastes every ping, a too-short one only costs extra
	* cheap reads, so the rule only ever moves toward safety. Lengthening is left to the user (see suggestion).
	*/
	observe(provider, model, sample, currentIntervalSeconds) {
		if (!sample.ping && sample.gapSeconds < 120) return;
		const id = `cache-stats:${key$1(provider, model)}`, prior = this.store.readDocument(id);
		const stats = prior?.value ?? {
			schemaVersion: 1,
			provider,
			model,
			samples: [],
			totals: {
				waits: 0,
				waitHits: 0,
				pings: 0,
				pingHits: 0,
				pingTokens: 0,
				keptWarmTokens: 0,
				resentTokens: 0
			},
			updatedAt: ""
		};
		const row = {
			at: (/* @__PURE__ */ new Date()).toISOString(),
			...sample
		};
		stats.samples = [...stats.samples, row].slice(-60);
		const totals = stats.totals;
		if (row.ping) {
			totals.pings++;
			totals.pingTokens += row.cacheRead + row.input;
			totals.pingOutputTokens = (totals.pingOutputTokens ?? 0) + (row.output ?? 0);
			if (row.hit) totals.pingHits++;
			if (stats.samples.filter((item) => item.ping && Math.abs(item.gapSeconds - currentIntervalSeconds) <= currentIntervalSeconds * .25).slice(-5).filter((item) => !item.hit).length >= 3) {
				stats.learnedIntervalSeconds = clampInterval(currentIntervalSeconds * .75);
				stats.learnedRule = 2;
				stats.samples = stats.samples.filter((item) => !item.ping);
			}
		} else {
			totals.waits++;
			if (row.hit) {
				totals.waitHits++;
				totals.keptWarmTokens += row.cacheRead;
			} else totals.resentTokens += row.input;
		}
		stats.updatedAt = row.at;
		this.store.writeDocument(id, prior?.revision ?? 0, stats);
	}
	/**
	* User setting > pair profile (older explicit choice) > learned interval > our own route's billing default >
	* model family default > generic. The Worker defaults to off: it rarely waits long enough to need pings.
	*/
	resolve(provider, model, role, pairChoice) {
		const defaults = cacheDefaults(provider, model);
		const user = this.setting(provider, model) ?? {};
		const stats = this.stats(provider, model);
		const learned = stats?.learnedRule === 2 ? stats.learnedIntervalSeconds : void 0;
		let mode, modeSource;
		if (user.mode) {
			mode = user.mode;
			modeSource = "user";
		} else if (typeof pairChoice === "boolean") {
			mode = pairChoice ? "on" : "off";
			modeSource = "pair";
		} else if (role === "worker") {
			mode = "off";
			modeSource = "role";
		} else {
			mode = defaults.keepalive;
			modeSource = defaults.source;
		}
		const intervalSeconds = user.intervalSeconds ?? learned ?? defaults.intervalSeconds;
		const intervalSource = user.intervalSeconds ? "user" : learned ? "learned" : defaults.source;
		return {
			mode,
			intervalSeconds,
			modeSource,
			intervalSource,
			defaults
		};
	}
	/** Suggest a longer interval only on repeated evidence: real waits that still hit well beyond the interval. */
	suggestion(provider, model, intervalSeconds) {
		const long = (this.stats(provider, model)?.samples ?? []).filter((item) => !item.ping && item.hit && item.gapSeconds >= intervalSeconds * 1.5);
		if (long.length < 3) return void 0;
		return clampInterval(Math.floor(Math.min(...long.map((item) => item.gapSeconds)) / 30) * 30);
	}
	/** Every route the plugin has evidence or a setting for, plus the given routes (the configured pair). */
	routes(extra = []) {
		const ids = [...this.store.listDocumentIds("cache-stats:"), ...this.store.listDocumentIds("cache-setting:")].map((id) => id.slice(id.indexOf(":") + 1).split(""));
		const all = [...extra.map((item) => [item.provider, item.model]), ...ids];
		const seen = /* @__PURE__ */ new Set();
		return all.filter(([provider, model]) => provider && model && !seen.has(key$1(provider, model)) && seen.add(key$1(provider, model))).map(([provider, model]) => ({
			provider,
			model
		}));
	}
};
/** One row of the settings page: what applies, why, what the defaults say, and what was observed. */
function cacheView(policy, pair, pairChoice) {
	const same = (a, provider, model) => a?.provider === provider && a.model === model;
	return policy.routes(pair ? [pair.lead, pair.worker] : []).map(({ provider, model }) => {
		const role = same(pair?.lead, provider, model) ? "lead" : same(pair?.worker, provider, model) ? "worker" : void 0;
		const effective = policy.resolve(provider, model, role ?? "lead", role ? pairChoice?.[role] : void 0);
		const stats = policy.stats(provider, model), { family, route } = effective.defaults;
		return {
			provider,
			model,
			role,
			mode: effective.mode,
			intervalSeconds: effective.intervalSeconds,
			modeSource: effective.modeSource,
			intervalSource: effective.intervalSource,
			setting: policy.setting(provider, model) ?? {},
			defaults: {
				mode: effective.defaults.keepalive,
				intervalSeconds: effective.defaults.intervalSeconds,
				source: effective.defaults.source,
				...family ? { family: {
					label: family.label,
					lifetime: family.lifetime,
					discount: family.discount,
					docs: family.docs
				} } : {},
				...route ? { route: {
					label: route.label,
					reason: route.reason
				} } : {}
			},
			totals: stats?.totals ?? null,
			learnedIntervalSeconds: stats?.learnedRule === 2 ? stats.learnedIntervalSeconds ?? null : null,
			suggestion: policy.suggestion(provider, model, effective.intervalSeconds) ?? null,
			recent: (stats?.samples ?? []).slice(-8).map((item) => ({
				gapSeconds: Math.round(item.gapSeconds),
				ping: item.ping,
				hit: item.hit
			}))
		};
	});
}
//#endregion
//#region src/profile/resolve.ts
const PLACEHOLDERS = /* @__PURE__ */ new Set([
	"__AUTHORIZED_PROVIDER__",
	"__EXACT_MODEL_ID__",
	"__EXACT_WORKER_ID__",
	"__EXISTING_PROJECT_POLICY__"
]);
function isPlaceholder(route) {
	return PLACEHOLDERS.has(route.provider) || PLACEHOLDERS.has(route.model);
}
function asPolicy(raw, fallback) {
	const policy = {
		targetInputTokens: raw?.targetInputTokens ?? fallback.targetInputTokens,
		reserveOutputTokens: raw?.reserveOutputTokens ?? fallback.reserveOutputTokens,
		minSafetyTokens: raw?.minSafetyTokens ?? fallback.minSafetyTokens,
		safetyFraction: raw?.safetyFraction ?? fallback.safetyFraction,
		compactToFraction: raw?.compactToFraction ?? fallback.compactToFraction,
		evidenceReadTokens: raw?.evidenceReadTokens ?? fallback.evidenceReadTokens,
		maxToolVisibleTokens: raw?.maxToolVisibleTokens ?? fallback.maxToolVisibleTokens
	};
	for (const key of [
		"targetInputTokens",
		"reserveOutputTokens",
		"evidenceReadTokens",
		"maxToolVisibleTokens"
	]) if (!Number.isSafeInteger(policy[key]) || policy[key] <= 0) throw new FusionError(PROFILE_UNAVAILABLE, `Invalid context policy: ${key}`);
	if (!Number.isSafeInteger(policy.minSafetyTokens) || policy.minSafetyTokens < 0 || !Number.isFinite(policy.safetyFraction) || policy.safetyFraction < 0 || policy.safetyFraction >= 1 || !Number.isFinite(policy.compactToFraction) || policy.compactToFraction <= 0 || policy.compactToFraction >= 1) throw new FusionError(PROFILE_UNAVAILABLE, "Invalid context safety or compaction policy");
	return policy;
}
const LEAD_DEFAULT = {
	targetInputTokens: Number.MAX_SAFE_INTEGER,
	reserveOutputTokens: 8e3,
	minSafetyTokens: 2048,
	safetyFraction: .05,
	compactToFraction: .5,
	evidenceReadTokens: 4e3,
	maxToolVisibleTokens: 6e3
};
const WORKER_DEFAULT = {
	...LEAD_DEFAULT,
	compactToFraction: .55,
	evidenceReadTokens: 8e3,
	maxToolVisibleTokens: 8e3
};
function promptDigests(prompts) {
	return {
		lead: sha256Hex(prompts.lead),
		worker: sha256Hex(prompts.worker),
		compact: sha256Hex(prompts.compact)
	};
}
function completeProfile(raw, prompts) {
	const lead = raw.lead;
	const worker = raw.worker;
	const context = raw.context ?? {};
	const promptHash = promptDigests(prompts);
	const cacheKeepalive = keepaliveChoice(raw.cacheKeepalive);
	const compactor = compactorChoice(raw.compactor);
	if (raw.interactionMode !== void 0 && raw.interactionMode !== "model-like") throw new Error("Unknown Fusion interaction mode");
	if (raw.workflowPolicy !== void 0 && (![
		"enforced-v1",
		"enforced-v2",
		"enforced-v3"
	].includes(String(raw.workflowPolicy)) || raw.interactionMode !== "model-like")) throw new Error("Unknown Fusion workflow policy");
	if (raw.leadConfinement !== void 0 && raw.leadConfinement !== "read-only" && raw.leadConfinement !== "user-mode") throw new Error("Unknown Fusion lead confinement");
	const profile = {
		schemaVersion: 1,
		id: String(raw.id),
		version: String(raw.version),
		digest: "",
		enabled: raw.enabled === true,
		quality: raw.quality ?? "experimental",
		...raw.interactionMode === "model-like" ? { interactionMode: "model-like" } : {},
		...raw.workflowPolicy === "enforced-v1" || raw.workflowPolicy === "enforced-v2" || raw.workflowPolicy === "enforced-v3" ? { workflowPolicy: raw.workflowPolicy } : {},
		...raw.leadConfinement === "user-mode" ? { leadConfinement: "user-mode" } : {},
		lead,
		worker,
		workerUpgradePath: raw.workerUpgradePath ?? [],
		promptDigests: promptHash,
		context: {
			lead: asPolicy(context.lead, LEAD_DEFAULT),
			worker: asPolicy(context.worker, WORKER_DEFAULT)
		},
		dataPolicyId: String(raw.dataPolicyId ?? ""),
		evidenceCampaignIds: raw.evidenceCampaignIds ?? [],
		...cacheKeepalive === void 0 ? {} : { cacheKeepalive },
		...compactor === void 0 ? {} : { compactor }
	};
	return {
		...profile,
		digest: digestOf(profile)
	};
}
function resolveProfile(raw, prompts, catalog) {
	const profile = completeProfile(raw, prompts);
	if (!profile.enabled) throw new FusionError(PROFILE_UNAVAILABLE, `profile ${profile.id} is disabled`);
	if (profileRoutes(profile).some(isPlaceholder) || PLACEHOLDERS.has(profile.dataPolicyId)) throw new FusionError(PROFILE_UNAVAILABLE, `profile ${profile.id} still has placeholder routes`);
	const authorized = (route) => catalog.authorizedRoutes.some((item) => item.provider === route.provider && item.model === route.model);
	if (!profileRoutes(profile).every(authorized)) throw new FusionError(PROFILE_UNAVAILABLE, `profile ${profile.id} routes are not authorized on this Host`);
	return {
		profile,
		prompts
	};
}
function loadJsonObject(path) {
	return JSON.parse(readFileSync(path, "utf8"));
}
//#endregion
//#region src/prompts.ts
const here = dirname(fileURLToPath(import.meta.url));
function defaultPromptDir() {
	return join(here, "..", "prompts");
}
function loadPromptBundle(dir = defaultPromptDir()) {
	return {
		lead: readFileSync(join(dir, "lead.md"), "utf8"),
		worker: readFileSync(join(dir, "worker.md"), "utf8"),
		compact: readFileSync(join(dir, "compact.md"), "utf8")
	};
}
function loadModelPromptBundle(dir = defaultPromptDir()) {
	return {
		lead: readFileSync(join(dir, "model-lead.md"), "utf8"),
		worker: readFileSync(join(dir, "model-worker.md"), "utf8"),
		compact: readFileSync(join(dir, "compact.md"), "utf8")
	};
}
function promptManifest(dir = defaultPromptDir()) {
	const prompts = loadPromptBundle(dir);
	return {
		prompts,
		digests: promptDigests(prompts)
	};
}
//#endregion
//#region src/task/status-index.ts
const metrics = [
	"calls",
	"finalCalls",
	"provisionalCalls",
	"unreportedCalls",
	"compactionCalls",
	"keepaliveCalls",
	"inputTokens",
	"inputReported",
	"cacheReadTokens",
	"cacheReadReported",
	"outputTokens",
	"outputReported",
	"unsettled",
	"checking",
	"workerConversations"
];
const empty = () => Object.fromEntries(metrics.map((key) => [key, 0]));
const kinds = [
	"usage",
	"native-effect",
	"context-request",
	"check-invocation"
];
const relevant = (id) => kinds.some((kind) => id.startsWith(`${kind}:`));
const condition = (ref) => kinds.map((kind) => `${ref}.id GLOB '${kind}:*'`).join(" OR ");
var StatusDataError = class extends Error {};
var StatusPending = class extends Error {
	task;
	constructor(task) {
		super("Status projection needs backfill");
		this.task = task;
	}
};
/** Rebuildable read model. Triggers also track writes/deletes by older plugin processes. */
var StatusIndex = class {
	db;
	#statements = /* @__PURE__ */ new Map();
	constructor(db) {
		this.db = db;
		db.exec("BEGIN IMMEDIATE");
		try {
			const tablesExist = db.prepare("SELECT count(*) AS n FROM sqlite_master WHERE type='table' AND name IN ('fusion_status_dirty_v1','fusion_status_facts_v1','fusion_status_totals_v1')").get()?.n === 3;
			const triggersExist = db.prepare("SELECT count(*) AS n FROM sqlite_master WHERE type='trigger' AND name IN ('fusion_status_insert_v1','fusion_status_update_v1','fusion_status_delete_v1')").get()?.n === 3;
			const exists = tablesExist && triggersExist;
			if (!exists) db.exec("DROP TABLE IF EXISTS fusion_status_dirty_v1; DROP TABLE IF EXISTS fusion_status_facts_v1; DROP TABLE IF EXISTS fusion_status_totals_v1;");
			db.exec(`
        CREATE TABLE IF NOT EXISTS fusion_status_dirty_v1 (id TEXT PRIMARY KEY);
        CREATE TABLE IF NOT EXISTS fusion_status_facts_v1 (
          id TEXT PRIMARY KEY, task TEXT NOT NULL, kind TEXT NOT NULL, role TEXT NOT NULL,
          stamp TEXT NOT NULL, session TEXT NOT NULL, active INTEGER NOT NULL, error TEXT,
          preview TEXT NOT NULL, ${metrics.map((key) => `${key} INTEGER NOT NULL`).join(",")});
        CREATE INDEX IF NOT EXISTS fusion_status_recent_v1 ON fusion_status_facts_v1(task,kind,stamp DESC,id);
        CREATE INDEX IF NOT EXISTS fusion_status_context_v1 ON fusion_status_facts_v1(task,role,stamp DESC,id) WHERE kind='context-request';
        CREATE INDEX IF NOT EXISTS fusion_status_active_v1 ON fusion_status_facts_v1(task,session) WHERE active=1;
        CREATE INDEX IF NOT EXISTS fusion_status_errors_v1 ON fusion_status_facts_v1(id) WHERE error IS NOT NULL;
        CREATE TABLE IF NOT EXISTS fusion_status_totals_v1 (
          task TEXT NOT NULL, role TEXT NOT NULL, ${metrics.map((key) => `${key} INTEGER NOT NULL`).join(",")}, PRIMARY KEY(task,role));
        CREATE TRIGGER IF NOT EXISTS fusion_status_insert_v1 AFTER INSERT ON documents WHEN ${condition("NEW")}
          BEGIN INSERT INTO fusion_status_dirty_v1 VALUES (NEW.id) ON CONFLICT(id) DO NOTHING; END;
        CREATE TRIGGER IF NOT EXISTS fusion_status_update_v1 AFTER UPDATE ON documents WHEN ${condition("NEW")} OR ${condition("OLD")}
          BEGIN INSERT INTO fusion_status_dirty_v1 VALUES (OLD.id) ON CONFLICT(id) DO NOTHING; INSERT INTO fusion_status_dirty_v1 VALUES (NEW.id) ON CONFLICT(id) DO NOTHING; END;
        CREATE TRIGGER IF NOT EXISTS fusion_status_delete_v1 AFTER DELETE ON documents WHEN ${condition("OLD")}
          BEGIN INSERT INTO fusion_status_dirty_v1 VALUES (OLD.id) ON CONFLICT(id) DO NOTHING; END;
      `);
			if (!exists) db.exec(`INSERT OR IGNORE INTO fusion_status_dirty_v1 SELECT id FROM documents WHERE ${condition("documents")}`);
			db.exec("COMMIT");
		} catch (error) {
			db.exec("ROLLBACK");
			throw error;
		}
	}
	#sql(sql) {
		let statement = this.#statements.get(sql);
		if (!statement) {
			statement = this.db.prepare(sql);
			this.#statements.set(sql, statement);
		}
		return statement;
	}
	/** Call inside the document transaction, after the source row is written. */
	sync(id) {
		if (!relevant(id)) {
			this.#sql("DELETE FROM fusion_status_dirty_v1 WHERE id=?").run(id);
			return;
		}
		const prior = this.#sql("SELECT * FROM fusion_status_facts_v1 WHERE id=?").get(id);
		if (prior) this.#add(String(prior.task), String(prior.role), prior, -1);
		this.#sql("DELETE FROM fusion_status_facts_v1 WHERE id=?").run(id);
		const source = this.#sql("SELECT json,checksum FROM documents WHERE id=?").get(id);
		if (source) {
			let task = "", role = "other", stamp = "", session = "", active = 0, error = null, preview = {};
			const kind = id.slice(0, id.indexOf(":")), counts = empty();
			try {
				if (typeof source.json !== "string" || sha256Hex(Buffer.from(source.json)) !== source.checksum) throw new Error("corrupt Host document");
				const row = JSON.parse(source.json);
				task = kind === "check-invocation" ? row.evidence?.taskId : row.taskId;
				if (typeof task !== "string" || !id.startsWith(`${kind}:${task}:`) || kind !== "check-invocation" && row.schemaVersion !== 1) throw new Error("Fusion 状态记录需要检查");
				role = row.role === "lead" || row.role === "worker" ? row.role : "other";
				if (kind === "usage") {
					const value = row, projection = projectLedger(restoreLedger(value.ledger));
					counts.calls = 1;
					counts.workerConversations = Number(value.role === "worker" && (value.purpose === void 0 || value.purpose === "conversation"));
					counts[projection.authority === "final" ? "finalCalls" : projection.authority === "provisional" ? "provisionalCalls" : "unreportedCalls"] = 1;
					counts.compactionCalls = Number(value.purpose === "compaction");
					counts.keepaliveCalls = Number(value.purpose === "cache-keepalive");
					for (const [field, count] of [
						["input", projection.bill?.uncachedInput],
						["cacheRead", projection.bill?.cacheRead],
						["output", projection.bill?.output]
					]) if (count?.state === "known") {
						counts[`${field}Tokens`] = count.tokens;
						counts[`${field}Reported`] = 1;
					}
					stamp = value.startedAt;
					session = value.sessionId;
					active = Number(value.purpose === "conversation" && value.endedAt === null);
					if (!active) session = "";
					preview = {
						role: value.role,
						purpose: value.purpose,
						provider: value.ledger.key.provider,
						model: value.ledger.key.model,
						outcome: value.outcome,
						authority: projection.authority
					};
				} else if (kind === "native-effect") {
					stamp = row.startedAt;
					counts.unsettled = Number(row.state === "dispatch-started" || row.state === "outcome-unknown");
					preview = {
						role: row.role,
						name: row.toolName,
						state: row.state,
						failed: row.nativeIsError === true
					};
				} else if (kind === "context-request") {
					stamp = row.checkedAt;
					preview = {
						role: row.role,
						purpose: row.purpose,
						inputTokens: row.measurement.inputTokens,
						budget: row.budget,
						quality: row.measurement.quality,
						admitted: row.admitted,
						checkedAt: row.checkedAt
					};
				} else counts.checking = Number(row.evidence.state === "started");
				if (typeof stamp !== "string" || typeof session !== "string") throw new Error("Fusion 状态记录需要检查");
			} catch (failure) {
				error = failure instanceof Error ? failure.message : String(failure);
				task = "";
				role = "other";
				stamp = "";
				session = "";
				active = 0;
				preview = {};
				Object.assign(counts, empty());
			}
			this.#sql(`INSERT INTO fusion_status_facts_v1 VALUES (${Array(9 + metrics.length).fill("?").join(",")})`).run(id, task, kind, role, stamp, session, active, error, JSON.stringify(preview), ...metrics.map((key) => counts[key]));
			this.#add(task, role, counts, 1);
		}
		this.#sql("DELETE FROM fusion_status_dirty_v1 WHERE id=?").run(id);
	}
	#add(task, role, value, sign) {
		this.#sql(`INSERT INTO fusion_status_totals_v1 VALUES (${Array(2 + metrics.length).fill("?").join(",")})
      ON CONFLICT(task,role) DO UPDATE SET ${metrics.map((key) => `${key}=${key}+excluded.${key}`).join(",")}`).run(task, role, ...metrics.map((key) => sign * Number(value[key])));
	}
	/** Each batch is its own transaction, so a legacy backfill does not monopolize the writer lock. */
	flushBatch(task) {
		let changed = false;
		for (const kind of kinds) {
			const batch = this.#sql("SELECT id FROM fusion_status_dirty_v1 WHERE id>=? AND id<? ORDER BY id LIMIT 256").all(`${kind}:${task}:`, `${kind}:${task};`);
			for (const row of batch) {
				this.sync(String(row.id));
				changed = true;
			}
		}
		return changed;
	}
	#ready(task) {
		for (const kind of kinds) if (this.#sql("SELECT id FROM fusion_status_dirty_v1 WHERE id>=? AND id<? LIMIT 1").get(`${kind}:${task}:`, `${kind}:${task};`)) throw new StatusPending(task);
	}
	/** Bounded memory even for a legacy database; the surrounding transaction is atomic. */
	flush(task) {
		const ranges = task === void 0 ? [void 0] : kinds.map((kind) => [`${kind}:${task}:`, `${kind}:${task};`]);
		for (const range of ranges) for (;;) {
			const batch = range ? this.#sql("SELECT id FROM fusion_status_dirty_v1 WHERE id>=? AND id<? ORDER BY id LIMIT 256").all(...range) : this.#sql("SELECT id FROM fusion_status_dirty_v1 ORDER BY id LIMIT 256").all();
			if (!batch.length) break;
			for (const row of batch) this.sync(String(row.id));
		}
	}
	rebuild() {
		this.db.exec(`DELETE FROM fusion_status_facts_v1; DELETE FROM fusion_status_totals_v1;
      INSERT OR IGNORE INTO fusion_status_dirty_v1 SELECT id FROM documents WHERE ${condition("documents")}`);
		this.flush();
	}
	#validate(task) {
		for (const kind of kinds) {
			const prefix = `${kind}:${task}:`;
			const error = this.#sql("SELECT error FROM fusion_status_facts_v1 WHERE error IS NOT NULL AND id>=? AND id<? LIMIT 1").get(prefix, `${kind}:${task};`);
			if (error) throw new StatusDataError(String(error.error));
		}
	}
	read(task) {
		this.#ready(task);
		this.#validate(task);
		const total = empty(), roles = {
			lead: empty(),
			worker: empty()
		};
		for (const row of this.#sql("SELECT * FROM fusion_status_totals_v1 WHERE task=?").all(task)) {
			for (const key of metrics) total[key] += Number(row[key]);
			if (row.role === "lead" || row.role === "worker") roles[row.role] = row;
		}
		const own = (value) => ({
			calls: value.calls,
			input: {
				knownTokens: value.inputTokens,
				reportedRequests: value.inputReported,
				totalRequests: value.calls
			},
			cacheRead: {
				knownTokens: value.cacheReadTokens,
				reportedRequests: value.cacheReadReported,
				totalRequests: value.calls
			},
			output: {
				knownTokens: value.outputTokens,
				reportedRequests: value.outputReported,
				totalRequests: value.calls
			}
		});
		const recent = (kind, limit) => this.#sql("SELECT id,stamp,preview FROM fusion_status_facts_v1 WHERE task=? AND kind=? ORDER BY stamp DESC,id LIMIT ?").all(task, kind, limit).map((row) => ({
			...JSON.parse(String(row.preview)),
			id: String(row.id),
			startedAt: String(row.stamp)
		}));
		return {
			usage: {
				...own(total),
				finalCalls: total.finalCalls,
				provisionalCalls: total.provisionalCalls,
				unreportedCalls: total.unreportedCalls,
				compactionCalls: total.compactionCalls,
				keepaliveCalls: total.keepaliveCalls,
				actualBilledUsd: null,
				upstreamHttpCalls: null,
				byRole: {
					lead: own(roles.lead),
					worker: own(roles.worker)
				}
			},
			requests: recent("usage", 12),
			tools: recent("native-effect", 8),
			contexts: ["lead", "worker"].flatMap((role) => {
				const row = this.#sql("SELECT preview FROM fusion_status_facts_v1 WHERE task=? AND kind='context-request' AND role=? ORDER BY stamp DESC,id LIMIT 1").get(task, role);
				return row ? [JSON.parse(String(row.preview))] : [];
			}),
			unsettledTools: total.unsettled,
			checking: total.checking > 0
		};
	}
	workerConversations(task) {
		this.#ready(task);
		this.#validate(task);
		return Number(this.#sql("SELECT workerConversations FROM fusion_status_totals_v1 WHERE task=? AND role='worker'").get(task)?.workerConversations ?? 0);
	}
	hasConversation(task, session) {
		this.#ready(task);
		this.#validate(task);
		return Boolean(this.#sql("SELECT 1 FROM fusion_status_facts_v1 WHERE task=? AND session=? AND active=1 LIMIT 1").get(task, session));
	}
};
//#endregion
//#region src/contracts.ts
function asBrand(raw) {
	if (!raw || raw.includes("\0")) throw new TypeError("empty branded id");
	return raw;
}
const TaskId = (raw) => asBrand(raw);
const SessionId = (raw) => asBrand(raw);
const WorkOrderId = (raw) => asBrand(raw);
const OperationId = (raw) => asBrand(raw);
const ArtifactId = (raw) => asBrand(raw);
const SnapshotId = (raw) => asBrand(raw);
const EpochId = (raw) => asBrand(raw);
const UsdDecimal = (raw) => raw;
const TERMINAL_PHASES = /* @__PURE__ */ new Set([
	"COMPLETED",
	"CANCELLED",
	"FAILED"
]);
//#endregion
//#region src/review/protocol.ts
const VALID_DECISIONS = /* @__PURE__ */ new Set([
	"approve",
	"accept",
	"rework",
	"needs-decision"
]);
const SUCCESS_REASONS = /* @__PURE__ */ new Set([
	"stop",
	"end_turn",
	"end-turn",
	"tool_calls",
	"tool_call",
	"completed",
	"success"
]);
const TRUNCATED_REASONS = /* @__PURE__ */ new Set([
	"length",
	"max_tokens",
	"max_token"
]);
const ABORTED_REASONS = /* @__PURE__ */ new Set([
	"aborted",
	"abort",
	"cancelled",
	"canceled",
	"cancel"
]);
const ERROR_REASONS = /* @__PURE__ */ new Set([
	"error",
	"internal_error",
	"server_error"
]);
const FILTERED_REASONS = /* @__PURE__ */ new Set([
	"content_filter",
	"content-filter",
	"filtered",
	"contentfilter"
]);
function normalizeFinishReason(finishReason) {
	if (finishReason === null || finishReason === void 0) return null;
	const trimmed = finishReason.trim().toLowerCase();
	return trimmed.length ? trimmed : null;
}
function terminationFromFinishReason(finishReason) {
	if (finishReason === null) return null;
	if (SUCCESS_REASONS.has(finishReason)) return "success";
	if (TRUNCATED_REASONS.has(finishReason)) return "truncated";
	if (ABORTED_REASONS.has(finishReason)) return "aborted";
	if (ERROR_REASONS.has(finishReason)) return "error";
	if (FILTERED_REASONS.has(finishReason)) return "filtered";
	return "unknown";
}
function normalizeTermination(input) {
	const fromFinish = terminationFromFinishReason(normalizeFinishReason(input.finishReason));
	if (input.termination && fromFinish && input.termination !== fromFinish) return "unknown";
	if (input.termination) return input.termination;
	if (fromFinish) return fromFinish;
	return input.completeEvidence === true ? "success" : "unknown";
}
function parsedDecision(parsed) {
	if (!parsed || typeof parsed !== "object") return void 0;
	const decision = parsed.decision;
	return typeof decision === "string" ? decision.trim().toLowerCase() : void 0;
}
function incomplete(reasons, termination, reviewStatus = "incomplete") {
	return {
		reviewStatus,
		decision: "REVIEW_INCOMPLETE",
		protocolComplete: false,
		fallbackUsed: false,
		fallbackRequired: true,
		termination,
		reasons
	};
}
/**
* Lead review is fail-closed. Only an explicit success termination plus a
* versioned accept/rework/needs-decision structure can complete the protocol.
* DIRECT skips review.
*/
function classifyReview(input) {
	if (input.executionPath === "direct") return {
		reviewStatus: "not_required",
		decision: "not_required",
		protocolComplete: true,
		fallbackUsed: false,
		fallbackRequired: false,
		termination: "success",
		reasons: ["direct path does not require Lead review"]
	};
	const reasons = [];
	const termination = normalizeTermination(input);
	if (termination === "truncated") reasons.push(`finish_reason=${normalizeFinishReason(input.finishReason) ?? "truncated"}`);
	if (termination === "aborted") reasons.push("termination=aborted");
	if (termination === "error") reasons.push("termination=error");
	if (termination === "filtered") reasons.push("termination=filtered");
	if (termination === "unknown") reasons.push("termination=unknown; parsed text is not success evidence");
	if (!(input.rawText ?? "").trim()) reasons.push("empty review output");
	const decision = parsedDecision(input.parsed);
	if (input.parsed !== void 0 && input.parsed !== null && !decision) reasons.push("illegal review structure");
	else if (decision && !VALID_DECISIONS.has(decision)) reasons.push(`illegal review decision ${decision}`);
	if (termination === "truncated" || termination === "unknown") return incomplete(reasons.length ? reasons : [`termination=${termination}`], termination);
	if (termination === "aborted" || termination === "error" || termination === "filtered") return incomplete(reasons, termination, "failed");
	if (reasons.length) return incomplete(reasons, termination);
	if (decision === "rework") return {
		reviewStatus: "complete",
		decision: "rework",
		protocolComplete: true,
		fallbackUsed: false,
		fallbackRequired: false,
		termination,
		reasons: []
	};
	if (decision === "needs-decision") return {
		reviewStatus: "complete",
		decision: "needs-decision",
		protocolComplete: true,
		fallbackUsed: false,
		fallbackRequired: false,
		termination,
		reasons: []
	};
	if (decision === "approve" || decision === "accept") return {
		reviewStatus: "complete",
		decision: "approve",
		protocolComplete: true,
		fallbackUsed: false,
		fallbackRequired: false,
		termination,
		reasons: []
	};
	return incomplete(["review decision missing"], termination);
}
/** Map classifier output onto the reducer event decision. */
function toReducerReviewDecision(classification) {
	if (classification.decision === "approve") return "accept";
	if (classification.decision === "rework") return "rework";
	if (classification.decision === "needs-decision") return "needs-decision";
	return "REVIEW_INCOMPLETE";
}
function reviewAttemptFields(input) {
	const deliveredArtifactSource = input.deliveredArtifactSource ?? null;
	return {
		artifactPass: input.artifactPass,
		executionPath: input.executionPath,
		leadReviewStatus: input.classification.reviewStatus,
		finishReason: input.finishReason ?? null,
		protocolComplete: input.classification.protocolComplete,
		fallbackUsed: Boolean(deliveredArtifactSource) && (input.classification.fallbackRequired || input.classification.fallbackUsed),
		deliveredArtifactSource
	};
}
//#endregion
//#region src/review/ticket.ts
function requireThat$1(value, code) {
	if (!value) throw new FusionError(EVENT_CONFLICT, code);
}
function freeze(value) {
	if (value && typeof value === "object") {
		for (const child of Object.values(value)) freeze(child);
		Object.freeze(value);
	}
	return value;
}
function reportSubject(taskId, report) {
	const reportDigest = digestOf(report);
	return {
		taskId,
		workOrderId: report.workOrderId,
		revision: report.revision,
		reportId: `report:${reportDigest}`,
		reportDigest,
		snapshot: report.snapshot
	};
}
function sameSubject(left, right) {
	return digestOf(left) === digestOf(right);
}
function reviewReadinessReceipt(subject) {
	const receipt = {
		subject,
		receiptId: `ready:${subject.reportDigest}`,
		verdict: "review-ready",
		receiptDigest: ""
	};
	return {
		...receipt,
		receiptDigest: digestOf({
			subject,
			receiptId: receipt.receiptId,
			verdict: receipt.verdict
		})
	};
}
function captureTicket(ticket) {
	requireThat$1(ticket.id && ticket.requestId && Number.isSafeInteger(ticket.generation), "INVALID_TICKET");
	requireThat$1(ticket.workOrderDigest, "WORK_ORDER_DIGEST_REQUIRED");
	return freeze(structuredClone(ticket));
}
function createReviewTicket(state, ids) {
	const receipt = state.validatedReceipt;
	const workOrder = state.currentWorkOrder;
	if (!receipt) throw new FusionError(EVENT_CONFLICT, "review ticket requires a validated report");
	if (!workOrder) throw new FusionError(EVENT_CONFLICT, "review ticket requires a current work order");
	return captureTicket({
		id: ids.ticketId,
		requestId: ids.requestId,
		generation: state.reviewGeneration + 1,
		subject: receipt.subject,
		validationDigest: digestOf(receipt),
		workOrderDigest: digestOf(workOrder)
	});
}
function reviewRequestedEvent(state, seq, ids, extras = {}) {
	return {
		schemaVersion: 1,
		id: extras.id ?? `review-requested-${ids.requestId}`,
		taskId: state.taskId,
		seq,
		revision: extras.revision ?? state.revision,
		type: "review/requested",
		createdAt: extras.createdAt ?? (/* @__PURE__ */ new Date()).toISOString(),
		causeId: extras.causeId ?? ids.requestId,
		payload: { ticket: createReviewTicket(state, ids) }
	};
}
function reviewOutboxRow(ticket, payloadRef) {
	requireThat$1(payloadRef.length > 0, "REVIEW_PAYLOAD_REF_REQUIRED");
	return {
		operationId: OperationId(`review:${ticket.requestId}`),
		taskId: ticket.subject.taskId,
		kind: "review-request",
		state: "prepared",
		payloadRef,
		requestId: ticket.requestId,
		ticket: structuredClone(ticket)
	};
}
/** Callback constructor. No TaskState argument: the producer cannot rebind to the latest task. */
function resultFromCapturedTicket(ticket, outcome, envelope) {
	requireThat$1(outcome.requestId === ticket.requestId, "REVIEW_REQUEST_MISMATCH");
	requireThat$1(outcome.terminalEvidenceRef.length > 0, "TERMINAL_EVIDENCE_REQUIRED");
	requireThat$1(envelope.eventId && Number.isSafeInteger(envelope.seq) && envelope.seq > 0, "INVALID_EVENT_ENVELOPE");
	const classification = outcome.classification;
	requireThat$1(classification.decision !== "not_required", "DIRECT_IS_NOT_A_REVIEW_RESULT");
	const protocolValid = classification.reviewStatus === "complete" && classification.protocolComplete && classification.termination === "success";
	const decision = protocolValid ? toReducerReviewDecision(classification) : "REVIEW_INCOMPLETE";
	const binding = {
		ticketId: ticket.id,
		requestId: ticket.requestId,
		generation: ticket.generation,
		subject: structuredClone(ticket.subject),
		terminalEvidenceRef: outcome.terminalEvidenceRef,
		decision,
		protocolValid
	};
	return {
		schemaVersion: 1,
		id: envelope.eventId,
		taskId: ticket.subject.taskId,
		seq: envelope.seq,
		revision: ticket.subject.revision,
		type: "review/completed",
		createdAt: envelope.createdAt,
		causeId: ticket.requestId,
		payload: {
			decision,
			binding
		}
	};
}
/** Call at review dispatch AND immediately before committing verified completion. */
function assertCurrentSubject(state, ticket, actualSnapshot) {
	const workOrder = state.currentWorkOrder;
	requireThat$1(workOrder, "CURRENT_WORK_ORDER_REQUIRED");
	requireThat$1(workOrder.taskId === state.taskId && workOrder.id === ticket.subject.workOrderId, "WORK_ORDER_CHANGED");
	requireThat$1(state.revision === workOrder.revision && workOrder.revision === ticket.subject.revision, "REVISION_CHANGED");
	requireThat$1(digestOf(workOrder) === ticket.workOrderDigest, "WORK_ORDER_CHANGED");
	requireThat$1(state.candidateReport && state.validatedReport && state.validatedReceipt, "VALIDATED_CANDIDATE_REQUIRED");
	requireThat$1(digestOf(reportSubject(state.taskId, state.candidateReport)) === digestOf(ticket.subject), "CANDIDATE_CHANGED");
	requireThat$1(digestOf(reportSubject(state.taskId, state.validatedReport)) === digestOf(ticket.subject), "VALIDATED_REPORT_CHANGED");
	requireThat$1(digestOf(state.validatedReceipt.subject) === digestOf(ticket.subject), "READINESS_SUBJECT_CHANGED");
	requireThat$1(digestOf(state.validatedReceipt) === ticket.validationDigest, "READINESS_CHANGED");
	requireThat$1(actualSnapshot === ticket.subject.snapshot, "WORKSPACE_CHANGED");
}
//#endregion
//#region src/task/reducer.ts
const WAITING = /* @__PURE__ */ new Set([
	"WAITING_APPROVAL",
	"WAITING_USER",
	"WAITING_BUDGET",
	"RECOVERING",
	"PAUSED",
	"STOPPING",
	"NEEDS_DECISION"
]);
function initialControl() {
	return {
		mode: "running",
		pendingApprovalIds: [],
		budgetBlocked: false,
		recovering: false,
		outcomeUnknown: false
	};
}
function waiting(state, phase) {
	return {
		...state,
		resumePhase: WAITING.has(state.phase) ? state.resumePhase : state.phase,
		phase
	};
}
function resume(state, fallback) {
	return {
		...state,
		phase: state.resumePhase ?? fallback,
		resumePhase: void 0
	};
}
function patchControl(state, patch) {
	return {
		...state.control,
		...patch
	};
}
/** Releasing one gate never releases another; late review results remain actionable. */
function projectReleasedControl(state) {
	const control = state.control;
	if (control.mode !== "running") return state;
	if (control.pendingApprovalIds.length) return {
		...state,
		phase: "WAITING_APPROVAL"
	};
	if (control.outcomeUnknown || state.outcomeUnknown) return {
		...state,
		phase: "NEEDS_DECISION"
	};
	if (control.recovering) return {
		...state,
		phase: "RECOVERING"
	};
	if (control.budgetBlocked) return {
		...state,
		phase: "WAITING_BUDGET"
	};
	if (state.reviewResult) {
		const decision = state.reviewResult.decision;
		return {
			...state,
			resumePhase: void 0,
			phase: decision === "rework" ? "REWORK" : decision === "accept" && state.reviewResult.protocolValid ? "REVIEWING" : "NEEDS_DECISION"
		};
	}
	return resume(state, state.intent === "DIRECT" ? "DIRECT" : "PLANNING");
}
function requireReconciliation(state, evidenceRef) {
	if (!evidenceRef.trim() || writerBusy(state)) throw new FusionError(CONTROL_BLOCKED, "reconciliation requires evidence and a quiescent writer");
}
function applyPayload(state, event) {
	switch (event.type) {
		case "task/created":
			if (state) throw new FusionError(EVENT_CONFLICT, "task already exists");
			if (event.seq !== 1) throw new FusionError(EVENT_CONFLICT, "task/created must be seq 1");
			return {
				schemaVersion: 1,
				taskId: event.taskId,
				revision: event.revision,
				seq: event.seq,
				phase: "READY",
				parent: event.payload.parent,
				selection: event.payload.selection,
				verification: "unverified",
				pendingApprovalIds: [],
				pendingApprovals: {},
				control: initialControl(),
				outcomeUnknown: false,
				reviewGeneration: 0,
				ignoredReviewResults: [],
				staleValidations: [],
				appliedEventIds: [event.id]
			};
		case "requirements/revised": return resetReviewForNewSubject({
			...need(state, event),
			revision: event.revision,
			phase: state.phase === "READY" ? "PLANNING" : state.phase
		});
		case "profile/frozen": return applyProfileFrozen(state, event);
		case "intent/chosen": return {
			...need(state, event),
			intent: event.payload.intent,
			phase: event.payload.intent === "DIRECT" ? "DIRECT" : "PLANNING"
		};
		case "work-order/prepared": return applyWorkOrderPrepared(state, event);
		case "work-order/acceptance-amended": {
			const next = need(state, event), order = next.currentWorkOrder;
			if (!order || order.mode === "explore" || order.id !== event.payload.workOrderId || next.lease) throw new FusionError(WORK_ORDER_CONFLICT, "Acceptance amendment requires the current quiescent implementation work order");
			return resetReviewForNewSubject({
				...next,
				currentWorkOrder: {
					...order,
					acceptance: event.payload.acceptance
				}
			});
		}
		case "work-order/scope-expanded": {
			const next = need(state, event), order = next.currentWorkOrder;
			if (!order || order.mode === "explore" || order.mode === "text" || order.id !== event.payload.workOrderId || next.lease || order.allowedPaths.some((path) => !event.payload.allowedPaths.includes(path))) throw new FusionError(WORK_ORDER_CONFLICT, "Scope expansion requires the current quiescent implementation work order and keeps every allowed path");
			return resetReviewForNewSubject({
				...next,
				currentWorkOrder: {
					...order,
					allowedPaths: event.payload.allowedPaths
				}
			});
		}
		case "work-order/cancelled": {
			const next = need(state, event);
			if (next.parallelOrder?.id === event.payload.workOrderId) return {
				...next,
				parallelOrder: void 0,
				parallelChild: void 0,
				parallelAccepted: false
			};
			if (next.currentWorkOrder?.id !== event.payload.workOrderId) return next;
			return {
				...next,
				currentWorkOrder: void 0,
				reservedChild: void 0,
				acceptedChild: void 0,
				acceptedMessageId: void 0,
				phase: next.intent === "DIRECT" ? "DIRECT" : "READY"
			};
		}
		case "child/accepted": {
			const accepted = need(state, event);
			if (event.payload.operationId === accepted.parallelOrder?.operationId) return {
				...accepted,
				parallelAccepted: true
			};
			return {
				...accepted,
				exploration: state?.currentWorkOrder?.mode === "explore" ? void 0 : state?.exploration,
				acceptedChild: event.payload.child,
				acceptedMessageId: event.payload.messageId,
				phase: "WORKER_RUNNING"
			};
		}
		case "child/claimed": {
			const claimed = need(state, event);
			return claimed.parallelOrder?.operationId === event.payload.operationId ? claimed : {
				...claimed,
				phase: "WORKER_RUNNING"
			};
		}
		case "exploration/recorded": {
			const next = need(state, event), report = event.payload.report, order = next.currentWorkOrder;
			assertControlAllowsExecution(next);
			if (report.workOrderId === next.parallelOrder?.id) {
				if (next.parallelOrder.revision !== report.revision || next.parallelOrder.baseSnapshot !== report.snapshot) throw new FusionError(EVENT_CONFLICT, "Parallel exploration report is not bound to its frozen order");
				return {
					...next,
					parallelExploration: report,
					parallelOrder: void 0,
					parallelChild: void 0,
					parallelAccepted: false
				};
			}
			if (order?.mode !== "explore" || order.id !== report.workOrderId || order.revision !== report.revision || next.revision !== report.revision || order.baseSnapshot !== report.snapshot || next.lease) throw new FusionError(EVENT_CONFLICT, "Exploration requires the current read-only work order and unchanged snapshot");
			return {
				...next,
				exploration: report,
				phase: "PLANNING",
				lastSnapshot: report.snapshot
			};
		}
		case "report/submitted": return applySubmittedReport(state, event);
		case "report/validated": return applyValidatedReport(state, event);
		case "review/requested": return applyReviewRequested(state, event);
		case "review/completed": return applyReviewCompleted(state, event);
		case "lease/acquired": return {
			...need(state, event),
			lease: event.payload.lease
		};
		case "lease/released": return {
			...need(state, event),
			lease: void 0
		};
		case "approval/pending": return applyApprovalPending(state, event);
		case "approval/answered": return applyApprovalAnswered(state, event);
		case "budget/blocked": return {
			...waiting(need(state, event), "WAITING_BUDGET"),
			control: patchControl(need(state, event), { budgetBlocked: true })
		};
		case "budget/unblocked": {
			const next = need(state, event);
			if (!event.payload.authorizationId.trim()) throw new FusionError(CONTROL_BLOCKED, "budget authorization is required");
			return projectReleasedControl({
				...next,
				control: patchControl(next, { budgetBlocked: false })
			});
		}
		case "checkpoint/committed": return {
			...need(state, event),
			lastSnapshot: event.payload.checkpoint.snapshot
		};
		case "recovery/needed": return {
			...waiting(need(state, event), "RECOVERING"),
			control: patchControl(need(state, event), { recovering: true })
		};
		case "recovery/reconciled": {
			const next = need(state, event);
			requireReconciliation(next, event.payload.evidenceRef);
			return projectReleasedControl({
				...next,
				lastSnapshot: event.payload.snapshot,
				control: patchControl(next, { recovering: false })
			});
		}
		case "effect/outcome-unknown": return {
			...waiting(need(state, event), "NEEDS_DECISION"),
			outcomeUnknown: true,
			control: patchControl(need(state, event), { outcomeUnknown: true })
		};
		case "effects/reconciled": {
			const next = need(state, event);
			requireReconciliation(next, event.payload.evidenceRef);
			if (event.payload.quiescent !== true) throw new FusionError(CONTROL_BLOCKED, "effects are not quiescent");
			return projectReleasedControl({
				...next,
				outcomeUnknown: false,
				lastSnapshot: event.payload.snapshot,
				control: patchControl(next, { outcomeUnknown: false })
			});
		}
		case "task/stop-requested": return {
			...waiting(need(state, event), "STOPPING"),
			control: patchControl(need(state, event), { mode: "stop-requested" })
		};
		case "task/paused": return {
			...waiting(need(state, event), "PAUSED"),
			control: patchControl(need(state, event), { mode: "paused" })
		};
		case "task/resumed": {
			const next = need(state, event);
			if (next.control.mode !== "paused" || writerBusy(next)) throw new FusionError(CONTROL_BLOCKED, "only a quiescent paused task can resume");
			return projectReleasedControl({
				...next,
				control: patchControl(next, { mode: "running" })
			});
		}
		case "task/completed": return complete(need(state, event), event);
		case "task/cancelled": return {
			...need(state, event),
			phase: "CANCELLED",
			control: patchControl(need(state, event), { mode: "cancelled" })
		};
		default: return assertNever(event);
	}
}
function need(state, event) {
	if (!state) throw new FusionError(EVENT_CONFLICT, `${event.type} requires an existing task`);
	if (state.taskId !== event.taskId) throw new FusionError(EVENT_CONFLICT, "taskId mismatch");
	if (event.seq !== state.seq + 1) throw new FusionError(EVENT_CONFLICT, `expected seq ${state.seq + 1}, got ${event.seq}`);
	if (event.revision < 1) throw new FusionError(EVENT_CONFLICT, "revision must be >= 1");
	if (TERMINAL_PHASES.has(state.phase) && event.type !== "task/cancelled") throw new FusionError(EVENT_CONFLICT, `terminal phase ${state.phase} rejects ${event.type}`);
	return {
		...state,
		seq: event.seq,
		revision: Math.max(state.revision, event.revision),
		appliedEventIds: [...state.appliedEventIds, event.id]
	};
}
function rejectStaleReport(state, reportRevision) {
	if (state && reportRevision < state.revision) throw new FusionError(REVISION_STALE, `report revision ${reportRevision} cannot advance task revision ${state.revision}`);
}
function reportDigest(report) {
	return digestOf(report);
}
function blockingGate(gate) {
	return gate !== void 0 && gate.terminalStatus !== "accepting";
}
function resetReviewForNewSubject(state) {
	return {
		...state,
		candidateReport: void 0,
		validatedReport: void 0,
		validatedReceipt: void 0,
		activeReviewTicket: void 0,
		reviewResult: void 0,
		reviewResultDigest: void 0,
		acceptedReview: void 0,
		lastReport: void 0,
		reviewGate: void 0,
		reviewGeneration: state.reviewGeneration + 1
	};
}
function applyProfileFrozen(state, event) {
	const next = need(state, event);
	const updated = {
		...next,
		profileDigest: event.payload.digest,
		phase: next.phase === "READY" ? "PLANNING" : next.phase
	};
	if (next.candidateReport || next.validatedReport || next.activeReviewTicket || next.acceptedReview) return resetReviewForNewSubject(updated);
	return updated;
}
function applyWorkOrderPrepared(state, event) {
	const next = need(state, event);
	const incoming = event.payload.order;
	if (event.payload.parallel === true) {
		if (incoming.mode !== "explore") throw new FusionError(EVENT_CONFLICT, "a parallel order must be read-only exploration");
		if (next.parallelOrder) throw new FusionError(EVENT_CONFLICT, "a parallel exploration is already running");
		return {
			...next,
			parallelOrder: incoming,
			parallelChild: event.payload.reservedChild,
			parallelAccepted: false
		};
	}
	const current = next.currentWorkOrder;
	if (current && current.taskId === incoming.taskId && current.id === incoming.id && current.revision === incoming.revision) {
		if (digestOf(current) !== digestOf(incoming)) throw new FusionError(WORK_ORDER_CONFLICT, "same work-order identity cannot change its frozen digest");
		return {
			...next,
			currentWorkOrder: incoming,
			reservedChild: event.payload.reservedChild,
			phase: "PLANNING"
		};
	}
	return {
		...current || next.candidateReport || next.validatedReport || next.activeReviewTicket || next.acceptedReview ? resetReviewForNewSubject(next) : next,
		currentWorkOrder: incoming,
		reservedChild: event.payload.reservedChild,
		phase: "PLANNING"
	};
}
function applySubmittedReport(state, event) {
	rejectStaleReport(state, event.payload.report.revision);
	const next = need(state, event);
	const incoming = event.payload.report;
	if (next.currentWorkOrder?.mode === "explore") throw new FusionError(EVENT_CONFLICT, "Exploration cannot submit an implementation report");
	if (next.candidateReport && reportDigest(next.candidateReport) === reportDigest(incoming)) return {
		...next,
		candidateReport: incoming,
		lastReport: next.validatedReport ?? incoming
	};
	return {
		...resetReviewForNewSubject(next),
		candidateReport: incoming,
		lastReport: incoming,
		phase: next.phase === "WORKER_RUNNING" || next.phase === "REVIEWING" || next.phase === "REWORK" ? "WORKER_RUNNING" : next.phase
	};
}
function applyValidatedReport(state, event) {
	rejectStaleReport(state, event.payload.report.revision);
	const next = need(state, event);
	const incoming = event.payload.report;
	const digest = reportDigest(incoming);
	const receipt = reviewReadinessReceipt(reportSubject(next.taskId, incoming));
	const sameValidated = next.validatedReport !== void 0 && reportDigest(next.validatedReport) === digest;
	const sameCandidate = next.candidateReport !== void 0 && reportDigest(next.candidateReport) === digest;
	const sameWork = next.currentWorkOrder && incoming.workOrderId === next.currentWorkOrder.id && incoming.revision === next.currentWorkOrder.revision;
	if (!sameCandidate || !sameWork) return {
		...next,
		staleValidations: [...next.staleValidations, {
			reportDigest: digest,
			reason: "stale-validation"
		}]
	};
	if (sameValidated && blockingGate(next.reviewGate)) return {
		...next,
		lastReport: incoming,
		validatedReport: incoming,
		validatedReceipt: receipt
	};
	return {
		...next,
		lastReport: incoming,
		validatedReport: incoming,
		validatedReceipt: receipt,
		phase: businessPhaseForReview(next)
	};
}
function businessPhaseForReview(state) {
	if (state.control.mode !== "running") return state.phase;
	if (state.control.pendingApprovalIds.length) return "WAITING_APPROVAL";
	if (state.control.budgetBlocked) return "WAITING_BUDGET";
	if (state.control.recovering) return "RECOVERING";
	if (state.control.outcomeUnknown) return "NEEDS_DECISION";
	return "REVIEWING";
}
function applyReviewRequested(state, event) {
	const next = need(state, event);
	assertControlAllowsExecution(next);
	const receipt = next.validatedReceipt;
	if (!receipt || !next.validatedReport) throw new FusionError(EVENT_CONFLICT, "review/requested requires a validated report");
	const ticket = event.payload.ticket;
	assertCurrentSubject(next, ticket, next.lastSnapshot ?? ticket.subject.snapshot);
	if (!sameSubject(ticket.subject, receipt.subject)) throw new FusionError(EVENT_CONFLICT, "review ticket subject does not match the validated report");
	if (ticket.validationDigest !== digestOf(receipt)) throw new FusionError(EVENT_CONFLICT, "review ticket validation digest does not match readiness receipt");
	if (ticket.generation !== next.reviewGeneration + 1 && next.activeReviewTicket && digestOf(next.activeReviewTicket) === digestOf(ticket)) return next;
	if (ticket.generation !== next.reviewGeneration + 1) throw new FusionError(EVENT_CONFLICT, `review ticket generation ${ticket.generation} is not the next generation ${next.reviewGeneration + 1}`);
	return {
		...next,
		activeReviewTicket: ticket,
		reviewGeneration: ticket.generation,
		reviewResult: void 0,
		reviewResultDigest: void 0,
		acceptedReview: void 0,
		reviewGate: void 0,
		phase: "REVIEWING"
	};
}
function applyReviewCompleted(state, event) {
	const next = need(state, event);
	const binding = event.payload.binding;
	if (!binding) return applyLegacyReviewDecision(next, event);
	return applyBoundReviewResult(next, binding, event);
}
function applyLegacyReviewDecision(state, event) {
	const decision = event.payload.decision;
	if (decision === "accept") return {
		...state,
		reviewGate: state.lastReport ? {
			taskId: state.taskId,
			workOrderId: state.currentWorkOrder?.id ?? state.lastReport.workOrderId,
			revision: state.lastReport.revision,
			reportDigest: reportDigest(state.lastReport),
			snapshot: state.lastReport.snapshot,
			reviewAttemptId: event.id,
			decision,
			terminalStatus: "legacy-unbound"
		} : state.reviewGate
	};
	if (!state.lastReport) throw new FusionError(EVENT_CONFLICT, "review/completed requires a validated report");
	const gate = {
		taskId: state.taskId,
		workOrderId: state.currentWorkOrder?.id ?? state.lastReport.workOrderId,
		revision: state.lastReport.revision,
		reportDigest: reportDigest(state.lastReport),
		snapshot: state.lastReport.snapshot,
		reviewAttemptId: event.id,
		decision,
		terminalStatus: decision === "rework" ? "rework" : decision === "REVIEW_INCOMPLETE" ? "incomplete" : "needs-decision"
	};
	if (decision === "rework") return {
		...state,
		reviewGate: gate,
		phase: "REWORK"
	};
	return {
		...state,
		reviewGate: gate,
		phase: "NEEDS_DECISION"
	};
}
function applyBoundReviewResult(state, result, event) {
	const ticket = state.activeReviewTicket;
	if (!ticket || ticket.id !== result.ticketId || ticket.requestId !== result.requestId || ticket.generation !== result.generation || !sameSubject(ticket.subject, result.subject)) return {
		...state,
		ignoredReviewResults: [...state.ignoredReviewResults, result]
	};
	const resultDigest = digestOf(result);
	if (state.reviewResultDigest) {
		if (state.reviewResultDigest !== resultDigest) throw new FusionError(REVIEW_RESULT_CONFLICT, "conflicting review result for the same ticket");
		return state;
	}
	const accepts = result.protocolValid && result.decision === "accept";
	const gate = {
		taskId: state.taskId,
		workOrderId: ticket.subject.workOrderId,
		revision: ticket.subject.revision,
		reportDigest: ticket.subject.reportDigest,
		snapshot: ticket.subject.snapshot,
		reviewAttemptId: event.id,
		decision: result.decision,
		terminalStatus: accepts ? "accepting" : result.decision === "rework" ? "rework" : result.decision === "REVIEW_INCOMPLETE" ? "incomplete" : "needs-decision"
	};
	const recorded = {
		...state,
		reviewResult: result,
		reviewResultDigest: resultDigest,
		acceptedReview: accepts ? {
			ticket,
			resultDigest
		} : void 0,
		reviewGate: gate
	};
	if (state.control.mode !== "running" || state.control.pendingApprovalIds.length || state.control.budgetBlocked || state.control.recovering || state.control.outcomeUnknown) return recorded;
	if (result.decision === "rework") return {
		...recorded,
		phase: "REWORK"
	};
	if (result.decision === "needs-decision" || result.decision === "REVIEW_INCOMPLETE") return {
		...recorded,
		phase: "NEEDS_DECISION"
	};
	return {
		...recorded,
		phase: "REVIEWING"
	};
}
function applyApprovalPending(state, event) {
	const next = need(state, event);
	const approval = event.payload.approval;
	const pendingApprovalIds = [.../* @__PURE__ */ new Set([...next.pendingApprovalIds, approval.id])];
	return {
		...waiting(next, "WAITING_APPROVAL"),
		pendingApprovalIds,
		pendingApprovals: {
			...next.pendingApprovals,
			[approval.id]: approval
		},
		control: patchControl(next, { pendingApprovalIds })
	};
}
function applyApprovalAnswered(state, event) {
	const next = need(state, event);
	if (!next.pendingApprovals[event.payload.approvalId] || !next.pendingApprovalIds.includes(event.payload.approvalId)) throw new FusionError(EVENT_CONFLICT, `approval ${event.payload.approvalId} is not pending`);
	const pendingApprovalIds = next.pendingApprovalIds.filter((id) => id !== event.payload.approvalId);
	const pendingApprovals = { ...next.pendingApprovals };
	delete pendingApprovals[event.payload.approvalId];
	const control = patchControl(next, { pendingApprovalIds });
	if (event.payload.state !== "approved") return {
		...next,
		pendingApprovalIds,
		pendingApprovals,
		control: {
			...control,
			mode: "paused"
		},
		phase: pendingApprovalIds.length ? "WAITING_APPROVAL" : "NEEDS_DECISION"
	};
	return projectReleasedControl({
		...next,
		pendingApprovalIds,
		pendingApprovals,
		control
	});
}
function currentSnapshot(state) {
	return state.lastSnapshot ?? state.validatedReport?.snapshot ?? state.candidateReport?.snapshot ?? state.lastReport?.snapshot;
}
function writerBusy(state) {
	return Boolean(state.lease && state.lease.activeOperationIds.length > 0);
}
function assertControlAllowsExecution(state) {
	if (state.control.mode !== "running") throw new FusionError(CONTROL_BLOCKED, `control mode ${state.control.mode} blocks execution`);
	if (state.control.pendingApprovalIds.length) throw new FusionError(CONTROL_BLOCKED, "pending human approval blocks execution");
	if (state.control.outcomeUnknown || state.outcomeUnknown) throw new FusionError(EVENT_CONFLICT, "cannot complete while an effect is OUTCOME_UNKNOWN");
	if (state.control.budgetBlocked || state.control.recovering) throw new FusionError(CONTROL_BLOCKED, "budget or recovery gate is still set");
	if (writerBusy(state)) throw new FusionError(CONTROL_BLOCKED, "an active write lease blocks execution");
}
function assertAcceptingReview(state, event) {
	if (state.intent === "DIRECT") return;
	if (event.payload.verification !== "verified") throw new FusionError(EVENT_CONFLICT, "delegated downgrade must not use ordinary verified completion");
	const accepted = state.acceptedReview;
	const ticket = state.activeReviewTicket;
	const validated = state.validatedReport;
	const candidate = state.candidateReport;
	const receipt = state.validatedReceipt;
	if (!accepted || !ticket || !validated || !candidate || !receipt) throw new FusionError(REVIEW_TICKET_REQUIRED, "delegated task cannot complete before a bound accepting review");
	const actualSnapshot = state.lastSnapshot ?? accepted.ticket.subject.snapshot;
	assertCurrentSubject(state, accepted.ticket, actualSnapshot);
	if (digestOf(accepted.ticket) !== digestOf(ticket) || accepted.ticket.generation !== state.reviewGeneration) throw new FusionError(EVENT_CONFLICT, "accepting review is stale for the current generation");
	if (!sameSubject(accepted.ticket.subject, reportSubject(state.taskId, candidate))) throw new FusionError(EVENT_CONFLICT, "accepting review does not match the current candidate");
	if (!sameSubject(accepted.ticket.subject, reportSubject(state.taskId, validated))) throw new FusionError(EVENT_CONFLICT, "accepting review does not match the current validated report");
	if (accepted.ticket.validationDigest !== digestOf(receipt)) throw new FusionError(EVENT_CONFLICT, "accepting review validation receipt changed");
	if (!state.reviewResult || digestOf(state.reviewResult) !== accepted.resultDigest) throw new FusionError(EVENT_CONFLICT, "accepting review result changed");
	if (!state.reviewResult.protocolValid || state.reviewResult.decision !== "accept") throw new FusionError(EVENT_CONFLICT, "review result is not an accepting decision");
	const snapshot = currentSnapshot(state);
	if (!snapshot || accepted.ticket.subject.snapshot !== snapshot) throw new FusionError(EVENT_CONFLICT, "accepting review snapshot is not the current workspace snapshot");
	if (event.payload.snapshot !== snapshot) throw new FusionError(EVENT_CONFLICT, "completion snapshot is not the current workspace snapshot");
}
function complete(state, event) {
	if (event.revision < state.revision) throw new FusionError(REVISION_STALE, "old revision cannot complete a newer task");
	assertControlAllowsExecution(state);
	if (state.outcomeUnknown || state.control.outcomeUnknown) throw new FusionError(EVENT_CONFLICT, "cannot complete while an effect is OUTCOME_UNKNOWN");
	if (state.phase !== "REVIEWING" && state.phase !== "DIRECT") throw new FusionError(EVENT_CONFLICT, `cannot complete from ${state.phase}`);
	if (event.payload.verification === "verified") assertAcceptingReview(state, event);
	else if (state.intent !== "DIRECT") throw new FusionError(EVENT_CONFLICT, "delegated downgrade must use an explicit fallback event, not ordinary completion");
	return {
		...state,
		phase: "COMPLETED",
		verification: event.payload.verification,
		lastSnapshot: event.payload.snapshot,
		control: patchControl(state, { mode: "completed" })
	};
}
function assertNever(event) {
	throw new FusionError(EVENT_CONFLICT, `unknown event ${event.type}`);
}
function reduce(state, event) {
	if (event.schemaVersion !== 1) throw new FusionError(EVENT_CONFLICT, `unsupported schemaVersion ${event.schemaVersion}`);
	if (state?.appliedEventIds.includes(event.id)) return state;
	return applyPayload(state, event);
}
function reduceAll(events) {
	let state;
	for (const event of events) state = reduce(state, event);
	if (!state) throw new FusionError(EVENT_CONFLICT, "no events");
	return state;
}
//#endregion
//#region src/task/store.ts
const nodeIo = {
	existsSync,
	mkdirSync: (path) => mkdirSync(path, { recursive: true }),
	readFileSync: (path) => readFileSync(path, "utf8"),
	writeFileSync: (path, data) => writeFileSync(path, data),
	renameSync,
	rmSync: (path) => rmSync(path, { force: true })
};
const STORE_PROJECTION_VERSION = 2;
var FileFusionStore = class {
	root;
	io;
	#memory = /* @__PURE__ */ new Map();
	constructor(root, io = nodeIo) {
		this.root = root;
		this.io = io;
	}
	load(taskId) {
		return this.#read(taskId)?.persisted.state;
	}
	replay(taskId) {
		return reduceAll(this.#require(taskId).persisted.events);
	}
	create(event) {
		if (this.load(event.taskId)) throw new FusionError(EVENT_CONFLICT, "task exists");
		const state = reduce(void 0, event);
		this.#persist(event.taskId, {
			projectionVersion: 2,
			checksum: "",
			persisted: {
				state,
				events: [event],
				outbox: []
			},
			artifacts: []
		});
		return this.#require(event.taskId).persisted.state;
	}
	transact(taskId, expectedSeq, mutate) {
		const current = this.#require(taskId);
		if (current.persisted.state.seq !== expectedSeq) throw new FusionError(EVENT_CONFLICT, `expected seq ${expectedSeq}, have ${current.persisted.state.seq}`);
		const patch = mutate(current.persisted);
		let state = current.persisted.state;
		const nextEvents = [...current.persisted.events];
		for (const event of patch.events ?? []) {
			if (state.appliedEventIds.includes(event.id)) continue;
			state = reduce(state, event);
			nextEvents.push(event);
		}
		this.#persist(taskId, {
			projectionVersion: 2,
			checksum: "",
			persisted: {
				state,
				events: nextEvents,
				outbox: patch.outbox ?? current.persisted.outbox
			},
			artifacts: current.artifacts
		});
		return this.#require(taskId).persisted.state;
	}
	append(taskId, expectedRevision, events) {
		const current = this.#require(taskId);
		if (current.persisted.state.revision !== expectedRevision) throw new FusionError(REVISION_CONFLICT, `expected revision ${expectedRevision}, have ${current.persisted.state.revision}`);
		let state = current.persisted.state;
		const nextEvents = [...current.persisted.events];
		for (const event of events) {
			if (state.appliedEventIds.includes(event.id)) continue;
			state = reduce(state, event);
			nextEvents.push(event);
		}
		this.#persist(taskId, {
			projectionVersion: 2,
			checksum: "",
			persisted: {
				state,
				events: nextEvents,
				outbox: current.persisted.outbox
			},
			artifacts: current.artifacts
		});
		return this.#require(taskId).persisted.state;
	}
	putArtifact(taskId, bytes, mediaType) {
		const current = this.#require(taskId);
		const digest = sha256Hex(bytes);
		const dir = this.#taskDir(taskId);
		this.io.mkdirSync(join(dir, "artifacts"));
		const finalPath = join(dir, "artifacts", digest);
		const partPath = `${finalPath}.part`;
		this.io.writeFileSync(partPath, bytes);
		this.io.renameSync(partPath, finalPath);
		const record = {
			id: ArtifactId(digest),
			digest,
			ownerTaskId: taskId,
			mediaType,
			bytes: bytes.byteLength,
			storageRef: finalPath
		};
		this.#persist(taskId, {
			projectionVersion: 2,
			checksum: "",
			persisted: current.persisted,
			artifacts: [...current.artifacts.filter((item) => item.digest !== digest), record]
		});
		return record;
	}
	prepareOutbox(row) {
		const current = this.#require(row.taskId);
		const existing = current.persisted.outbox.find((item) => item.operationId === row.operationId);
		if (existing) return existing;
		this.#persist(row.taskId, {
			projectionVersion: 2,
			checksum: "",
			persisted: {
				...current.persisted,
				outbox: [...current.persisted.outbox, {
					...row,
					state: "prepared"
				}]
			},
			artifacts: current.artifacts
		});
		return this.outbox(row.taskId).find((item) => item.operationId === row.operationId);
	}
	advanceOutbox(taskId, operationId, from, to, patch = {}) {
		const current = this.#require(taskId);
		const next = current.persisted.outbox.map((row) => {
			if (row.operationId !== operationId) return row;
			if (row.state !== from) throw new FusionError(EVENT_CONFLICT, `outbox ${operationId} is ${row.state}, not ${from}`);
			return {
				...row,
				...patch,
				state: to
			};
		});
		if (!next.some((row) => row.operationId === operationId)) throw new FusionError(EVENT_CONFLICT, `outbox ${operationId} missing`);
		this.#persist(taskId, {
			projectionVersion: 2,
			checksum: "",
			persisted: {
				...current.persisted,
				outbox: next
			},
			artifacts: current.artifacts
		});
		return this.outbox(taskId).find((row) => row.operationId === operationId);
	}
	outbox(taskId) {
		return this.#require(taskId).persisted.outbox;
	}
	artifacts(taskId) {
		return this.#require(taskId).artifacts;
	}
	#taskDir(taskId) {
		return join(this.root, "tasks", taskId);
	}
	#read(taskId) {
		const cached = this.#memory.get(taskId);
		if (cached) return cached;
		const path = join(this.#taskDir(taskId), "snapshot.json");
		if (!this.io.existsSync(path)) return void 0;
		const parsed = decodeStoreSnapshot(this.io.readFileSync(path), taskId);
		this.#memory.set(taskId, parsed);
		return parsed;
	}
	#require(taskId) {
		const snap = this.#read(taskId);
		if (!snap) throw new FusionError(EVENT_CONFLICT, `unknown task ${taskId}`);
		return snap;
	}
	#persist(taskId, next) {
		const checksum = digestOf({
			persisted: next.persisted,
			artifacts: next.artifacts
		});
		const snapshot = {
			...next,
			projectionVersion: 2,
			checksum
		};
		const dir = this.#taskDir(taskId);
		this.io.mkdirSync(dir);
		const finalPath = join(dir, "snapshot.json");
		const tmpPath = `${finalPath}.tmp`;
		try {
			this.io.writeFileSync(tmpPath, `${JSON.stringify(snapshot, null, 2)}\n`);
			this.io.renameSync(tmpPath, finalPath);
		} catch (error) {
			try {
				this.io.rmSync(tmpPath);
			} catch {}
			throw new FusionError(FLUSH_FAILED, error instanceof Error ? error.message : "flush failed");
		}
		this.#memory.set(taskId, snapshot);
	}
};
/** Validate before either backend admits a persisted execution projection. */
function decodeStoreSnapshot(raw, taskId) {
	let parsed;
	try {
		parsed = JSON.parse(raw);
	} catch {
		throw new FusionError(STORE_MIGRATION_REQUIRED, `snapshot for ${taskId} is not a JSON store document`);
	}
	if (!parsed || typeof parsed !== "object" || !parsed.persisted) throw new FusionError(STORE_MIGRATION_REQUIRED, `snapshot for ${taskId} is not a store document`);
	if (parsed.checksum !== digestOf({
		persisted: parsed.persisted,
		artifacts: parsed.artifacts
	})) throw new FusionError(CHECKSUM_MISMATCH, `corrupt snapshot for ${taskId}`);
	requireStorageProjectionVersion(parsed);
	const state = parsed.persisted.state;
	const control = state?.control;
	if (!control || ![
		"running",
		"paused",
		"stop-requested",
		"cancelled",
		"completed"
	].includes(control.mode) || !Array.isArray(control.pendingApprovalIds) || !control.pendingApprovalIds.every((id) => typeof id === "string") || typeof control.budgetBlocked !== "boolean" || typeof control.recovering !== "boolean" || typeof control.outcomeUnknown !== "boolean" || !Array.isArray(state.pendingApprovalIds) || !state.pendingApprovals || !Array.isArray(state.appliedEventIds) || !Array.isArray(state.ignoredReviewResults) || !Array.isArray(state.staleValidations) || !Number.isSafeInteger(state.reviewGeneration) || !Array.isArray(parsed.persisted.events) || !Array.isArray(parsed.persisted.outbox) || !Array.isArray(parsed.artifacts) || state.taskId !== taskId) throw new FusionError(STORE_MIGRATION_REQUIRED, `snapshot for ${taskId} has an incomplete execution projection`);
	return parsed;
}
function requireStorageProjectionVersion(raw) {
	if (!raw || typeof raw !== "object") throw new FusionError(STORE_MIGRATION_REQUIRED, "INVALID_STORE_DOCUMENT");
	if (raw.projectionVersion !== 2) throw new FusionError(STORE_MIGRATION_REQUIRED, "STORE_MIGRATION_REQUIRED");
}
function failingRenameIo(base, failOnce = true) {
	let failed = false;
	return {
		...base,
		renameSync(from, to) {
			if (dirname(to).endsWith("artifacts")) {
				base.renameSync(from, to);
				return;
			}
			if (!failed || !failOnce) {
				failed = true;
				throw new Error("injected flush failure");
			}
			base.renameSync(from, to);
		}
	};
}
//#endregion
//#region src/task/sqlite-store.ts
/** Durable Host backend. Every read is fresh; CAS and outbox writes share one transaction. */
var SqliteFusionStore = class {
	filename;
	#db;
	#status;
	constructor(filename) {
		this.filename = filename;
		if (filename !== ":memory:") mkdirSync(dirname(filename), { recursive: true });
		this.#db = new DatabaseSync(filename);
		try {
			this.#db.exec("PRAGMA busy_timeout = 5000; PRAGMA foreign_keys = ON;");
			const version = this.#db.prepare("PRAGMA user_version").get()?.user_version;
			if (version !== 0 && version !== 1 && version !== 2) throw new FusionError(STORE_MIGRATION_REQUIRED, "unknown Fusion database version");
			if (version === 0) {
				if (this.#db.prepare("SELECT count(*) AS n FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%'").get()?.n !== 0) throw new FusionError(STORE_MIGRATION_REQUIRED, "unversioned nonempty Fusion database");
				this.#db.exec(`BEGIN IMMEDIATE;
          CREATE TABLE tasks (id TEXT PRIMARY KEY, snapshot TEXT NOT NULL);
          CREATE TABLE artifacts (task_id TEXT NOT NULL REFERENCES tasks(id), digest TEXT NOT NULL, bytes BLOB NOT NULL, PRIMARY KEY(task_id, digest));
          CREATE TABLE documents (id TEXT PRIMARY KEY, revision INTEGER NOT NULL, json TEXT NOT NULL, checksum TEXT NOT NULL);
          PRAGMA user_version = 1;
          COMMIT;`);
			}
			this.#db.exec("PRAGMA journal_mode = WAL; PRAGMA synchronous = FULL;");
			this.#status = new StatusIndex(this.#db);
		} catch (error) {
			this.#db.close();
			throw error;
		}
	}
	statusSnapshot(read, backfill = true) {
		for (;;) try {
			const result = this.#transaction(() => {
				try {
					return { value: read(this.#status) };
				} catch (error) {
					if (error instanceof StatusDataError) return { error };
					throw error;
				}
			});
			if ("error" in result) throw result.error;
			return result.value;
		} catch (error) {
			if (!(error instanceof StatusPending) || !backfill) throw error;
			while (this.#transaction(() => this.#status.flushBatch(error.task)));
		}
	}
	/** HTTP reads yield between committed batches; cancellation retains resumable progress. */
	async statusSnapshotAsync(read, signal) {
		for (;;) {
			signal?.throwIfAborted();
			try {
				return this.statusSnapshot(read, false);
			} catch (error) {
				if (!(error instanceof StatusPending)) throw error;
				this.#transaction(() => this.#status.flushBatch(error.task));
				await setImmediate(void 0, { signal });
			}
		}
	}
	close() {
		this.#db.close();
	}
	listTaskIds() {
		return this.#db.prepare("SELECT id FROM tasks ORDER BY id").all().map((row) => {
			if (typeof row.id !== "string") throw new FusionError(STORE_MIGRATION_REQUIRED, "invalid task identity");
			return row.id;
		});
	}
	listDocumentIds(prefix) {
		return this.#db.prepare("SELECT id FROM documents WHERE substr(id, 1, ?) = ? ORDER BY id").all(prefix.length, prefix).map((row) => {
			if (typeof row.id !== "string") throw new FusionError(STORE_MIGRATION_REQUIRED, "invalid document identity");
			return row.id;
		});
	}
	load(taskId) {
		return this.#read(taskId)?.persisted.state;
	}
	events(taskId) {
		return this.#require(taskId).persisted.events;
	}
	replay(taskId) {
		return reduceAll(this.#require(taskId).persisted.events);
	}
	create(event) {
		return this.#transaction(() => {
			if (this.#read(event.taskId)) throw new FusionError(EVENT_CONFLICT, "task exists");
			const state = reduce(void 0, event);
			this.#write(event.taskId, {
				state,
				events: [event],
				outbox: []
			}, []);
			return state;
		});
	}
	transact(taskId, expectedSeq, mutate) {
		return this.#transaction(() => {
			const current = this.#require(taskId);
			if (current.persisted.state.seq !== expectedSeq) throw new FusionError(EVENT_CONFLICT, "task sequence changed");
			const patch = mutate(structuredClone(current.persisted));
			return this.#apply(taskId, current, patch.events ?? [], patch.outbox ?? current.persisted.outbox);
		});
	}
	append(taskId, expectedRevision, events) {
		return this.#transaction(() => {
			const current = this.#require(taskId);
			if (current.persisted.state.revision !== expectedRevision) throw new FusionError(REVISION_CONFLICT, "task revision changed");
			return this.#apply(taskId, current, events, current.persisted.outbox);
		});
	}
	putArtifact(taskId, bytes, mediaType) {
		return this.putArtifacts(taskId, [{
			bytes,
			mediaType
		}])[0];
	}
	/** One atomic metadata update for a bounded workspace evidence batch. */
	putArtifacts(taskId, inputs) {
		return this.#transaction(() => {
			const current = this.#require(taskId);
			const records = new Map(current.artifacts.map((record) => [record.digest, record]));
			const insert = this.#db.prepare("INSERT OR IGNORE INTO artifacts(task_id, digest, bytes) VALUES (?, ?, ?)");
			const result = inputs.map(({ bytes, mediaType }) => {
				const digest = sha256Hex(bytes);
				const record = {
					id: ArtifactId(digest),
					digest,
					ownerTaskId: taskId,
					mediaType,
					bytes: bytes.byteLength,
					storageRef: `sqlite:${taskId}:${digest}`
				};
				insert.run(taskId, digest, bytes);
				records.set(digest, record);
				return record;
			});
			this.#write(taskId, current.persisted, [...records.values()]);
			return result;
		});
	}
	/** Load owned evidence bytes and verify content before trusting the reference. */
	readArtifact(taskId, digest) {
		return this.readArtifacts(taskId, [digest])[0];
	}
	readArtifacts(taskId, digests) {
		const records = new Map(this.artifacts(taskId).map((record) => [record.digest, record]));
		const select = this.#db.prepare("SELECT bytes FROM artifacts WHERE task_id = ? AND digest = ?");
		return digests.map((digest) => {
			const record = records.get(digest), row = select.get(taskId, digest);
			if (!record || !(row?.bytes instanceof Uint8Array)) throw new FusionError(EVENT_CONFLICT, "artifact not owned by task");
			if (sha256Hex(row.bytes) !== digest || row.bytes.byteLength !== record.bytes) throw new FusionError(CHECKSUM_MISMATCH, "corrupt artifact");
			return row.bytes;
		});
	}
	prepareOutbox(row) {
		return this.#transaction(() => {
			const current = this.#require(row.taskId);
			const existing = current.persisted.outbox.find((item) => item.operationId === row.operationId);
			if (existing) return existing;
			const prepared = {
				...row,
				state: "prepared"
			};
			this.#write(row.taskId, {
				...current.persisted,
				outbox: [...current.persisted.outbox, prepared]
			}, current.artifacts);
			return prepared;
		});
	}
	advanceOutbox(taskId, operationId, from, to, patch = {}) {
		return this.#transaction(() => {
			const current = this.#require(taskId);
			const prior = current.persisted.outbox.find((item) => item.operationId === operationId);
			if (!prior || prior.state !== from) throw new FusionError(EVENT_CONFLICT, "outbox state changed or missing");
			if (patch.operationId !== void 0 && patch.operationId !== prior.operationId || patch.taskId !== void 0 && patch.taskId !== prior.taskId) throw new FusionError(EVENT_CONFLICT, "outbox identity is immutable");
			const next = {
				...prior,
				...patch,
				state: to
			};
			this.#write(taskId, {
				...current.persisted,
				outbox: current.persisted.outbox.map((item) => item.operationId === operationId ? next : item)
			}, current.artifacts);
			return next;
		});
	}
	outbox(taskId) {
		return this.#require(taskId).persisted.outbox;
	}
	artifacts(taskId) {
		return this.#require(taskId).artifacts;
	}
	/** Host binding / usage documents require caller-side schema validation after loading. */
	readDocument(id) {
		const row = this.#db.prepare("SELECT revision, json, checksum FROM documents WHERE id = ?").get(id);
		if (!row) return void 0;
		if (typeof row.json !== "string" || typeof row.revision !== "number") throw new FusionError(STORE_MIGRATION_REQUIRED, "invalid Host document");
		if (sha256Hex(Buffer.from(row.json)) !== row.checksum) throw new FusionError(CHECKSUM_MISMATCH, "corrupt Host document");
		return {
			revision: row.revision,
			value: JSON.parse(row.json)
		};
	}
	/** Compare-and-swap prevents an old Host instance overwriting a newer selection or bill. */
	writeDocument(id, expectedRevision, value) {
		return this.#transaction(() => this.#writeDocument(id, expectedRevision, value));
	}
	writeDocuments(rows) {
		return this.#transaction(() => rows.map((row) => this.#writeDocument(row.id, row.expectedRevision, row.value)));
	}
	#writeDocument(id, expectedRevision, value) {
		if ((this.readDocument(id)?.revision ?? 0) !== expectedRevision) throw new FusionError(REVISION_CONFLICT, "Host document revision changed");
		const json = JSON.stringify(value);
		if (json === void 0) throw new Error("Host document must be JSON serializable");
		const revision = expectedRevision + 1;
		this.#db.prepare("INSERT INTO documents VALUES (?, ?, ?, ?) ON CONFLICT(id) DO UPDATE SET revision=excluded.revision, json=excluded.json, checksum=excluded.checksum").run(id, revision, json, sha256Hex(Buffer.from(json)));
		this.#status.sync(id);
		return revision;
	}
	#apply(taskId, current, events, outbox) {
		let state = current.persisted.state;
		const nextEvents = [...current.persisted.events];
		for (const event of events) {
			if (state.appliedEventIds.includes(event.id)) continue;
			state = reduce(state, event);
			nextEvents.push(event);
		}
		this.#write(taskId, {
			state,
			events: nextEvents,
			outbox
		}, current.artifacts);
		return state;
	}
	#read(taskId) {
		const row = this.#db.prepare("SELECT snapshot FROM tasks WHERE id = ?").get(taskId);
		if (!row) return void 0;
		if (typeof row.snapshot !== "string") throw new FusionError(STORE_MIGRATION_REQUIRED, "invalid task snapshot");
		return decodeStoreSnapshot(row.snapshot, taskId);
	}
	#require(taskId) {
		const current = this.#read(taskId);
		if (!current) throw new FusionError(EVENT_CONFLICT, `unknown task ${taskId}`);
		return current;
	}
	#write(taskId, persisted, artifacts) {
		const snapshot = {
			projectionVersion: 2,
			persisted,
			artifacts,
			checksum: digestOf({
				persisted,
				artifacts
			})
		};
		this.#db.prepare("INSERT INTO tasks VALUES (?, ?) ON CONFLICT(id) DO UPDATE SET snapshot=excluded.snapshot").run(taskId, JSON.stringify(snapshot));
		const indexId = `task-index:${taskId}`;
		const prior = this.readDocument(indexId), summary = taskSummary(persisted.state, persisted.events[0].createdAt, persisted.events.at(-1).createdAt);
		const priorTitle = (prior?.value)?.title;
		if (!persisted.state.currentWorkOrder && typeof priorTitle === "string") summary.title = priorTitle;
		this.#writeDocument(indexId, prior?.revision ?? 0, summary);
	}
	#transaction(body) {
		this.#db.exec("BEGIN IMMEDIATE");
		try {
			const result = body();
			this.#db.exec("COMMIT");
			return result;
		} catch (error) {
			this.#db.exec("ROLLBACK");
			throw error;
		}
	}
};
//#endregion
//#region src/host/bindings.ts
function object(value) {
	if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("Invalid Fusion session binding");
	return value;
}
function readBinding(value, sessionId) {
	const row = object(value);
	if (row.schemaVersion !== 1 || row.sessionId !== sessionId || typeof row.taskId !== "string" || typeof row.selected !== "boolean") throw new Error("Fusion binding migration or reconciliation required");
	const prompt = object(row.prompts);
	if (row.workerId !== void 0 && (typeof row.workerId !== "string" || !row.workerId || row.workerId.includes("\0"))) throw new Error("Invalid persistent Fusion Worker identity");
	if (typeof prompt.lead !== "string" || typeof prompt.worker !== "string" || typeof prompt.compact !== "string") throw new Error("Frozen Fusion prompts are missing");
	const prompts = {
		lead: prompt.lead,
		worker: prompt.worker,
		compact: prompt.compact
	};
	const profile = completeProfile(object(row.profile), prompts);
	if (digestOf(profile) !== digestOf(row.profile)) throw new Error("Frozen Fusion profile or prompt digest changed");
	return {
		schemaVersion: 1,
		sessionId,
		taskId: TaskId(row.taskId),
		selected: row.selected,
		profile,
		prompts,
		...row.workerId === void 0 ? {} : { workerId: row.workerId }
	};
}
/** Selection is durable and scoped by the native Lead identity, never a global default. */
var BindingRepository = class {
	store;
	constructor(store) {
		this.store = store;
	}
	read(sessionId) {
		const document = this.store.readDocument(`binding:${sessionId}`);
		return document ? {
			revision: document.revision,
			binding: readBinding(document.value, sessionId)
		} : void 0;
	}
	select(sessionId, id, resolved) {
		const prior = this.read(sessionId);
		if (prior?.binding.selected) throw new Error("Fusion is already selected for this session");
		const binding = {
			schemaVersion: 1,
			sessionId,
			taskId: id,
			selected: true,
			profile: structuredClone(resolved.profile),
			prompts: structuredClone(resolved.prompts)
		};
		readBinding(binding, sessionId);
		this.store.writeDocument(`binding:${sessionId}`, prior?.revision ?? 0, binding);
		return binding;
	}
	clear(sessionId) {
		const prior = this.read(sessionId);
		if (!prior || !prior.binding.selected) return;
		this.store.writeDocument(`binding:${sessionId}`, prior.revision, {
			...prior.binding,
			selected: false
		});
	}
	/** Reserve identity before native dispatch; an existing selection cannot swap workers. */
	assignWorker(sessionId, expectedTask, workerId) {
		const prior = this.read(sessionId);
		if (!prior?.binding.selected || prior.binding.taskId !== expectedTask) throw new Error("Fusion binding changed before Worker dispatch");
		if (prior.binding.workerId && prior.binding.workerId !== workerId) throw new Error("Persistent Worker identity cannot change within a Fusion selection");
		const binding = {
			...prior.binding,
			workerId
		};
		readBinding(binding, sessionId);
		this.store.writeDocument(`binding:${sessionId}`, prior.revision, binding);
	}
	/** Release the reserved worker identity when a prepared order is cancelled before dispatch. */
	unassignWorker(sessionId, expectedTask, workerId) {
		const prior = this.read(sessionId);
		if (!prior?.binding.selected || prior.binding.taskId !== expectedTask || prior.binding.workerId !== workerId) return;
		this.store.writeDocument(`binding:${sessionId}`, prior.revision, {
			...prior.binding,
			workerId: void 0
		});
	}
	/** A new native user turn starts a new task while preserving the frozen pair. */
	rollover(sessionId, expectedTask, nextTask) {
		const prior = this.read(sessionId);
		if (!prior?.binding.selected || prior.binding.taskId !== expectedTask) throw new Error("Fusion binding changed during task rollover");
		const binding = {
			...prior.binding,
			taskId: nextTask
		};
		this.store.writeDocument(`binding:${sessionId}`, prior.revision, binding);
		return binding;
	}
	selected() {
		return this.store.listDocumentIds("binding:").map((id) => this.read(id.slice(8)).binding).filter((row) => row.selected);
	}
};
//#endregion
//#region src/host/subagent-seam.ts
/**
* Runtime detection for the DSH subagent seam.
* 0.2.1-rc.2 renamed continuable start/drain and removed `ctx.subagents.start`.
* 0.2.0-rc.2 still has the old names. Callers branch on the function that is
* actually present. They do not read a version string.
*/
const supportedDshVersions = "0.2.0-rc.2 and 0.2.1-rc.2";
/** Prefer `primary` (the 0.2.1 name) when both exist. */
function requireSubagentMethod(subagents, primary, fallback) {
	const api = subagents;
	if (typeof api[primary] === "function") return primary;
	if (typeof api[fallback] === "function") return fallback;
	throw new Error(`Fusion supports DeepSeek Harness ${supportedDshVersions}; this host has neither subagents.${primary} nor subagents.${fallback}`);
}
//#endregion
//#region src/host/native-worker.ts
/** Version-pinned public API adapter. It never calls an LLM adapter or runs a shell itself. */
var NativeWorkerTransport = class {
	ctx;
	provider;
	#flushed = /* @__PURE__ */ new WeakMap();
	constructor(ctx, provider = "spawn") {
		this.ctx = ctx;
		this.provider = provider;
	}
	assertAvailable() {
		const provider = this.ctx.subagents.getProvider(this.provider);
		if (!provider?.prepareContinuable || provider.inheritsParentContext !== false) throw new Error(`Fusion requires an independent continuable provider: ${this.provider}`);
	}
	/** Caller durably reserves the child and operation before entering this method. */
	async start(parent, request, signal) {
		this.assertAvailable();
		signal.throwIfAborted();
		if (this.ctx.agents.get(SessionId$1(request.childId))) throw new Error("Reserved Worker already exists; reconcile before retrying");
		const prompt = [{
			type: "text",
			text: request.brief
		}];
		const agentOptions = {
			provider: request.route.provider,
			model: request.route.model,
			...request.route.reasoningEffort === void 0 ? {} : { reasoningEffort: ReasoningEffortId(request.route.reasoningEffort) }
		};
		const maxDepth = (parent.session.header.delegationDepth ?? 0) + 1;
		const childId = SessionId$1(request.childId);
		const subagents = this.ctx.subagents;
		const accepted = requireSubagentMethod(subagents, "startActivation", "startContinuable") === "startActivation" ? await subagents.startActivation({
			provider: this.provider,
			label: request.label,
			childId,
			delivery: "parent",
			parent,
			prompt,
			agentOptions,
			maxDepth,
			request: {
				parent,
				prompt,
				agentOptions,
				maxDepth
			},
			signal
		}) : await subagents.startContinuable({
			provider: this.provider,
			label: request.label,
			childId,
			request: {
				parent,
				prompt,
				persona: request.persona,
				agentOptions,
				toolFilter: { allow: [...request.allowedTools] },
				maxDepth
			},
			signal
		});
		if (accepted.childId !== request.childId) throw new Error("Native Worker identity changed during creation");
		if (!accepted.messageId) throw new Error("Native Worker start did not accept an initial message");
		return {
			childId: accepted.childId,
			messageId: accepted.messageId
		};
	}
	/** Only Lead-authored feedback is sent through this public model-message API. */
	async continue(parent, childId, feedback, signal) {
		signal.throwIfAborted();
		return {
			childId,
			messageId: await this.ctx.subagents.sendMessage(parent, SessionId$1(childId), [{
				type: "text",
				text: feedback
			}], { signal })
		};
	}
	/**
	* Replace an in-flight generation through public cancellation, then deliver
	* to the same durable child. The caller must first exclude live/unknown
	* effectful tools. Otherwise use continue(), which steers at a step boundary.
	*/
	async interruptAndContinue(parent, childId, feedback, signal) {
		signal.throwIfAborted();
		await this.stop(parent, childId);
		signal.throwIfAborted();
		return this.continue(parent, childId, feedback, signal);
	}
	async settle(parent, childId, signal, yieldToSteering = false) {
		const child = this.#requireChild(parent, childId);
		let removeSteering = () => {};
		let onAbort;
		const aborted = new Promise((_, reject) => {
			onAbort = () => reject(Object.assign(/* @__PURE__ */ new Error("FUSION_NEXT_INTERRUPTED: the waiting call was cancelled; the Worker handoff is still running — wait again to collect its result."), { name: "AbortError" }));
			if (signal.aborted) onAbort();
			else signal.addEventListener("abort", onAbort, { once: true });
		});
		aborted.catch(() => {});
		try {
			if (yieldToSteering && !signal.aborted) {
				const steering = new Promise((resolve) => {
					const check = () => {
						if (parent.inbox.nextStep.some((message) => message.source.kind === "user")) resolve(true);
					};
					removeSteering = parent.ctx.on("agent/inbox/inserted", ({ agent }) => {
						if (agent === parent) check();
					});
					check();
				});
				if (await Promise.race([
					child.whenIdle().then(() => false),
					steering,
					aborted
				]) && !signal.aborted && child.status !== "idle") return void 0;
			}
			await Promise.race([child.whenIdle(), aborted]);
			if (this.ctx.agents.get(child.id) !== child) throw new Error("Worker residency changed; quiescence requires reconciliation");
			await this.#flushSettled(child);
			return child;
		} finally {
			removeSteering();
			signal.removeEventListener("abort", onAbort);
		}
	}
	async stop(parent, childId) {
		const child = this.#requireChild(parent, childId);
		if (child.status === "idle" && this.#flushed.get(child) === (child.session.snapshotEvents().at(-1)?.seq ?? 0)) return child;
		this.ctx.subagents.interrupt(child.id, {
			kind: "ancestor",
			agent: parent
		});
		await child.whenIdle();
		if (this.ctx.agents.get(child.id) !== child) throw new Error("Worker residency changed during stop");
		await this.#flushSettled(child);
		return child;
	}
	/**
	* 0.2.1 natural settlement flushes the child, then closes the persistence
	* handle. A stop that loses that race must not treat the closed handle as a
	* lost log. Any other flush failure still means the log is not durable.
	*/
	async #flushSettled(child) {
		try {
			if (!await this.ctx.sessions.flush(child.session)) throw new Error("Worker log persistence unavailable");
		} catch (error) {
			if (!(error instanceof Error) || error.name !== "SessionHandleClosedError") throw error;
			return;
		}
		this.#flushed.set(child, child.session.snapshotEvents().at(-1)?.seq ?? 0);
	}
	/** Native release owns quiescence, persistence and handle disposal across HMR. */
	async release(parent, childId) {
		const child = this.ctx.agents.get(SessionId$1(childId));
		if (child && child.session.header.parentSession !== parent.id) throw new Error("Cannot release another Lead’s child");
		const subagents = this.ctx.subagents;
		const drain = requireSubagentMethod(subagents, "drainChildren", "drainContinuableChildren");
		const ids = [SessionId$1(childId)];
		if (drain === "drainChildren") await subagents.drainChildren(parent, ids);
		else await subagents.drainContinuableChildren(parent, ids);
		if (this.ctx.agents.get(SessionId$1(childId))) throw new Error("Native Worker release did not prove absence");
	}
	#requireChild(parent, childId) {
		const child = this.ctx.agents.get(SessionId$1(childId));
		if (!child || child.session.header.parentSession !== parent.id) throw new Error("Worker is absent or is not this Lead’s child; reconcile its persisted session");
		return child;
	}
};
//#endregion
//#region src/context/guard.ts
function safetyTokens(contextWindow, policy, quality) {
	const fromFraction = Math.ceil(contextWindow * policy.safetyFraction);
	const base = Math.max(policy.minSafetyTokens, fromFraction);
	if (quality === "heuristic") return Math.max(base, Math.ceil(base * 1.25));
	return base;
}
/** Output reservation that fits the disclosed window. Leaves half the usable window for input. */
function fittedOutputReservation(contextWindow) {
	if (!Number.isSafeInteger(contextWindow) || contextWindow < 1) throw new Error("The configured model does not disclose a usable context window");
	const usable = contextWindow - Math.max(2048, Math.ceil(contextWindow * .05));
	if (usable < 2) throw new Error("The configured model context window cannot reserve output");
	return Math.floor(usable / 2);
}
function requestOutputReservation(contextWindow, requested, adapterDefault, testedCap, fallback = 8e3) {
	const fitted = fittedOutputReservation(contextWindow);
	for (const limit of [
		requested,
		adapterDefault,
		testedCap,
		fallback
	]) if (limit !== void 0 && (!Number.isSafeInteger(limit) || limit < 1)) throw new Error("Invalid model output token limit");
	return Math.min(requested ?? adapterDefault ?? testedCap ?? fallback, adapterDefault ?? Infinity, testedCap ?? Infinity, fitted);
}
function inputBudget(policy, contextWindow, maxOutput, quality = "exact") {
	const safety = safetyTokens(contextWindow, policy, quality);
	const hard = contextWindow - maxOutput - safety;
	return Math.max(0, Math.min(policy.targetInputTokens, hard));
}
function measureRequest(parts, policy) {
	return {
		inputTokens: parts.systemTokens + parts.messageTokens + parts.toolSchemaTokens + parts.cacheReadTokens,
		reservedOutputTokens: parts.reservedOutputTokens,
		contextWindow: parts.contextWindow,
		safetyTokens: safetyTokens(parts.contextWindow, policy, parts.quality),
		quality: parts.quality,
		requestDigest: digestOf(parts)
	};
}
function assertFinalBudget(measurement, policy) {
	const budget = inputBudget(policy, measurement.contextWindow, measurement.reservedOutputTokens, measurement.quality);
	if (measurement.inputTokens > budget) throw new FusionError(FUSION_NEXT_CONTEXT_BUDGET, `final request ${measurement.inputTokens} exceeds budget ${budget} (${measurement.quality})`);
}
function boundedOverflowRecovery(attempts) {
	if (attempts.length > 2) return "needs-decision";
	if (attempts.length === 2 && attempts[1].projectionTokens >= attempts[0].projectionTokens) return "needs-decision";
	return "continue";
}
//#endregion
//#region src/host/tool-table.ts
/**
* Rebuild one role's request tool table after another plugin replaces `assembled.tools`.
*
* The allowlist is a capability ceiling, not a list of mandatory registrations.
* It filters the assembled table, then permitted names are copied back from this
* agent's own registry: allowlisted tools (such as `job_output`) and Fusion's own
* `fusion_*` registrations. An undefined allowlist keeps the assembled table and only
* unions Fusion's registrations, so a writing role is not narrowed.
*
* A Fusion tool is required only when this agent actually registered it and the role
* may see it. `fusion_next_read_state` and `fusion_next_delegate_text` are registered only for
* model-like profiles; a legacy allowlist that merely names them is not incomplete.
* Restore copies every permitted registry tool before the gap is measured, so `missing`
* stays empty for every table this function itself builds. The field remains so a later
* change that stops restoring a registered tool fails closed instead of sending a
* silently smaller catalog.
*/
function projectRoleTools(input) {
	const always = input.always ?? [];
	const permitted = (name) => input.allowlist === void 0 || input.allowlist.includes(name) || always.includes(name);
	const tools = input.allowlist === void 0 ? [...input.assembled] : input.assembled.filter((tool) => permitted(tool.name));
	const present = new Set(tools.map((tool) => tool.name));
	const owned = input.registry.filter((tool) => tool.name.startsWith("fusion_"));
	const registered = new Set(input.registry.map((tool) => tool.name));
	const restore = input.allowlist === void 0 ? owned : input.registry.filter((tool) => permitted(tool.name));
	for (const tool of restore) {
		if (present.has(tool.name)) continue;
		tools.push(tool);
		present.add(tool.name);
	}
	const candidates = input.allowlist === void 0 ? owned.map((tool) => tool.name) : [...input.allowlist, ...always];
	return {
		tools,
		missing: [...new Set(candidates)].filter((name) => name.startsWith("fusion_") && registered.has(name)).filter((name) => !present.has(name))
	};
}
/** Shown when the role's Fusion tools cannot be restored. The request must not proceed as a normal completion. */
function fusionToolDiagnostic(missing) {
	return `FUSION_NEXT_TOOL_TABLE_INCOMPLETE: required Fusion tools are absent from this request (${missing.join(", ")}). Another plugin replaced the tool table and Fusion could not restore them from its own registry. Do not tell the user that delegation is unavailable by design, and do not end the task as completed with no work. Report this diagnostic.`;
}
//#endregion
//#region src/host/native-scopes.ts
/** Physical routing, prompt and tools live in the exact native Agent scope. */
var NativeFusionScopes = class NativeFusionScopes {
	callbacks;
	static installSeq = 0;
	#entries = /* @__PURE__ */ new Map();
	constructor(callbacks) {
		this.callbacks = callbacks;
	}
	get(agent) {
		const entry = this.#entries.get(agent.id);
		return entry?.agent === agent ? {
			binding: entry.binding,
			role: entry.role
		} : void 0;
	}
	assertReady(agent) {
		const entry = this.#entries.get(agent.id);
		if (!entry || entry.agent !== agent || !entry.ready) throw new Error("Fusion Agent scope is not ready; execution is blocked");
		const reason = (this.callbacks.canAccess ?? this.callbacks.canRequest)(agent, entry.binding, entry.role);
		if (reason) throw new Error(reason);
	}
	install(agent, binding, role) {
		const old = this.#entries.get(agent.id);
		if (old) {
			if (old.agent === agent && old.binding.taskId === binding.taskId && old.role === role && old.ready) return;
			if (old.agent !== agent && old.agent.status === "idle") this.detach(old.agent);
			else throw new Error("An existing Fusion scope must settle and detach before replacement");
		}
		const entry = {
			agent,
			binding: structuredClone(binding),
			role,
			dispose: [],
			ready: false,
			refreshTools: () => {}
		};
		entry.seq = ++NativeFusionScopes.installSeq;
		let resolveReady = () => {};
		const readyPromise = new Promise((resolve) => {
			resolveReady = resolve;
		});
		const entryWithGate = entry;
		entryWithGate.readyPromise = readyPromise;
		entryWithGate.resolveReady = () => resolveReady();
		this.#entries.set(agent.id, entry);
		const policy = entry.binding.profile.context[role];
		const scope = agent.ctx;
		try {
			let readOnlyTools;
			let presentationKey;
			const stageDisposers = [];
			const clearStage = () => {
				for (const dispose of stageDisposers.splice(0).reverse()) dispose();
			};
			entry.dispose.push(clearStage);
			entry.refreshTools = () => {
				const tools = this.callbacks.readOnlyTools?.(agent, entry.binding, role);
				const key = JSON.stringify(tools ?? null);
				if (key === presentationKey) return;
				clearStage();
				readOnlyTools = tools;
				if (tools !== void 0) {
					if (role === "worker") {
						if (typeof scope.tools.restrict !== "function") throw new Error("Fusion scope requires scope.tools.restrict; the connected Host SDK is incompatible");
						stageDisposers.push(scope.tools.restrict({ allow: tools.filter((name) => scope.tools.get(name) !== void 0) }));
					}
					if (typeof scope.tools.presentAs === "function") stageDisposers.push(scope.tools.presentAs("native"));
				}
				presentationKey = key;
			};
			entry.dispose.push(scope.tools.guard((exec) => {
				if (!entry.ready) return "Fusion scope initialization failed";
				return this.callbacks.canExecute(exec, entry.binding, role);
			}));
			entry.dispose.push(scope.on("session/event", (session, event) => {
				if (session !== agent.session || !entry.ready) return;
				if (event.type === "compaction/start") {
					this.callbacks.beforeCompaction?.(agent, entry.binding, role);
					return;
				}
				if (event.type !== "turn/start" || !this.callbacks.beforeTurn) return;
				try {
					const nextBinding = this.callbacks.beforeTurn(agent, entry.binding, role, event.data.turn);
					if (nextBinding.sessionId !== entry.binding.sessionId || digestOf(nextBinding.profile) !== digestOf(entry.binding.profile) || digestOf(nextBinding.prompts) !== digestOf(entry.binding.prompts)) throw new Error("Task rollover must preserve the frozen route and prompts");
					entry.binding = structuredClone(nextBinding);
					entry.refreshTools();
				} catch (error) {
					entry.ready = false;
					throw error;
				}
			}));
			entry.dispose.push(scope.on("agent/pre-step", async (payload, next) => {
				if (payload.agent !== agent) return { kind: "reject" };
				if (!entry.ready && entry.readyPromise) await Promise.race([entry.readyPromise, new Promise((resolve) => setTimeout(resolve, 15e3))]);
				if (!entry.ready) return { kind: "reject" };
				await this.callbacks.prepareRequest?.(agent, entry.binding, role, payload.signal);
				payload.signal.throwIfAborted();
				if (this.callbacks.canRequest(agent, entry.binding, role)) return { kind: "reject" };
				this.callbacks.beforeStep?.(agent, entry.binding, role);
				const decision = await next();
				if (decision.kind === "reject") return decision;
				const taskContext = this.callbacks.taskContext?.(agent, entry.binding, role);
				return {
					...decision,
					messages: [...decision.messages.filter((message) => !(message.source?.kind === "model-selection" && message.source.form === "notice" && message.source.summary.endsWith("fusion-next/auto"))).map((message) => this.callbacks.projectMessage?.(agent, entry.binding, role, message) ?? message), ...taskContext ? [taskContext] : []]
				};
			}, { prepend: true }));
			entry.dispose.push(scope.systemPrompt.section({
				name: "fusion-role",
				order: 90,
				text: entry.binding.prompts[role]
			}));
			entry.dispose.push(scope.on("system-prompt/assemble", async (_assembly, _context, next) => {
				entry.refreshTools();
				const assembled = await next();
				const route = this.callbacks.route?.(entry.binding, role) ?? entry.binding.profile[role];
				if (assembled.tools === void 0) return {
					...assembled,
					variables: {
						...assembled.variables ?? {},
						provider: route.provider,
						model: route.model
					}
				};
				const projected = projectRoleTools({
					assembled: assembled.tools,
					allowlist: readOnlyTools,
					registry: scope.tools.schemas(agent)
				});
				if (projected.missing.length) throw new Error(fusionToolDiagnostic(projected.missing));
				return {
					...assembled,
					variables: {
						...assembled.variables ?? {},
						provider: route.provider,
						model: route.model
					},
					tools: projected.tools
				};
			}, { prepend: true }));
			entry.dispose.push(scope.on("agent/request", async ({ agent: requesting, turn, step, signal }, next) => {
				this.assertReady(requesting);
				await this.callbacks.prepareRequest?.(requesting, entry.binding, role, signal);
				signal.throwIfAborted();
				const reason = this.callbacks.canRequest(requesting, entry.binding, role);
				if (reason) throw new Error(reason);
				const config = await next();
				const route = this.callbacks.route?.(entry.binding, role) ?? entry.binding.profile[role];
				this.callbacks.beforeRequest(agent, turn, step, entry.binding, role);
				const { reasoningEffort: _prior, ...rest } = config;
				if (entry.binding.profile.interactionMode === "model-like") {
					const { maxTokens, ...native } = rest;
					return {
						...native,
						...route.reasoningEffort !== void 0 ? { reasoningEffort: ReasoningEffortId(route.reasoningEffort) } : {},
						...role === "lead" && maxTokens !== void 0 ? { maxTokens } : {}
					};
				}
				const disclosed = this.callbacks.modelLimits ? await this.callbacks.modelLimits(route.provider, route.model) : void 0;
				const requested = role === "lead" ? config.maxTokens : void 0;
				const maxTokens = disclosed ? requestOutputReservation(disclosed.contextWindow, requested, disclosed.defaultMaxTokens, disclosed.testedOutputCap, policy.reserveOutputTokens) : Math.min(requested ?? policy.reserveOutputTokens, policy.reserveOutputTokens);
				return {
					...rest,
					maxTokens
				};
			}, { prepend: true }));
			entry.dispose.push(...this.callbacks.installTools(scope, agent, entry.binding, role));
			entry.refreshTools();
			entry.ready = true;
			entry.resolveReady?.();
		} catch (error) {
			throw error;
		}
	}
	/** Refresh at the persisted state transition, before native prompt providers run. */
	refreshTools(agent) {
		const entry = this.#entries.get(agent.id);
		if (entry?.agent !== agent || !entry.ready) return;
		try {
			entry.refreshTools();
		} catch (error) {
			entry.ready = false;
			throw error;
		}
	}
	/**
	* Caller owns quiescence and the original session-controller model selection.
	* Removing these listeners reveals that existing selection; it does not mutate
	* a request header or fabricate a replacement global default.
	*/
	detach(agent) {
		const entry = this.#entries.get(agent.id);
		if (!entry || entry.agent !== agent) return;
		if (agent.status !== "idle") throw new Error("Cannot detach Fusion while the native Agent is running");
		entry.ready = false;
		for (const dispose of entry.dispose.reverse()) dispose();
		this.#entries.delete(agent.id);
	}
};
process.platform;
const isShellTool = (name) => name === "bash" || name === "pwsh";
process.platform;
//#endregion
//#region src/host/native-effects.ts
/** Public native dispatch journal; it never wraps a provider or invents a PID. */
var NativeEffects = class {
	ctx;
	store;
	callbacks;
	#live = /* @__PURE__ */ new Map();
	#waiters = /* @__PURE__ */ new Map();
	#jobs = /* @__PURE__ */ new Map();
	#registry;
	constructor(ctx, store, callbacks) {
		this.ctx = ctx;
		this.store = store;
		this.callbacks = callbacks;
		this.#registry = ctx.get("jobs");
	}
	install() {
		const offJobs = this.#registry?.events.subscribe({ owners: "all" }, (event) => {
			if (event.type !== "settled") return;
			const snapshot = event.job;
			const live = this.#jobs.get(snapshot.id);
			if (live && snapshot.owner === live.agent.id) this.#settled(live, snapshot);
		});
		const offTools = this.ctx.on("tools/execute", async (exec, next) => {
			const owner = exec.agent && this.callbacks.owner(exec.agent);
			if (owner && exec.name === "job_output") {
				this.#waiters.set(exec.token, exec.agent);
				try {
					return await next();
				} finally {
					this.#waiters.delete(exec.token);
				}
			}
			if (!owner || !this.callbacks.track(exec)) return next();
			const taskId = owner.binding.taskId, id = `native-effect:${taskId}:${randomUUID()}`;
			let row;
			try {
				row = {
					schemaVersion: 1,
					taskId,
					agentId: exec.agent.id,
					role: owner.role,
					callId: exec.callId,
					rootCallId: exec.rootCallId,
					toolName: exec.name,
					processId: process.pid,
					startedAt: (/* @__PURE__ */ new Date()).toISOString(),
					state: "dispatch-started",
					arguments: this.store.putArtifact(taskId, Buffer.from(JSON.stringify({
						tool: exec.name,
						arguments: exec.arguments
					})), "application/vnd.dsh-fusion.native-effect+json")
				};
				this.store.writeDocument(id, 0, row);
			} catch (error) {
				this.callbacks.failed(exec.agent, error);
				throw error;
			}
			this.#live.set(exec.token, taskId);
			try {
				const result = await next();
				const value = !result.isError && result.value;
				const resultJob = !result.isError ? value : null;
				const jobKind = resultJob?.kind;
				if (isShellTool(exec.name) && !result.isError && (exec.arguments.run_in_background === true || jobKind === "background" || jobKind === "promoted")) {
					if (jobKind !== "background" && jobKind !== "promoted" || typeof resultJob?.jobId !== "string") throw new Error(`Native ${exec.name} returned a live job without an authoritative jobId`);
					const snapshot = this.#registry.get(JobId(resultJob.jobId), exec.agent?.id);
					if (snapshot.kind !== exec.name || snapshot.owner !== exec.agent.id) throw new Error("Native job ownership mismatch");
					const maximum = this.callbacks.backgroundMaxMs ? this.callbacks.backgroundMaxMs(exec, owner.binding) : 6e4;
					const requested = exec.arguments.timeoutMs;
					const timeout = typeof requested === "number" && Number.isFinite(requested) && requested > 0 ? Math.min(requested, maximum ?? Infinity) : maximum;
					if (timeout !== null && (!Number.isFinite(timeout) || timeout <= 0)) throw new Error("Background command deadline is unavailable");
					row = {
						...row,
						nativeJob: {
							id: snapshot.id,
							startedAt: snapshot.startedAt,
							deadlineAt: timeout === null ? null : Date.now() + Math.ceil(timeout),
							status: snapshot.status
						}
					};
					const timer = timeout === null ? void 0 : setTimeout(() => {
						try {
							this.#assertJob(row, this.#registry.get(snapshot.id, exec.agent?.id));
							this.#registry.kill(snapshot.id, exec.agent?.id, "Fusion command deadline elapsed");
						} catch (error) {
							const live = this.#jobs.get(snapshot.id);
							if (live) this.#uncertain(live, error);
							else this.callbacks.failed(exec.agent, error);
						}
					}, timeout);
					timer?.unref();
					const live = {
						id,
						row,
						agent: exec.agent,
						timer
					};
					this.#jobs.set(snapshot.id, live);
					this.store.writeDocument(id, 1, row);
					if (snapshot.status !== "running" && snapshot.status !== "stopping") this.#settled(live, snapshot);
					return result;
				}
				this.store.writeDocument(id, 1, {
					...row,
					state: "returned",
					endedAt: (/* @__PURE__ */ new Date()).toISOString(),
					nativeIsError: Boolean(result.isError)
				});
				return result;
			} catch (error) {
				if (row.nativeJob && this.#jobs.has(row.nativeJob.id)) try {
					this.#registry.kill(JobId(row.nativeJob.id), exec.agent?.id, "Fusion job tracking failed");
				} catch (stopError) {
					this.callbacks.failed(exec.agent, stopError);
				}
				try {
					this.store.writeDocument(id, this.store.readDocument(id).revision, {
						...row,
						state: "outcome-unknown",
						endedAt: (/* @__PURE__ */ new Date()).toISOString()
					});
				} catch (recordingError) {
					this.callbacks.failed(exec.agent, recordingError);
				}
				this.callbacks.failed(exec.agent, error);
				throw error;
			} finally {
				this.#live.delete(exec.token);
			}
		}, { prepend: true });
		return () => {
			offTools();
			offJobs?.();
			for (const live of this.#jobs.values()) clearTimeout(live.timer);
		};
	}
	#settled(live, snapshot) {
		try {
			this.#assertJob(live.row, snapshot);
			if (snapshot.status === "running" || snapshot.status === "stopping") return;
			const row = this.store.readDocument(live.id);
			this.store.writeDocument(live.id, row.revision, {
				...live.row,
				nativeJob: {
					...live.row.nativeJob,
					status: snapshot.status,
					...snapshot.detail ? { detail: snapshot.detail } : {}
				},
				state: snapshot.status === "failed" ? "outcome-unknown" : "returned",
				endedAt: (/* @__PURE__ */ new Date()).toISOString()
			});
			if (snapshot.status === "failed") this.callbacks.failed(live.agent, /* @__PURE__ */ new Error("Native job failed without proven process quiescence"));
		} catch (error) {
			this.callbacks.failed(live.agent, error);
		} finally {
			clearTimeout(live.timer);
			this.#jobs.delete(snapshot.id);
		}
	}
	#assertJob(row, snapshot) {
		if (!row.nativeJob || row.processId !== process.pid || snapshot.id !== row.nativeJob.id || snapshot.kind !== row.toolName || snapshot.owner !== row.agentId || snapshot.startedAt !== row.nativeJob.startedAt) throw new Error("Native job identity changed; inspect rather than adopting or replaying it");
	}
	#uncertain(live, error) {
		clearTimeout(live.timer);
		this.#jobs.delete(live.row.nativeJob.id);
		try {
			const row = this.store.readDocument(live.id);
			this.store.writeDocument(live.id, row.revision, {
				...live.row,
				state: "outcome-unknown"
			});
		} catch (recordingError) {
			this.callbacks.failed(live.agent, recordingError);
		}
		this.callbacks.failed(live.agent, error);
	}
	backgroundProblem(exec) {
		if (!this.#registry || !exec.agent || !this.ctx.tools.get("job_output", exec.agent?.id) || !this.ctx.tools.get("job_kill", exec.agent?.id)) return "Background commands require the native jobs runtime and visible job_output/job_kill tools";
	}
	jobProblem(exec, taskId) {
		const id = exec.arguments.job_id;
		if (typeof id !== "string" || !exec.agent || !this.#registry) return "Native job identity is required";
		const record = this.store.listDocumentIds(`native-effect:${taskId}:`).map((key) => this.store.readDocument(key).value).find((row) => row.nativeJob?.id === id && row.agentId === exec.agent.id && row.taskId === taskId);
		if (!record) return "Only native jobs recorded for this Agent and current Fusion task may be accessed";
		try {
			this.#assertJob(record, this.#registry.get(JobId(id), exec.agent?.id));
		} catch (error) {
			return String(error);
		}
	}
	waitingForJob(agent) {
		return [...this.#waiters.values()].includes(agent);
	}
	onlyBackgroundPending(taskId, exec) {
		const pending = this.pendingFor(taskId, exec);
		return pending.length > 0 && pending.every(({ id, record }) => record.state === "dispatch-started" && record.nativeJob && this.#jobs.get(record.nativeJob.id)?.id === id);
	}
	async stopJobs(taskId) {
		for (const live of [...this.#jobs.values()].filter((job) => job.row.taskId === taskId)) try {
			const id = JobId(live.row.nativeJob.id);
			this.#assertJob(live.row, this.#registry.get(id, live.agent.id));
			this.#registry.kill(id, live.agent.id, "Fusion task is stopping");
			const done = await this.#registry.wait(id, 1e4, live.agent.id);
			if (done.status === "running" || done.status === "stopping" || done.status === "failed") throw new Error("Native job did not prove process quiescence; keep the writer and inspect");
			if (this.#jobs.has(id)) this.#settled(live, done);
		} catch (error) {
			this.#uncertain(live, error);
			throw error;
		}
	}
	/**
	* Pending effects excluding the tool call that contains the current dispatch.
	* Under PTC every tool runs inside a run_code dispatch, which is itself a tracked
	* mutation whose effect stays 'dispatch-started' for the entire inner call — a
	* work-order gate that treats it as unsettled deadlocks. Only ancestor calls are
	* excluded: the containing call's id prefixes inner ':ptc:N' ids (and equals their
	* rootCallId). Sibling inner calls (X:ptc:0 pending while X:ptc:1 runs) still count.
	* `agentId` further restricts the count to one Agent's own effects: submit/finish
	* gates ask "does THIS Agent still owe settlement", not "is anyone in the task busy".
	*/
	pendingFor(taskId, exec, agentId) {
		const pending = this.pending(taskId);
		if (!exec) return agentId ? pending.filter(({ record }) => record.agentId === agentId) : pending;
		return pending.filter(({ record }) => record.callId !== exec.callId && record.callId !== exec.rootCallId && !exec.callId.startsWith(`${record.callId}:`) && (agentId === void 0 || record.agentId === agentId));
	}
	pending(taskId) {
		return this.store.listDocumentIds(`native-effect:${taskId}:`).flatMap((id) => {
			const record = this.store.readDocument(id).value;
			if (record.schemaVersion !== 1 || record.taskId !== taskId || !record.agentId || !record.toolName || !Number.isSafeInteger(record.processId) || record.processId <= 0 || ![
				"dispatch-started",
				"returned",
				"outcome-unknown",
				"inspected"
			].includes(record.state)) throw new Error("Native effect journal requires migration or inspection");
			if (record.nativeJob && (typeof record.nativeJob.id !== "string" || !Number.isSafeInteger(record.nativeJob.startedAt) || record.nativeJob.deadlineAt !== null && !Number.isSafeInteger(record.nativeJob.deadlineAt))) throw new Error("Native job journal requires migration or inspection");
			return record.state === "dispatch-started" || record.state === "outcome-unknown" ? [{
				id,
				record
			}] : [];
		});
	}
	assertInspection(taskId, effectsStopped) {
		const pending = this.pending(taskId);
		if (!pending.length) return;
		if ([...this.#live.values()].includes(taskId) || [...this.#jobs.values()].some((job) => job.row.taskId === taskId)) throw new Error("Native tool execution is still live; stop and settle it before recovery");
		if (!effectsStopped) throw new Error(`有 ${pending.length} 项原生操作在中断时未收尾。Host 退出不代表命令及子进程已停止。请先检查并停止这些操作，再使用 /fusion-next recover --effects-stopped <检查记录>。`);
		for (const { record } of pending) {
			if (record.processId === process.pid) continue;
			try {
				process.kill(record.processId, 0);
				throw new Error("The recorded effect owner is still live; settle it before recovery");
			} catch (error) {
				if (error.code !== "ESRCH") throw error;
			}
		}
	}
	inspected(taskId, evidence, effectsStopped) {
		this.assertInspection(taskId, effectsStopped);
		if (!evidence) throw new Error("Effect inspection evidence is required");
		for (const { id, record } of this.pending(taskId)) this.store.writeDocument(id, this.store.readDocument(id).revision, {
			...record,
			state: "inspected",
			inspectionEvidence: evidence,
			quiescenceBasis: "explicit-user-inspection"
		});
	}
};
//#endregion
//#region src/host/native-request.ts
/** Auxiliary native calls may carry a session without an active Agent turn. */
function nativeRequestAgent(ctx, request) {
	const initiator = ctx.agents.currentInitiator();
	return (request.sessionId === void 0 ? void 0 : ctx.agents.get(request.sessionId)) ?? initiator;
}
//#endregion
//#region src/host/native-keepalive.ts
/** R19 recovered schedule. */
const KEEPALIVE_INTERVAL_MS = 285e3;
/**
* The line appended after the copied prefix. maxTokens: 1 is not enough on its own: the ChatGPT Codex route
* rejects an output cap and pi-ai omits it, so a ping that said "continue" made the Lead think and call tools
* (live log: median 463 output tokens, all ending in tool calls). Measured 2026-10-01 on gpt-6-astra (Codex):
* "Reply OK" answered "OK" in 5 output tokens, 0 reasoning, no tool calls, 16/16 with tools still offered,
* full cache hit; "continue" called tools 8/8 and a bare "OK" read as approval and produced a plan.
* Tool choice and reasoning effort cannot change here: effort is part of OpenAI's cache key (effort "low"
* missed the cache entirely) and DSH requests carry no tool_choice.
*/
const KEEPALIVE_PROMPT = "Reply OK";
const systemClock = {
	now: () => performance.now(),
	schedule: (callback, delay) => {
		const timer = setTimeout(callback, delay);
		timer.unref();
		return () => clearTimeout(timer);
	}
};
/** Retains only plugin-owned requests in memory; never replays timers on restart. */
/** Explicit per-role choice; unset is automatic for the Lead (armed only on observed cache reads), off for the Worker. */
function keepalivePolicy(binding, role) {
	return binding.profile.cacheKeepalive?.[role] ?? (role === "lead" ? "auto" : false);
}
var NativeCacheKeepalive = class {
	ctx;
	store;
	auxiliary;
	callbacks;
	clock;
	#series = /* @__PURE__ */ new Map();
	/** Start time of each agent's previous model request (real or ping): the wait before the next one. */
	#lastStart = /* @__PURE__ */ new Map();
	#pending = /* @__PURE__ */ new Map();
	#dispose = [];
	#closed = false;
	constructor(ctx, store, auxiliary, callbacks, clock = systemClock) {
		this.ctx = ctx;
		this.store = store;
		this.auxiliary = auxiliary;
		this.callbacks = callbacks;
		this.clock = clock;
	}
	#active(row) {
		if (this.#closed || this.#series.get(row.agent.id) !== row || row.controller.signal.aborted || this.ctx.agents.get(row.agent.id) !== row.agent) return false;
		const current = this.callbacks.owner(row.agent);
		return Boolean(current?.binding.selected && current.binding.taskId === row.owner.binding.taskId && current.binding.profile.digest === row.owner.binding.profile.digest && current.role === row.owner.role && this.callbacks.routeKey?.(current) === row.routeKey && this.#policy(current, row.input.provider, row.input.model).mode !== "off" && this.callbacks.allowed(row.agent, current));
	}
	#policy(owner, provider, model) {
		if (this.callbacks.policy) return this.callbacks.policy(owner, provider, model);
		const legacy = keepalivePolicy(owner.binding, owner.role);
		return {
			mode: legacy === true ? "on" : legacy === false ? "off" : "auto",
			intervalMs: KEEPALIVE_INTERVAL_MS
		};
	}
	#invalidate(row) {
		if (this.#series.get(row.agent.id) === row) this.#series.delete(row.agent.id);
		row.cancelTimer?.();
		row.cancelTimer = void 0;
		row.detachSourceAbort?.();
		row.detachSourceAbort = void 0;
		row.controller.abort();
	}
	#persist(row) {
		row.record.updatedAt = (/* @__PURE__ */ new Date()).toISOString();
		try {
			row.revision = this.store.writeDocument(`keepalive:${row.record.taskId}:${row.record.id}`, row.revision, row.record);
			return true;
		} catch (error) {
			this.#invalidate(row);
			this.callbacks.failed(row.agent, `Cache keepalive tracking failed: ${String(error)}`);
			return false;
		}
	}
	#stop(row, reason) {
		this.#invalidate(row);
		if (row.record.state === "stopped") return;
		row.record.state = "stopped";
		row.record.stopReason = reason;
		this.#persist(row);
	}
	stopSession(sessionId, reason) {
		const row = this.#series.get(sessionId);
		if (row) this.#stop(row, reason);
		return Promise.all([...this.#pending].filter(([, item]) => item.sessionId === sessionId).map(([pending]) => pending)).then(() => void 0);
	}
	stopTask(taskId, reason) {
		for (const row of this.#series.values()) if (row.record.taskId === taskId) this.#stop(row, reason);
		return Promise.all([...this.#pending].filter(([, item]) => item.taskId === taskId).map(([pending]) => pending)).then(() => void 0);
	}
	/** Called again after asynchronous context measurement, before spend admission. */
	assertRequest(agent, request) {
		const extra = this.auxiliary.get(request);
		if (!extra) return;
		const row = this.#series.get(agent.id);
		if (!row || row.record.id !== extra.seriesId || row.record.attempts !== extra.iteration || row.record.taskId !== extra.taskId || row.record.sessionId !== extra.sessionId || row.record.profileDigest !== extra.profileDigest || row.record.role !== extra.role || !this.#active(row)) throw new Error("Cache keepalive generation is no longer active");
		request.signal?.throwIfAborted();
	}
	#arm(row, deadline) {
		if (!this.#active(row)) {
			this.#stop(row, "inactive");
			return;
		}
		row.record.state = "scheduled";
		if (!this.#persist(row)) return;
		row.cancelTimer = this.clock.schedule(() => {
			row.cancelTimer = void 0;
			const pending = Promise.resolve().then(() => this.#ping(row)).finally(() => {
				this.#pending.delete(pending);
			});
			this.#pending.set(pending, {
				sessionId: row.agent.id,
				taskId: row.record.taskId
			});
		}, Math.max(0, deadline - this.clock.now()));
	}
	async #ping(row) {
		try {
			if (!this.#active(row)) {
				this.#stop(row, "inactive");
				return;
			}
			const nextDeadline = this.clock.now() + row.intervalMs;
			row.record.attempts++;
			row.record.state = "inflight";
			if (!this.#persist(row)) return;
			const request = {
				...structuredClone(row.input),
				maxTokens: 1,
				signal: row.controller.signal,
				messages: [...structuredClone(row.input.messages), createUserMessage({
					content: [{
						type: "text",
						text: KEEPALIVE_PROMPT
					}],
					source: { kind: "plugin:fusion-next" }
				})]
			};
			this.auxiliary.tag(request, {
				purpose: "cache-keepalive",
				taskId: row.record.taskId,
				sessionId: row.agent.id,
				profileDigest: row.owner.binding.profile.digest,
				role: row.owner.role,
				seriesId: row.record.id,
				iteration: row.record.attempts
			});
			let success = false;
			for await (const chunk of this.ctx.llm.stream(request)) if (chunk.type === "finish") success = [
				"stop",
				"max-tokens",
				"tool-calls"
			].includes(chunk.reason.kind);
			if (success) row.record.successes++;
			if (row.controller.signal.aborted || this.#series.get(row.agent.id) !== row) {
				this.#persist(row);
				return;
			}
			if (!success) {
				this.#stop(row, "request-failed");
				return;
			}
			if (row.record.attempts >= 11) {
				this.#stop(row, "attempt-limit");
				return;
			}
			this.#arm(row, nextDeadline);
		} catch {
			this.#stop(row, row.controller.signal.aborted ? "cancelled" : "request-failed");
		}
	}
	install() {
		const manager = this;
		this.#dispose.push(this.ctx.on("llm/stream", async function* (request, next) {
			const agent = nativeRequestAgent(manager.ctx, request), owner = agent && manager.callbacks.owner(agent);
			const extra = manager.auxiliary.get(request), ping = extra?.purpose === "cache-keepalive";
			if (!agent || !owner || !manager.callbacks.observe || extra && !ping || !ping && (!isAgentLoopRequest(request) || request.purpose !== void 0)) {
				yield* next();
				return;
			}
			const started = manager.clock.now(), previous = manager.#lastStart.get(agent.id);
			manager.#lastStart.set(agent.id, started);
			let usage;
			for await (const chunk of next()) {
				if (chunk.type === "usage") usage = chunk.usage;
				yield chunk;
			}
			if (!usage || previous === void 0) return;
			const cacheRead = usage.cacheReadTokens ?? 0, input = usage.inputTokens ?? 0;
			try {
				manager.callbacks.observe(owner, request.provider, request.model, {
					gapSeconds: (started - previous) / 1e3,
					ping,
					hit: cacheHit(cacheRead, input),
					cacheRead,
					input,
					output: usage.outputTokens ?? 0
				});
			} catch {}
		}));
		this.#dispose.push(this.ctx.on("llm/stream", async function* (request, next) {
			if (!manager.auxiliary.get(request) && (isAgentLoopRequest(request) || request.purpose === "compaction")) {
				const agent = nativeRequestAgent(manager.ctx, request);
				if (agent) await manager.stopSession(agent.id, request.purpose === "compaction" ? "compaction" : "new-generation");
			}
			yield* next();
		}, { prepend: true }));
		this.#dispose.push(this.ctx.on("llm/stream", async function* (request, next) {
			const agent = nativeRequestAgent(manager.ctx, request), owner = agent && manager.callbacks.owner(agent);
			const policy = owner ? manager.#policy(owner, request.provider, request.model) : void 0;
			if (!agent || !owner || !policy || policy.mode === "off" || manager.auxiliary.get(request) || !isAgentLoopRequest(request) || request.purpose !== void 0 || manager.#closed) {
				yield* next();
				return;
			}
			const input = structuredClone({
				provider: request.provider,
				model: request.model,
				messages: request.messages,
				tools: request.tools,
				system: request.system,
				temperature: request.temperature,
				reasoningEffort: request.reasoningEffort,
				stop: request.stop,
				sessionId: request.sessionId
			});
			const row = {
				agent,
				owner,
				input,
				routeKey: manager.callbacks.routeKey?.(owner),
				started: manager.clock.now(),
				controller: new AbortController(),
				revision: 0,
				intervalMs: policy.intervalMs,
				record: {
					schemaVersion: 1,
					id: randomUUID(),
					taskId: owner.binding.taskId,
					sessionId: agent.id,
					role: owner.role,
					profileDigest: owner.binding.profile.digest,
					inputDigest: digestOf(input),
					createdAt: (/* @__PURE__ */ new Date()).toISOString(),
					updatedAt: (/* @__PURE__ */ new Date()).toISOString(),
					state: "generating",
					attempts: 0,
					successes: 0
				}
			};
			manager.#series.set(agent.id, row);
			if (request.signal) {
				const abort = () => {
					manager.stopSession(agent.id, "native-cancel");
				};
				request.signal.addEventListener("abort", abort, { once: true });
				row.detachSourceAbort = () => request.signal.removeEventListener("abort", abort);
			}
			if (!manager.#persist(row)) throw new Error("Cache keepalive request tracking failed");
			let success = false, cached = policy.mode === "on";
			try {
				for await (const chunk of next()) {
					if (chunk.type === "finish") success = [
						"stop",
						"max-tokens",
						"tool-calls"
					].includes(chunk.reason.kind);
					if (chunk.type === "usage" && (chunk.usage.cacheReadTokens ?? 0) > 0) cached = true;
					yield chunk;
				}
			} finally {
				if (success && cached && !request.signal?.aborted && manager.#series.get(agent.id) === row) manager.#arm(row, row.started + row.intervalMs);
				else manager.#stop(row, cached ? "generation-stopped" : "no-cache-evidence");
			}
		}));
		this.#dispose.push(this.ctx.on("session/event", (session, event) => {
			if (event.type === "compaction/start") this.stopSession(session.id, "compaction");
			if (event.type !== "turn/end") return;
			const row = this.#series.get(session.id);
			if (row && (event.data.reason.kind !== "completed" || row.owner.role === "worker" || !this.#active(row))) this.stopSession(session.id, "agent-stopping");
		}));
		this.#dispose.push(this.ctx.on("agent/status", ({ status }) => {
			if (status !== "idle") return;
			for (const row of this.#series.values()) if (!this.#active(row)) this.stopSession(row.agent.id, "agent-idle");
		}));
		this.#dispose.push(this.ctx.on("agent/disposed", ({ agent }) => {
			this.#lastStart.delete(agent.id);
			this.stopSession(agent.id, "agent-disposed");
		}));
	}
	async close() {
		this.#closed = true;
		for (const row of this.#series.values()) this.#stop(row, "runtime-closing");
		await Promise.all(this.#pending.keys());
		for (const dispose of this.#dispose.reverse()) dispose();
	}
};
//#endregion
//#region src/host/native-auxiliary.ts
/** Plugin-local identity: do not widen or misuse the Host's purpose enum. */
var NativeAuxiliaryRequests = class {
	#requests = /* @__PURE__ */ new WeakMap();
	tag(request, metadata) {
		this.#requests.set(request, Object.freeze(metadata));
	}
	get(request) {
		return this.#requests.get(request);
	}
};
//#endregion
//#region src/host/native-usage.ts
/**
* DSH counters are disjoint; missing provider fields retain unknown applicability.
*
* A counter is known only when the provider reported a real finite number.
* Gateways that omit completion_tokens_details send reasoningTokens as null
* (seen on some claude-opus-5.5 routes). known(null) throws INVALID_TOKEN_COUNT
* inside the llm/stream hook and aborts the turn, so null and NaN stay unknown.
*/
function billFromNativeUsage(usage) {
	const count = (value) => value === void 0 || value === null || !Number.isFinite(value) ? unknown() : known(value);
	return {
		uncachedInput: count(usage?.inputTokens),
		cacheRead: count(usage?.cacheReadTokens),
		output: count(usage?.outputTokens),
		cacheWrite: usage?.cacheWriteTokens === void 0 || usage.cacheWriteTokens === null || !Number.isFinite(usage.cacheWriteTokens) ? { kind: "unknown" } : {
			kind: "aggregate",
			rateKey: "provider-cache-write-rate-unknown",
			tokens: known(usage.cacheWriteTokens)
		},
		reasoning: {
			kind: "unknown",
			tokens: count(usage?.reasoningTokens)
		}
	};
}
/** Read-only stream observer. It neither changes requests nor orchestrates agents. */
function observeNativeUsage(ctx, store, ownerOf, auxiliary) {
	return ctx.on("llm/stream", async function* (options, next) {
		const agent = nativeRequestAgent(ctx, options);
		const owner = agent && ownerOf(agent);
		if (!owner || !agent) {
			yield* next();
			return;
		}
		const extra = auxiliary?.get(options);
		const id = `native:${randomUUID()}`;
		const key = {
			provider: options.provider,
			model: options.model,
			requestId: id,
			attemptId: id,
			contractDigest: digestOf({
				host: "0.1.5-rc.2",
				input: "disjoint",
				reasoning: "unknown",
				missing: "unknown"
			})
		};
		let ledger = newLedger(key);
		let revision = 0, summaryRevision = 0;
		let sequence = 0;
		let lastUsage;
		const record = {
			schemaVersion: 1,
			taskId: owner.taskId,
			sessionId: agent.id,
			role: owner.role,
			purpose: extra?.purpose ?? options.purpose ?? "conversation",
			nativeInvocationId: id,
			maxOutputTokens: options.maxTokens ?? null,
			...options.reasoningEffort === void 0 ? {} : { reasoningEffort: options.reasoningEffort },
			...extra ? { auxiliary: {
				seriesId: extra.seriesId,
				iteration: extra.iteration
			} } : {},
			startedAt: (/* @__PURE__ */ new Date()).toISOString(),
			endedAt: null,
			nativeStreamInvocations: 1,
			upstreamHttpCalls: null,
			outcome: "entered",
			ledger,
			actualSubscriptionChargeUsd: null,
			apiEquivalentCostUsd: null
		};
		const persist = () => {
			const value = {
				...record,
				ledger
			};
			[revision, summaryRevision] = store.writeDocuments([{
				id: `usage:${owner.taskId}:${id}`,
				expectedRevision: revision,
				value
			}, {
				id: `usage-index:${owner.taskId}:${id}`,
				expectedRevision: summaryRevision,
				value: usageSummary(value)
			}]);
		};
		persist();
		try {
			for await (const chunk of next()) {
				if (chunk.type === "usage") {
					lastUsage = chunk.usage;
					ledger = ingestDurable(ledger, {
						id: `${id}:${++sequence}`,
						key,
						sequence,
						mode: "snapshot",
						bill: billFromNativeUsage(lastUsage)
					});
					persist();
				}
				if (chunk.type === "finish") {
					const kind = chunk.reason.kind;
					record.outcome = [
						"stop",
						"tool-calls",
						"max-tokens",
						"aborted",
						"error"
					].includes(kind) ? kind : "unknown";
					record.endedAt = (/* @__PURE__ */ new Date()).toISOString();
					if ([
						"stop",
						"tool-calls",
						"max-tokens"
					].includes(kind) && lastUsage) ledger = ingestDurable(ledger, {
						id: `${id}:final`,
						key,
						sequence: ++sequence,
						mode: "final",
						bill: billFromNativeUsage(lastUsage)
					});
					persist();
				}
				yield chunk;
			}
		} finally {
			if (record.endedAt === null) {
				record.outcome = options.signal?.aborted ? "aborted" : "unknown";
				record.endedAt = (/* @__PURE__ */ new Date()).toISOString();
				persist();
			}
		}
	});
}
//#endregion
//#region src/host/native-activity.ts
const prefix = "activity-link:";
const visibleTools = /* @__PURE__ */ new Set([
	"bash",
	"pwsh",
	"read",
	"write",
	"edit",
	"glob",
	"grep",
	"job_output",
	"job_kill",
	"str_replace_editor"
]);
const parentPrefix = (parentId) => `activity:${encodeURIComponent(parentId)}:`;
const callPrefix = (parentId, callId) => `${parentPrefix(parentId)}${encodeURIComponent(callId)}:`;
/** Paginated read-only data for a plugin-owned tool view; no runtime activation. */
function readFusionActivity(store, parentId, callId, after = -1) {
	if (!Number.isSafeInteger(after) || after < -1) throw new Error("Invalid activity cursor");
	const rows = store.listDocumentIds(callPrefix(parentId, callId)).map((id) => store.readDocument(id).value).filter((row) => row.source.seq > after).sort((a, b) => a.source.seq - b.source.seq);
	const events = rows.slice(0, 100);
	const link = store.listDocumentIds(prefix).map((id) => store.readDocument(id).value).find((row) => row.parentId === parentId && row.callId === callId);
	return {
		events,
		cursor: events.at(-1)?.source.seq ?? after,
		more: rows.length > events.length,
		done: !link || link.done === true
	};
}
/** Old conversations remain readable through the public, non-activating history
* API. Correlate accepted message ids, never timing guesses or model narration.
* This fallback neither rewrites the old log nor creates a replacement Worker.
*/
async function readHistoricalFusionActivity(ctx, store, parentId, callId, after = -1) {
	const cached = readFusionActivity(store, parentId, callId, after);
	if (store.listDocumentIds(prefix).some((id) => {
		const row = store.readDocument(id).value;
		return row.parentId === parentId && row.callId === callId;
	}) || !parentId || !callId) return cached;
	const tasks = store.listTaskIds().map((id) => store.load(id)).filter((task) => task.parent === parentId);
	for (const task of tasks) {
		if (!task.acceptedChild) continue;
		const history = store.events(task.taskId);
		const prepared = history.find((event) => event.type === "work-order/prepared" && event.causeId === callId);
		const delivery = store.listDocumentIds(`worker-delivery:${task.taskId}:`).map((id) => store.readDocument(id).value).find((row) => row.causeId === callId && row.state === "accepted");
		const accepted = prepared && history.find((event) => event.type === "child/accepted" && event.seq > prepared.seq);
		const messageId = delivery?.messageId ?? (accepted?.type === "child/accepted" ? accepted.payload.messageId : void 0);
		if (!messageId) continue;
		const [parent, child] = await Promise.all([ctx.sessionQuery.readSession(SessionId$1(parentId)), ctx.sessionQuery.readSession(SessionId$1(task.acceptedChild))]);
		if (child.session.parentSession !== parentId) throw new Error("Fusion activity child ownership mismatch");
		const call = parent.events.find((event) => event.type === "tool/call" && event.data.callId === callId);
		if (!call || call.type !== "tool/call" || ![
			"fusion_next_explore",
			"fusion_next_delegate",
			"fusion_next_rework"
		].includes(call.data.name)) return cached;
		const start = child.events.find((event) => event.type === "user/message" && event.data.id === messageId);
		if (!start) return cached;
		const acceptedIds = new Set(tasks.flatMap((item) => store.events(item.taskId).flatMap((event) => event.type === "child/accepted" && event.payload.child === task.acceptedChild ? [event.payload.messageId] : [])));
		const end = child.events.find((event) => event.seq > start.seq && event.type === "user/message" && acceptedIds.has(event.data.id))?.seq ?? Infinity;
		const calls = /* @__PURE__ */ new Set();
		const all = [];
		for (const source of child.events) {
			if (source.seq <= start.seq) continue;
			if (source.type === "tool/call" && source.seq < end && visibleTools.has(source.data.name)) calls.add(source.data.callId);
			else if (source.type !== "tool/result" || !calls.has(source.data.message.source.callId)) continue;
			if (source.type !== "tool/call" && source.type !== "tool/result") continue;
			all.push({
				schemaVersion: 1,
				taskId: task.taskId,
				childSessionId: task.acceptedChild,
				parentCallId: callId,
				turn: call.data.turn,
				step: call.data.step,
				anchorSeq: call.seq,
				source
			});
		}
		const remaining = all.filter((event) => event.source.seq > after), events = remaining.slice(0, 100);
		return {
			events,
			cursor: events.at(-1)?.source.seq ?? after,
			more: remaining.length > events.length,
			done: task.control.mode === "completed" || child.events.at(-1)?.type === "turn/end"
		};
	}
	return cached;
}
/** Copies actual Worker tool events into plugin-owned presentation storage only.
* Model history still contains solely the Lead's native messages and reports.
* Stored source coordinates make replay/HMR idempotent without executing tools.
*/
var NativeFusionActivity = class {
	ctx;
	store;
	#dispose = [];
	#pending = Promise.resolve();
	#seen = /* @__PURE__ */ new WeakMap();
	#calls = /* @__PURE__ */ new WeakMap();
	errors = /* @__PURE__ */ new Map();
	constructor(ctx, store) {
		this.ctx = ctx;
		this.store = store;
		this.#dispose.push(ctx.on("session/event", (session, event) => {
			if (!session.header.parentSession) return;
			if (event.type === "turn/end") {
				this.#enqueue(() => this.#ended(session));
				return;
			}
			if (event.type !== "tool/call" && event.type !== "tool/result") return;
			this.#enqueue(() => this.#mirror(session, event, false));
		}));
		this.#dispose.push(ctx.on("agent/created", ({ agent }) => {
			this.#replay(agent.session);
			for (const child of ctx.sessions.list()) if (child.header.parentSession === agent.id) this.#replay(child);
		}));
		for (const session of ctx.sessions.list()) this.#replay(session);
	}
	/** Called before each native delivery. No inference, dispatch or approval. */
	link(parent, childId, taskId, callId) {
		const call = parent.snapshotEvents().find((event) => event.type === "tool/call" && event.data.callId === callId);
		if (!call || call.type !== "tool/call") return;
		const id = `${prefix}${childId}:${call.seq}`;
		if (this.store.readDocument(id)) return;
		this.store.writeDocument(id, 0, {
			parentId: parent.id,
			childId,
			taskId,
			callId,
			turn: call.data.turn,
			step: call.data.step,
			anchorSeq: call.seq,
			fromSeq: this.ctx.sessions.get(SessionId$1(childId))?.seq ?? null
		});
	}
	#enqueue(action) {
		this.#pending = this.#pending.then(action).catch((error) => {
			this.errors.set("presentation", String(error));
			this.ctx.logger.warn("Fusion activity presentation failed: %s", String(error));
		});
	}
	#replay(session) {
		if (!session.header.parentSession) return;
		this.#enqueue(() => {
			for (const event of session.snapshotEvents()) {
				if (event.type === "tool/call" || event.type === "tool/result") this.#mirror(session, event, true);
				if (event.type === "turn/end") this.#ended(session, event.seq, false);
			}
		});
	}
	#ended(child, throughSeq = child.seq, live = true) {
		for (const id of this.store.listDocumentIds(`${prefix}${child.id}:`)) {
			const row = this.store.readDocument(id), link = row.value;
			if ((link.fromSeq === null ? live : link.fromSeq <= throughSeq) && !link.done) this.store.writeDocument(id, row.revision, {
				...link,
				done: true
			});
		}
	}
	#mirror(child, event, replay) {
		const parent = child.header.parentSession && this.ctx.sessions.get(child.header.parentSession);
		if (!parent) return;
		let seen = this.#seen.get(parent), calls = this.#calls.get(parent);
		if (!seen || !calls) {
			seen = /* @__PURE__ */ new Set();
			calls = /* @__PURE__ */ new Map();
			for (const id of this.store.listDocumentIds(parentPrefix(parent.id))) {
				const activity = this.store.readDocument(id).value;
				seen.add(`${activity.childSessionId}:${activity.source.seq}`);
				if (activity.source.type === "tool/call") calls.set(`${activity.childSessionId}:${activity.source.data.callId}`, activity);
			}
			this.#seen.set(parent, seen);
			this.#calls.set(parent, calls);
		}
		const key = `${child.id}:${event.seq}`;
		if (seen.has(key)) return;
		const sourceCallId = event.type === "tool/call" ? event.data.callId : event.data.message.source.callId;
		const callKey = `${child.id}:${sourceCallId}`;
		let origin = calls.get(callKey);
		if (event.type === "tool/call") {
			if (!visibleTools.has(event.data.name)) return;
			const row = this.store.listDocumentIds(`${prefix}${child.id}:`).map((id) => ({
				id,
				...this.store.readDocument(id)
			})).filter((row) => row.value.parentId === parent.id).sort((a, b) => b.value.anchorSeq - a.value.anchorSeq).find((row) => {
				const link = row.value;
				return link.fromSeq === null ? !replay : event.seq >= link.fromSeq;
			});
			if (!row) return;
			let link = row.value;
			if (link.fromSeq === null) {
				link = {
					...link,
					fromSeq: event.seq
				};
				this.store.writeDocument(row.id, row.revision, link);
			}
			origin = {
				schemaVersion: 1,
				taskId: link.taskId,
				childSessionId: child.id,
				parentCallId: link.callId,
				turn: link.turn,
				step: link.step,
				anchorSeq: link.anchorSeq + .5 - .5 / (event.seq + 2)
			};
		}
		if (!origin) return;
		const activity = {
			...origin,
			source: event
		};
		const id = `${callPrefix(parent.id, origin.parentCallId)}${String(event.seq).padStart(12, "0")}`;
		if (!this.store.readDocument(id)) this.store.writeDocument(id, 0, activity);
		seen.add(key);
		if (event.type === "tool/call") calls.set(callKey, activity);
	}
	async flush() {
		await this.#pending;
	}
	async close() {
		for (const dispose of this.#dispose.splice(0).reverse()) dispose();
		await this.flush();
	}
};
//#endregion
//#region src/host/model-output.ts
/** Public model metadata only; resolving limits does not start a model turn. */
async function resolveModelOutputLimits(ctx, provider, model) {
	const info = await ctx.llm.resolveModelInfo(provider, model);
	const contextWindow = info.context?.contextWindow;
	if (!Number.isSafeInteger(contextWindow) || Number(contextWindow) <= 0) throw new Error("The configured model does not disclose a usable context window");
	fittedOutputReservation(Number(contextWindow));
	return {
		contextWindow: Number(contextWindow),
		defaultMaxTokens: info.defaultMaxTokens
	};
}
//#endregion
//#region src/host/runtime-v3.ts
const docId = (taskId) => `runtime:${taskId}`;
function readRuntime(store, taskId) {
	const row = store.readDocument(docId(taskId));
	if (!row) return void 0;
	const value = row.value;
	return value && value.schemaVersion === 3 && value.taskId === taskId ? value : void 0;
}
function createRuntime(store, taskId) {
	const now = (/* @__PURE__ */ new Date()).toISOString();
	const runtime = {
		schemaVersion: 3,
		taskId,
		createdAt: now,
		updatedAt: now,
		dispatches: []
	};
	store.writeDocument(docId(taskId), 0, runtime);
	return runtime;
}
/** Read-modify-write with CAS retry; the only writer is this coordinator. */
function updateRuntime(store, taskId, mutate) {
	for (let attempt = 0; attempt < 8; attempt += 1) {
		const row = store.readDocument(docId(taskId));
		if (!row) throw new Error(`Fusion runtime doc missing for ${taskId}`);
		const runtime = structuredClone(row.value);
		mutate(runtime);
		runtime.updatedAt = (/* @__PURE__ */ new Date()).toISOString();
		try {
			store.writeDocument(docId(taskId), row.revision, runtime);
			return runtime;
		} catch {}
	}
	throw new Error(`Fusion runtime update kept racing for ${taskId}`);
}
/** A dispatch the Lead tool call is still settled on (or lost to steering). */
function liveDispatch(runtime) {
	return runtime?.dispatches.findLast((record) => record.status === "running");
}
function beginDispatch(store, taskId, instruction) {
	const record = {
		id: `dispatch-${randomUUID()}`,
		instruction,
		startedAt: (/* @__PURE__ */ new Date()).toISOString(),
		status: "running"
	};
	updateRuntime(store, taskId, (runtime) => {
		const live = liveDispatch(runtime);
		if (live) live.status = "interrupted";
		runtime.dispatches.push(record);
		if (runtime.dispatches.length > 40) runtime.dispatches.splice(0, runtime.dispatches.length - 40);
	});
	return record;
}
function finishDispatch(store, taskId, id, patch) {
	updateRuntime(store, taskId, (runtime) => {
		const record = runtime.dispatches.find((item) => item.id === id);
		if (!record) return;
		Object.assign(record, patch);
		if (record.status === "running") record.status = "completed";
		record.endedAt = record.endedAt ?? (/* @__PURE__ */ new Date()).toISOString();
	});
}
//#endregion
//#region src/host/workspace.ts
const SNAPSHOT_EXCLUSIONS = [
	".git",
	"node_modules",
	"__pycache__",
	".pytest_cache",
	".mypy_cache",
	".ruff_cache"
];
const FALLBACK_EXCLUSIONS = [
	...SNAPSHOT_EXCLUSIONS,
	".venv",
	"venv",
	".tox",
	".nox",
	".eggs",
	".gradle",
	".next",
	".turbo",
	".cache"
];
function workspacePath(root, path) {
	if (!path || isAbsolute(path) || path.includes("\0")) throw new Error("Workspace paths must be nonempty relative paths");
	const absolute = resolve(root, path);
	const rel = relative(root, absolute);
	if (rel === ".." || rel.startsWith(`..${sep}`) || isAbsolute(rel)) throw new Error("Path escapes the workspace");
	let current = root;
	for (const part of rel.split(sep).filter(Boolean)) {
		current = join(current, part);
		try {
			if (lstatSync(current).isSymbolicLink()) throw new Error("Workspace path traverses a symlink");
		} catch (error) {
			if (error.code !== "ENOENT") throw error;
		}
	}
	return absolute;
}
const MAX_ENTRIES = 2e5;
const LARGE_FILE = 16777216;
/**
* Source files git would consider (tracked plus untracked, minus the repository's ignore rules), relative
* to root; undefined outside a git work tree or without git. Ignore rules are the project's own statement
* of what is not source (virtualenvs, build output, caches), so no per-ecosystem list has to guess.
*/
function gitSourceFiles(root) {
	try {
		const out = execFileSync("git", [
			"-C",
			root,
			"ls-files",
			"-z",
			"--cached",
			"--others",
			"--exclude-standard"
		], {
			encoding: "buffer",
			maxBuffer: 536870912,
			stdio: [
				"ignore",
				"pipe",
				"ignore"
			],
			env: {
				...process.env,
				GIT_OPTIONAL_LOCKS: "0"
			}
		});
		return [...new Set(out.toString("utf8").split("\0").filter(Boolean))].sort();
	} catch {
		return;
	}
}
function snapshotWorkspace(cwd) {
	const root = realpathSync.native(cwd);
	const entries = [];
	const excluded = (path) => path.split("/").some((part) => SNAPSHOT_EXCLUSIONS.includes(part));
	function add(full, path, stat) {
		if (stat.isSymbolicLink()) entries.push({
			path,
			kind: "symlink",
			digest: sha256Hex(readlinkSync(full)),
			executable: false
		});
		else if (stat.isFile()) {
			const contents = stat.size > LARGE_FILE ? void 0 : readFileSync(full);
			const after = lstatSync(full);
			if (after.ino !== stat.ino || after.mtimeMs !== stat.mtimeMs || after.size !== (contents?.length ?? stat.size)) throw new Error("Workspace changed while taking the snapshot");
			entries.push({
				path,
				kind: "file",
				digest: contents ? sha256Hex(contents) : sha256Hex(`large:${stat.size}:${stat.mtimeMs}`),
				executable: Boolean(stat.mode & 73)
			});
		} else if (!stat.isDirectory()) throw new Error(`Unsupported source file type: ${path}`);
		if (entries.length > MAX_ENTRIES) throw new Error("Workspace exceeds the bounded file manifest; choose a smaller project root");
	}
	function visit(directory) {
		for (const name of readdirSync(directory).sort()) {
			const full = join(directory, name);
			const stat = lstatSync(full);
			if (stat.isDirectory()) {
				if (!FALLBACK_EXCLUSIONS.includes(name)) visit(full);
				continue;
			}
			add(full, relative(root, full).split(sep).join("/"), stat);
		}
	}
	const listed = gitSourceFiles(root);
	if (listed) for (const path of listed) {
		if (excluded(path)) continue;
		const full = join(root, ...path.split("/"));
		let stat;
		try {
			stat = lstatSync(full);
		} catch (error) {
			if (error.code === "ENOENT") continue;
			throw error;
		}
		if (!stat.isDirectory()) add(full, path, stat);
	}
	else visit(root);
	const manifest = {
		schemaVersion: 1,
		root,
		excludedDirectoryNames: listed ? SNAPSHOT_EXCLUSIONS : FALLBACK_EXCLUSIONS,
		...listed ? { ignoreRules: "git-exclude-standard" } : {},
		entries
	};
	return {
		...manifest,
		id: SnapshotId(`source:${digestOf(manifest)}`)
	};
}
function changedPaths(before, after) {
	if (before.root !== after.root) throw new Error("Workspace root changed");
	const old = new Map(before.entries.map((entry) => [entry.path, digestOf(entry)]));
	const now = new Map(after.entries.map((entry) => [entry.path, digestOf(entry)]));
	return [.../* @__PURE__ */ new Set([...old.keys(), ...now.keys()])].filter((path) => old.get(path) !== now.get(path)).sort();
}
//#endregion
//#region src/host/audit-v3.ts
const DIFF_CAP = 12e3;
const UNTRACKED_CAP = 6;
const UNTRACKED_BYTES = 8192;
const FILE_READ_CAP = 262144;
const VERIFY_TIMEOUT_MS = 12e4;
const VERIFY_MAX = 6;
const LITERAL_MAX = 20;
const TEST_PATH = /(^|\/)(tests?|__tests__|spec)\/|\.(test|spec)\.[jt]sx?$|_test\.go$|test_.*\.py$/i;
const run = (file, args, cwd, timeoutMs = 3e4) => new Promise((resolve) => {
	execFile(file, [...args], {
		cwd,
		encoding: "utf8",
		timeout: timeoutMs,
		maxBuffer: 4194304
	}, (error, stdout, stderr) => {
		resolve({
			code: error ? typeof error.code === "number" ? error.code : -1 : 0,
			out: String(stdout ?? "") + (stderr ? "\n" + String(stderr) : "")
		});
	});
});
const tail = (text, chars) => text.length <= chars ? text : "…" + text.slice(-chars);
const cap = (text, chars) => text.length <= chars ? text : text.slice(0, chars) + "\n…[diff truncated at " + chars + " chars]";
function isGitWorkspace(root) {
	return existsSync(join(root, ".git"));
}
/**
* Unified diff for the Lead's review. Git path: `git diff HEAD` covers
* tracked edits; untracked files arrive inline (bounded). Non-git workspaces
* get no diff — changedFiles still reports the snapshot-level path set.
*/
async function collectDiff(root, _changed) {
	if (!isGitWorkspace(root)) return void 0;
	const parts = [];
	const diff = await run("git", [
		"-c",
		"color.ui=false",
		"diff",
		"HEAD",
		"--"
	], root);
	if (diff.out.trim()) parts.push(cap(diff.out, DIFF_CAP));
	const untracked = (await run("git", ["status", "--porcelain=v1"], root)).out.split("\n").map((line) => line.match(/^\?\?\s+(.+)$/)?.[1]?.trim().replace(/^"|"$/g, "")).filter((path) => Boolean(path)).slice(0, UNTRACKED_CAP);
	for (const path of untracked) try {
		const body = await readFile(workspacePath(root, path), "utf8");
		const text = body.length > UNTRACKED_BYTES ? body.slice(0, UNTRACKED_BYTES) + "\n…[file truncated]" : body;
		parts.push("--- /dev/null\n+++ b/" + path + "\n" + text.split("\n").map((line) => "+" + line).join("\n"));
	} catch {}
	const joined = parts.join("\n");
	return joined.trim() ? cap(joined, DIFF_CAP) : void 0;
}
/** Quoted spans the instruction explicitly required (backtick / single / double), 6-120 chars. */
function instructionLiterals(instruction) {
	const found = /* @__PURE__ */ new Set();
	const pattern = /* @__PURE__ */ new RegExp("[`'\"\\s]*([`'\"])(.{6,120}?)\\1", "g");
	for (const match of instruction.matchAll(pattern)) {
		const text = match[2].trim();
		if (!text || /\s{3,}/.test(text) || text.includes("\n")) continue;
		found.add(text);
		if (found.size >= LITERAL_MAX) break;
	}
	return [...found];
}
const readCapped = async (root, path) => {
	try {
		const body = await readFile(workspacePath(root, path), "utf8");
		return body.length > FILE_READ_CAP ? body.slice(0, FILE_READ_CAP) : body;
	} catch {
		return;
	}
};
/**
* Static warnings — never gates, always advisory:
* 1. mutating an existing test file (especially deleting its lines) is the
*    classic worker cheat; surfaced for Lead judgement, not auto-denied.
* 2. literals the instruction quoted but no changed file contains.
*/
async function staticAudit(root, base, changed, instruction) {
	const basePaths = new Set(base?.entries.map((entry) => entry.path) ?? []);
	const mutatedExistingTestFiles = changed.filter((path) => TEST_PATH.test(path) && basePaths.has(path));
	let deletedTestLines = -1;
	if (mutatedExistingTestFiles.length && isGitWorkspace(root)) {
		deletedTestLines = 0;
		const numstat = await run("git", [
			"diff",
			"--numstat",
			"HEAD",
			"--",
			...mutatedExistingTestFiles
		], root);
		for (const line of numstat.out.split("\n")) {
			const cols = line.trim().split(/\s+/);
			const removed = Number(cols[1]);
			if (Number.isFinite(removed)) deletedTestLines += removed;
		}
	}
	const missingPromptLiterals = [];
	const literals = instructionLiterals(instruction);
	if (literals.length && changed.length) {
		const contents = [];
		for (const path of changed.slice(0, 24)) {
			const text = await readCapped(root, path);
			if (text !== void 0) contents.push(text);
		}
		const haystack = contents.join("\n");
		for (const literal of literals) if (!haystack.includes(literal)) missingPromptLiterals.push(literal);
	}
	return {
		mutatedExistingTestFiles,
		deletedTestLines,
		missingPromptLiterals
	};
}
/** Run the caller-supplied verify commands serially; each bounded to 120s. */
async function runVerification(root, commands) {
	const records = [];
	for (const command of commands.slice(0, VERIFY_MAX)) {
		const { code, out } = await run("bash", ["-lc", command], root, VERIFY_TIMEOUT_MS);
		records.push(code === 0 ? {
			command,
			exitCode: 0,
			summary: tail(out.trim() || "exit 0", 300)
		} : {
			command,
			exitCode: code,
			summary: tail(out.trim() || "exit " + code, 300),
			failureTail: tail(out.trim(), 1200)
		});
	}
	return records;
}
/** Diff + snapshot compare used by dispatch; shared so repair rounds reuse it. */
async function auditWorkspace(input) {
	const { root, base, candidate, instruction } = input;
	const changedFiles = base && candidate ? changedPaths(base, candidate) : [];
	const [unifiedDiff, staticAudits] = await Promise.all([collectDiff(root, changedFiles), staticAudit(root, base, changedFiles, instruction)]);
	return {
		changedFiles,
		unifiedDiff,
		staticAudits
	};
}
//#endregion
//#region src/host/dispatch-v3.ts
const MAX_REPAIR_ROUNDS = 2;
const WORKER_BRIEF_HEADER = [
	"# Work order",
	"Implement the instruction below directly in this workspace.",
	"",
	"Rules:",
	"- Act, do not ask. If something is ambiguous, pick the most reasonable interpretation and note it in your report.",
	"- Preserve every literal, identifier, and requirement from the instruction exactly.",
	"- NEVER weaken, delete, skip, or rewrite existing tests. If a test fails, fix the implementation.",
	"- Batch your tool calls: read/edit/test in as few steps as you safely can.",
	"- Verify the change yourself before ending your turn (typecheck/build/tests that apply).",
	"- End your turn with a compact report: files changed, verification performed, anything left undone.",
	"",
	"# Instruction"
].join("\n");
const repairBrief = (failures, warnings) => [
	"The automated audit of your previous work found problems. Fix the implementation — do NOT edit or weaken the tests, do not work around the failing commands.",
	"",
	...failures,
	...warnings.map((warning) => "Warning: " + warning),
	"",
	"When fixed, end your turn with a compact report."
].join("\n");
function workerSummary(child) {
	const last = child.session.snapshotEvents().findLast((event) => event.type === "assistant/message" && !event.data.interrupted);
	return (last?.type === "assistant/message" ? last.data.message.content : []).filter((block) => block.type === "text").map((block) => String(block.text ?? "")).join("\n").trim() || "(worker ended without a final report)";
}
async function childAlive(ctx, parent, childId) {
	if (!childId) return false;
	const child = ctx.agents.get(SessionId$1(childId));
	return Boolean(child && child.session.header.parentSession === parent.id && (child.status === "idle" || child.status === "running"));
}
async function runDispatch(deps, agent, binding, args, signal, callId) {
	const { ctx, store, transport, activity, workerTools } = deps;
	const taskId = binding.taskId;
	const runtime = readRuntime(store, taskId);
	if (runtime?.paused) throw new Error("Fusion is paused — resume with /fusion-next resume before dispatching.");
	if (!runtime) throw new Error("Fusion runtime missing; reselect the pair.");
	const root = agent.session.header.cwd;
	const instruction = (args.instruction ?? "").trim();
	const reset = args.reset_worker === true;
	let childId = runtime.worker?.childId;
	if (reset && childId) {
		try {
			await transport.stop(agent, childId);
			await transport.release(agent, childId);
		} catch {}
		childId = void 0;
		updateRuntime(store, taskId, (rt) => {
			rt.worker = void 0;
		});
	}
	const alive = await childAlive(ctx, agent, childId);
	if (!alive && !instruction) throw new Error(childId ? "The worker session is gone — call fusion_dispatch with reset_worker:true and an instruction to start a fresh one." : "fusion_dispatch needs an instruction to start the worker.");
	const record = beginDispatch(store, taskId, instruction || "(collect pending worker)");
	const finish = (patch) => {
		try {
			finishDispatch(store, taskId, record.id, patch);
		} catch {}
	};
	try {
		if (!alive) {
			childId = randomUUID();
			store.writeDocument("child:" + childId, 0, {
				parent: agent.id,
				taskId,
				lane: "worker"
			});
			const allowedTools = workerTools.filter((name) => {
				try {
					return Boolean(ctx.tools.get(name));
				} catch {
					return false;
				}
			});
			await transport.start(agent, {
				childId,
				label: "Fusion Worker",
				brief: WORKER_BRIEF_HEADER + instruction,
				route: binding.profile.worker,
				persona: "",
				allowedTools
			}, signal);
			updateRuntime(store, taskId, (rt) => {
				rt.worker = { childId };
			});
		} else if (instruction) await transport.continue(agent, childId, WORKER_BRIEF_HEADER + instruction, signal);
		if (callId && childId) try {
			activity.link(agent.session, childId, String(taskId), callId);
		} catch {}
		const base = root ? snapshotWorkspace(root) : void 0;
		let repairRounds = 0;
		for (;;) {
			const child = await transport.settle(agent, childId, signal, true);
			if (!child) {
				finish({ status: "steered" });
				return {
					workerStatus: "running",
					workerSummary: "(worker still running — the user steered this session; call fusion_dispatch without instruction to collect it)",
					changedFiles: [],
					staticAudits: {
						mutatedExistingTestFiles: [],
						deletedTestLines: -1,
						missingPromptLiterals: []
					},
					verification: [],
					repairRounds,
					note: "Yielded to user steering; worker handoff continues in the background."
				};
			}
			const summary = workerSummary(child);
			const candidate = root ? snapshotWorkspace(root) : void 0;
			const { changedFiles, unifiedDiff, staticAudits } = root ? await auditWorkspace({
				root,
				base,
				candidate,
				instruction
			}) : {
				changedFiles: [],
				unifiedDiff: void 0,
				staticAudits: {
					mutatedExistingTestFiles: [],
					deletedTestLines: -1,
					missingPromptLiterals: []
				}
			};
			const verification = args.verify_commands?.length && root ? await runVerification(root, args.verify_commands) : [];
			const failures = verification.filter((record) => record.exitCode !== 0);
			const warnings = [
				...staticAudits.mutatedExistingTestFiles.map((path) => "existing test file modified: " + path),
				...staticAudits.deletedTestLines > 0 ? [staticAudits.deletedTestLines + " existing test lines deleted"] : [],
				...staticAudits.missingPromptLiterals.map((literal) => "instruction literal missing from changed files: " + literal)
			];
			if ((failures.length > 0 || staticAudits.deletedTestLines > 0) && repairRounds < MAX_REPAIR_ROUNDS && !signal.aborted) {
				repairRounds += 1;
				const feedback = repairBrief(failures.map((record) => "- `" + record.command + "` exited " + record.exitCode + ":\n" + (record.failureTail ?? record.summary)), warnings);
				await transport.continue(agent, childId, feedback, signal);
				continue;
			}
			const status = failures.length ? "failed" : "completed";
			finish({
				status,
				changedFiles,
				checks: verification.map(({ command, exitCode, summary: s }) => ({
					command,
					exitCode,
					summary: s
				})),
				warnings,
				repairRounds,
				...failures.length ? { error: failures[0].command + " exited " + failures[0].exitCode } : {}
			});
			return {
				workerStatus: status === "failed" ? "failed" : "completed",
				workerSummary: summary,
				changedFiles,
				unifiedDiff,
				staticAudits,
				verification,
				repairRounds
			};
		}
	} catch (error) {
		finish({
			status: "interrupted",
			error: error instanceof Error ? error.message : String(error)
		});
		throw error;
	}
}
/** Live-dispatch check for the prefix router: worker work in flight keeps the Lead streaming. */
function dispatchInFlight(store, taskId) {
	try {
		return Boolean(liveDispatch(readRuntime(store, taskId)));
	} catch {
		return true;
	}
}
//#endregion
//#region src/host/coordinator.ts
const READ_TOOLS = /* @__PURE__ */ new Set([
	"read",
	"grep",
	"glob",
	"tgrep",
	"read_image",
	"job_output"
]);
const EXPLORE_LANE_TOOLS = [
	"read",
	"grep",
	"glob",
	"tgrep",
	"read_image"
];
const READ_STREAK_SOFT_CAP = 8;
const DIRECT_WRITE_SOFT_CAP = 40;
const textOutput = {
	schema: { type: "string" },
	render: (_args, text) => [{
		type: "text",
		text
	}]
};
const linesOf = (text) => text.split("\n").length;
/** Heuristic: lines a single tool call writes directly (heredoc/redirect aware). */
const directWriteLines = (name, args) => {
	const value = args ?? {};
	switch (name) {
		case "write": return typeof value.content === "string" ? linesOf(value.content) : 0;
		case "edit": return typeof value.new_string === "string" ? linesOf(value.new_string) : 0;
		case "run_code": return typeof value.code === "string" ? linesOf(value.code) : 0;
		case "bash":
		case "pwsh": {
			const command = value.command;
			return typeof command === "string" && /(<<|>)/.test(command) ? linesOf(command) : 0;
		}
		default: return 0;
	}
};
var FusionCoordinator = class {
	ctx;
	store;
	options;
	transport;
	auxiliary = new NativeAuxiliaryRequests();
	activity;
	bindings;
	scopes;
	effects;
	keepalive;
	#dispose = [];
	#readStreak = /* @__PURE__ */ new Map();
	#streakWarned = /* @__PURE__ */ new Set();
	#closed = false;
	constructor(ctx, store, options) {
		this.ctx = ctx;
		this.store = store;
		this.options = options;
		this.transport = new NativeWorkerTransport(ctx);
		this.bindings = new BindingRepository(store);
		this.activity = new NativeFusionActivity(ctx, store);
		this.scopes = new NativeFusionScopes({
			route: (binding, role) => role === "worker" ? binding.profile.worker : binding.profile.lead,
			beforeTurn: (_agent, binding) => binding,
			beforeRequest: () => {},
			canAccess: (_agent, binding) => this.#denyPaused(binding.taskId),
			canRequest: (_agent, binding) => this.#denyPaused(binding.taskId),
			canExecute: () => void 0,
			modelLimits: (provider, model) => resolveModelOutputLimits(ctx, provider, model),
			readOnlyTools: (agent, _binding, role) => this.#readOnlyTools(agent, role),
			installTools: (scope, agent, binding, role) => this.#installTools(scope, agent, binding, role)
		});
		this.effects = new NativeEffects(ctx, store, {
			owner: (agent) => this.owner(agent),
			track: (exec) => !READ_TOOLS.has(exec.name),
			failed: (_agent, error) => this.ctx.logger.error("[fusion-next] native effect failed: " + String(error))
		});
		this.keepalive = new NativeCacheKeepalive(ctx, store, this.auxiliary, {
			owner: (agent) => this.owner(agent),
			allowed: (_agent, owner) => !readRuntime(store, owner.binding.taskId)?.paused,
			failed: (_agent, reason) => this.ctx.logger.warn("[fusion-next] keepalive stopped: " + reason),
			policy: (owner) => {
				const pref = keepalivePolicy(owner.binding, owner.role);
				return {
					mode: pref === true ? "on" : pref === false ? "off" : "auto",
					intervalMs: 285e3
				};
			}
		});
		this.#dispose.push(ctx.on("agent/created", async ({ agent }) => {
			try {
				this.#attachKnown(agent);
			} catch (error) {
				this.ctx.logger.warn("[fusion-next] child attach failed: " + (error instanceof Error ? error.message : String(error)));
			}
		}), ctx.on("tools/execute", async (exec, next) => this.#interceptExplore(exec, next), { prepend: true }), this.effects.install(), observeNativeUsage(ctx, store, (agent) => {
			const owner = this.owner(agent);
			return owner ? {
				taskId: owner.binding.taskId,
				role: owner.role
			} : void 0;
		}, this.auxiliary));
		this.keepalive.install();
		this.#dispose.push(() => {
			this.keepalive.close();
			this.activity.close();
		});
		for (const agent of ctx.agents.list()) try {
			this.#attachKnown(agent);
		} catch {}
	}
	owner(agent) {
		const row = this.bindings.read(agent.id);
		if (row?.binding.selected) return {
			binding: row.binding,
			role: "lead"
		};
		const doc = this.store.readDocument("child:" + agent.id)?.value;
		if (!doc?.parent || !doc.taskId) return void 0;
		if (doc.parent !== agent.session.header.parentSession) return void 0;
		const parent = this.bindings.read(String(doc.parent));
		if (!parent?.binding.selected || String(parent.binding.taskId) !== String(doc.taskId)) return void 0;
		return {
			binding: parent.binding,
			role: "worker"
		};
	}
	#attachKnown(agent) {
		const doc = this.store.readDocument("child:" + agent.id)?.value;
		if (!doc?.parent || !doc.taskId) return;
		if (doc.parent !== agent.session.header.parentSession) return;
		const row = this.bindings.read(String(doc.parent));
		if (!row?.binding.selected || String(row.binding.taskId) !== String(doc.taskId)) return;
		this.scopes.install(agent, row.binding, "worker");
	}
	/** Explore-lane children are fenced read-only; worker lane keeps the host sandbox. */
	#readOnlyTools(agent, role) {
		if (role !== "worker") return void 0;
		if ((this.store.readDocument("child:" + agent.id)?.value)?.lane !== "explore") return void 0;
		return EXPLORE_LANE_TOOLS.filter((name) => {
			try {
				return Boolean(this.ctx.tools.get(name, agent.id));
			} catch {
				return false;
			}
		});
	}
	#denyPaused(taskId) {
		const runtime = readRuntime(this.store, taskId);
		return runtime?.paused ? bi("Fusion 已暂停（" + runtime.paused + "）— /fusion-next resume 恢复。", "Fusion is paused (" + runtime.paused + ") — /fusion-next resume to continue.") : void 0;
	}
	selectBeforeAssembly(agent, resolved) {
		if (agent.session.header.parentSession) return;
		if (this.bindings.read(agent.id)?.binding.selected) return;
		const taskId = TaskId("fusion-task-" + randomUUID());
		this.store.create({
			schemaVersion: 1,
			id: randomUUID(),
			taskId,
			seq: 1,
			revision: 1,
			type: "task/created",
			createdAt: (/* @__PURE__ */ new Date()).toISOString(),
			causeId: "model-selector",
			payload: {
				parent: SessionId(agent.id),
				selection: {
					kind: "profile",
					profileId: resolved.profile.id
				}
			}
		});
		const binding = this.bindings.select(agent.id, taskId, resolved);
		createRuntime(this.store, taskId);
		this.scopes.install(agent, binding, "lead");
	}
	async select(agent, resolved) {
		this.transport.assertAvailable();
		await agent.runMaintenance(async () => {
			this.selectBeforeAssembly(agent, resolved);
		});
	}
	async clear(agent, options = {}) {
		const row = this.bindings.read(agent.id);
		if (row?.binding.selected) {
			const childId = readRuntime(this.store, row.binding.taskId)?.worker?.childId;
			if (childId) try {
				await this.transport.stop(agent, childId);
				await this.transport.release(agent, childId);
			} catch {}
			try {
				this.effects.stopJobs(row.binding.taskId);
			} catch {}
			try {
				this.keepalive.stopTask(row.binding.taskId, "cleared");
			} catch {}
			updateRuntime(this.store, row.binding.taskId, (rt) => {
				rt.cleared = options.abandon ? "abandoned" : "cleared";
			});
			this.bindings.clear(agent.id);
		}
		this.scopes.detach(agent);
	}
	async pause(agent) {
		const row = this.bindings.read(agent.id);
		if (!row?.binding.selected) throw new Error(bi("此会话没有选中的 Fusion 配对。", "No Fusion pair is selected in this session."));
		const taskId = row.binding.taskId;
		updateRuntime(this.store, taskId, (rt) => {
			rt.paused = "user";
		});
		const childId = readRuntime(this.store, taskId)?.worker?.childId;
		if (childId) try {
			await this.transport.stop(agent, childId);
		} catch {}
		try {
			this.effects.stopJobs(taskId);
		} catch {}
		try {
			this.keepalive.stopTask(taskId, "paused");
		} catch {}
	}
	async resume(agent) {
		const row = this.bindings.read(agent.id);
		if (!row?.binding.selected) throw new Error(bi("此会话没有选中的 Fusion 配对。", "No Fusion pair is selected in this session."));
		updateRuntime(this.store, row.binding.taskId, (rt) => {
			rt.paused = void 0;
		});
	}
	async reconcile(agent, options) {
		const owner = this.owner(agent);
		if (!owner || owner.role !== "lead") throw new Error(bi("只有 Lead 会话可以对账任务效果。", "Only the Lead session can reconcile task effects."));
		const taskId = owner.binding.taskId;
		this.effects.assertInspection(taskId, options.effectsStopped === true);
		this.effects.inspected(taskId, options.note || "manual reconcile", options.effectsStopped === true);
		updateRuntime(this.store, taskId, (rt) => {
			rt.paused = void 0;
		});
	}
	state(taskId) {
		return readRuntime(this.store, taskId);
	}
	async close() {
		if (this.#closed) return;
		this.#closed = true;
		for (const dispose of this.#dispose.splice(0)) try {
			dispose();
		} catch {}
		for (const agent of this.ctx.agents.list()) try {
			this.scopes.detach(agent);
		} catch {}
	}
	#installTools(scope, agent, binding, role) {
		if (role !== "lead") return [];
		const coordinator = this;
		const dispose = [];
		dispose.push(scope.tools.register(defineTool({
			name: "fusion_dispatch",
			description: [
				"Dispatch implementation work to the paired executor (cheap model) and collect its audited result in ONE call.",
				"The worker edits/tests inside this workspace; this call blocks until it finishes (or you are interrupted).",
				"It returns a compact audit bundle: worker summary, changed files, a bounded unified diff, static warnings, and verify-command outcomes.",
				"Failing verify commands or weakened tests trigger automatic repair rounds (same worker, max 2) before this returns.",
				"Write the instruction self-contained: what to change, where, invariants, acceptance criteria. The worker sees no chat history.",
				"Omit `instruction` only to collect a still-running worker after an interrupt. Use `reset_worker` to discard a confused worker."
			].join(" "),
			parameters: {
				instruction: {
					type: "string",
					description: "Complete implementation instruction for the executor. Required to start new work."
				},
				verify_commands: {
					type: "array",
					items: { type: "string" },
					description: "Shell commands run in the workspace root after the worker finishes (e.g. a build or focused test). Max 6, 120s each."
				},
				reset_worker: {
					type: "boolean",
					description: "Stop and discard the current worker first (fresh context, new child session)."
				}
			},
			output: textOutput,
			execute: async (args, exec) => {
				const lead = exec.agent;
				if (!lead) throw new Error("fusion_dispatch needs an agent context");
				const bundle = await runDispatch({
					ctx: coordinator.ctx,
					store: coordinator.store,
					transport: coordinator.transport,
					activity: coordinator.activity,
					workerTools: coordinator.options.workerTools
				}, lead, binding, args, exec.signal, exec.callId);
				return JSON.stringify(bundle, null, 2);
			}
		})));
		dispose.push(scope.on("tools/post-execute", async (exec, result, next) => {
			const note = this.#softNote(exec);
			if (!note || !result || result.isError || !Array.isArray(result.content)) return next();
			return {
				kind: "accept",
				content: [...result.content, {
					type: "text",
					text: note
				}]
			};
		}));
		return dispose;
	}
	#softNote(exec) {
		const agent = exec.agent;
		if (!agent) return void 0;
		if (!READ_TOOLS.has(exec.name)) {
			this.#readStreak.delete(agent.id);
			const lines = directWriteLines(exec.name, exec.arguments);
			if (lines > DIRECT_WRITE_SOFT_CAP) return bi("[fusion-next] 本次直接写入约 " + lines + " 行 — 实现性改动请交给 fusion_dispatch（执行模型完成编辑+验证，你只收审计包）；小的修正性编辑直接写没问题。", "[fusion-next] ~" + lines + " lines written directly — implementation work belongs to fusion_dispatch (executor edits+verifies, you review the audit bundle); small corrective edits are fine.");
			return;
		}
		const streak = (this.#readStreak.get(agent.id) ?? 0) + 1;
		this.#readStreak.set(agent.id, streak);
		if (streak === READ_STREAK_SOFT_CAP && !this.#streakWarned.has(agent.id)) {
			this.#streakWarned.add(agent.id);
			return bi("[fusion-next] 已连续 " + streak + " 次读取 — 大范围检索/阅读请改用 subagent：默认改派到执行模型，只读探索，不占用你的上下文。", "[fusion-next] " + streak + " consecutive reads — delegate bulk exploration to `subagent`: it is rerouted to the executor, read-only fenced, and keeps your context light.");
		}
	}
	async #interceptExplore(exec, next) {
		if (exec.name !== "subagent") return next();
		const lead = exec.agent;
		if (!lead) return next();
		const owner = this.owner(lead);
		if (!owner || owner.role !== "lead") return next();
		const args = exec.arguments ?? {};
		if (args.provider || args.model) return next();
		const worker = owner.binding.profile.worker;
		if (!worker?.model) return next();
		const subagents = this.ctx.subagents;
		if (typeof subagents.startActivation !== "function") throw new Error(bi("宿主不支持子代理激活接口（需要 startActivation）— 请直接使用 read/grep 等只读工具自行探索。", "Host subagent activation seam is unavailable (startActivation missing) — explore directly with read/grep instead."));
		const childId = SessionId$1(randomUUID());
		this.store.writeDocument("child:" + String(childId), 0, {
			parent: lead.id,
			taskId: String(owner.binding.taskId),
			lane: "explore"
		});
		const prompt = [{
			type: "text",
			text: [
				"[Read-only exploration — executor lane]",
				String(args.description ?? ""),
				"",
				String(args.prompt ?? ""),
				"",
				"Constraints: READ and SEARCH only. Never modify files, never run mutating commands.",
				"Answer compactly with file:line evidence the Lead can act on."
			].join("\n")
		}];
		const agentOptions = {
			provider: worker.provider,
			model: worker.model,
			...worker.reasoningEffort ? { reasoningEffort: ReasoningEffortId(worker.reasoningEffort) } : {}
		};
		const maxDepth = (lead.session.header.delegationDepth ?? 0) + 1;
		const accepted = await subagents.startActivation({
			provider: "spawn",
			label: String(args.description || "explore"),
			childId,
			delivery: "parent",
			parent: lead,
			prompt,
			agentOptions,
			maxDepth,
			request: {
				parent: lead,
				prompt,
				agentOptions,
				maxDepth
			},
			signal: exec.signal
		});
		try {
			this.activity.link(lead.session, String(childId), String(owner.binding.taskId), exec.callId);
		} catch {}
		return {
			isError: false,
			value: {
				kind: "activation",
				subagentId: String(accepted.childId)
			},
			content: [{
				type: "text",
				text: bi("只读探索已改派到执行模型 " + worker.model + " — 结果会自动回报，期间你可以继续。", "Read-only explorer rerouted to the executor " + worker.model + " — its report lands automatically; keep going.")
			}]
		};
	}
};
//#endregion
//#region src/host/http.ts
function trustedRequest(req) {
	if (![
		"127.0.0.1",
		"::1",
		"::ffff:127.0.0.1"
	].includes(req.socket.remoteAddress ?? "")) return false;
	if (req.headers["sec-fetch-site"] === "cross-site" || !req.headers.host) return false;
	try {
		const target = new URL(`http://${req.headers.host}`);
		if (![
			"localhost",
			"127.0.0.1",
			"[::1]"
		].includes(target.hostname)) return false;
		return !req.headers.origin || new URL(req.headers.origin).host === target.host;
	} catch {
		return false;
	}
}
function json(res, status, body) {
	res.writeHead(status, {
		"content-type": "application/json; charset=utf-8",
		"cache-control": "no-store",
		"x-content-type-options": "nosniff"
	});
	res.end(JSON.stringify(body));
}
async function readJson(req) {
	if (!req.headers["content-type"]?.toLowerCase().startsWith("application/json")) throw new Error("JSON content type required");
	const chunks = [];
	let size = 0;
	for await (const chunk of req) {
		size += chunk.length;
		if (size > 262144) throw new Error("Request body exceeds 256 KiB");
		chunks.push(Buffer.from(chunk));
	}
	const value = JSON.parse(Buffer.concat(chunks).toString("utf8"));
	if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("JSON object required");
	return value;
}
//#endregion
//#region src/host/status.ts
/** English copies of the stage and detail texts; the client shows them when DSH runs in English. */
const EN = {
	"就绪": "Ready",
	"执行": "Working",
	"审查": "Reviewing",
	"完成": "Done",
	"已暂停": "Paused",
	"未完成": "Unfinished",
	"等待检查": "Needs inspection",
	"使用 /fusion-next status 查看状态，确认后可用 /fusion-next resume 继续。": "Check /fusion-next status, then continue with /fusion-next resume.",
	"上次派发被中断 — 再次调用 fusion_dispatch 可继续收集结果。": "The last dispatch was interrupted — call fusion_dispatch again to collect it.",
	"Worker 仍在后台运行 — 调用 fusion_dispatch（不带 instruction）收集结果。": "The worker is still running — call fusion_dispatch (without instruction) to collect it."
};
const english = (text) => text == null ? text : EN[text] ?? text;
/** Stage projection off the v3 runtime doc — no task reducer involved. */
function runtimeStage(runtime) {
	const value = (stage, detail = null, attention = false) => ({
		stage,
		detail,
		attention
	});
	if (!runtime) return value("就绪");
	if (runtime.cleared) return value("完成");
	if (runtime.paused) return value("已暂停", "使用 /fusion-next status 查看状态，确认后可用 /fusion-next resume 继续。", true);
	if (liveDispatch(runtime)) return value("执行");
	const last = runtime.dispatches[runtime.dispatches.length - 1];
	if (!last) return value("就绪");
	if (last.status === "completed") return last.warnings?.length ? value("审查", "静态审计有警告：" + last.warnings[0], true) : value("完成");
	if (last.status === "interrupted") return value("等待检查", "上次派发被中断 — 再次调用 fusion_dispatch 可继续收集结果。", true);
	if (last.status === "steered") return value("执行", "Worker 仍在后台运行 — 调用 fusion_dispatch（不带 instruction）收集结果。");
	return value("未完成", last.error ?? "验证未通过，请查看会话中的审计结果。", true);
}
const verificationOf = (last) => {
	const checks = last?.checks ?? [];
	if (!last || checks.length === 0) return "unverified";
	const failed = checks.filter((check) => check.exitCode !== 0).length;
	return failed === 0 ? "verified" : failed === checks.length ? "unverified" : "partial";
};
/** Reads existing durable facts only. Polling never constructs a runtime or calls a model. */
function readFusionStatus(store, sessionId) {
	return store.statusSnapshot((index) => readStatus(store, sessionId, index));
}
function readFusionStatusAsync(store, sessionId, signal) {
	return store.statusSnapshotAsync((index) => readStatus(store, sessionId, index), signal);
}
function readStatus(store, sessionId, index) {
	const binding = new BindingRepository(store).read(sessionId)?.binding;
	const base = {
		schemaVersion: 1,
		sessionId,
		selected: Boolean(binding?.selected),
		observedAt: (/* @__PURE__ */ new Date()).toISOString()
	};
	if (!binding?.selected) return base;
	const taskId = binding.taskId;
	const row = store.readDocument("runtime:" + taskId);
	const runtime = readRuntime(store, taskId);
	const { checking, ...facts } = index.read(taskId);
	const stage = runtimeStage(runtime);
	const last = runtime?.dispatches[runtime.dispatches.length - 1];
	return {
		...base,
		task: {
			id: taskId,
			revision: row?.revision ?? 0,
			...stage,
			stageEn: english(stage.stage),
			detailEn: english(stage.detail) ?? null,
			verification: verificationOf(last),
			workerId: runtime?.worker?.childId ?? binding.workerId ?? null,
			models: {
				lead: binding.profile.lead,
				worker: binding.profile.worker,
				compactor: binding.profile.compactor?.route ?? null
			},
			...facts,
			automatedChecks: last ? last.checks?.length ?? 0 : null,
			pendingApprovals: 0,
			recovering: Boolean(runtime?.paused),
			outcomeUnknown: last?.status === "interrupted"
		}
	};
}
//#endregion
//#region src/host/session-pair.ts
const key = (sessionId) => `pair:${sessionId}`;
function readSessionPair(store, sessionId) {
	const row = store.readDocument(key(sessionId));
	if (!row) return void 0;
	const value = row.value;
	if (!value || typeof value !== "object" || value.schemaVersion !== 1) throw new Error(`Invalid session pair document for ${sessionId}`);
	return {
		revision: row.revision,
		pair: value
	};
}
function writeSessionPair(store, sessionId, revision, pair) {
	return store.writeDocument(key(sessionId), revision, pair);
}
/** Update only the lead field, preserving a worker already configured. */
function syncSessionPairLead(store, sessionId, lead) {
	const row = readSessionPair(store, sessionId);
	const prior = row?.pair;
	if (prior?.lead?.provider === lead.provider && prior.lead.model === lead.model && prior.lead.reasoningEffort === lead.reasoningEffort) return;
	writeSessionPair(store, sessionId, row?.revision ?? 0, {
		schemaVersion: 1,
		...prior ?? {},
		lead
	});
}
//#endregion
//#region src/usage/normalize.ts
function finite(value) {
	if (value === null || value === void 0) return null;
	if (!Number.isFinite(value) || value < 0) throw new TypeError(`usage must be a finite nonnegative number, got ${value}`);
	return value;
}
function applicability(value, present) {
	if (!present) return "not_applicable";
	if (value === null || value === void 0) return "unknown";
	return "known";
}
function toCount(value, status) {
	if (status === "not_applicable") return na();
	if (status === "unknown" || value === null) return unknown();
	return known(value);
}
function fromCount(value) {
	return value.state === "known" ? value.tokens : null;
}
function reasoningFromRaw(raw) {
	const present = Object.prototype.hasOwnProperty.call(raw, "reasoningTokens");
	const tokens = finite(raw.reasoningTokens);
	if (raw.outputIncludesReasoning === true) return {
		kind: "included",
		tokens
	};
	if (raw.outputIncludesReasoning === false) return {
		kind: "separate",
		tokens
	};
	if (!present) return {
		kind: "not_applicable",
		tokens: null
	};
	return {
		kind: "unknown",
		tokens
	};
}
function normalizeUsage(raw) {
	const cacheReadPresent = Object.prototype.hasOwnProperty.call(raw, "cacheReadTokens");
	const cacheRead = finite(raw.cacheReadTokens);
	const input = finite(raw.inputTokens);
	const includesCache = raw.inputIncludesCacheRead ?? null;
	const cacheReadStatus = applicability(raw.cacheReadTokens, cacheReadPresent);
	const split = splitInput(toCount(input, input === null ? "unknown" : "known"), toCount(cacheRead, cacheReadStatus), includesCache);
	const cacheWritePresent = Object.prototype.hasOwnProperty.call(raw, "cacheWriteTokens") || Object.prototype.hasOwnProperty.call(raw, "cacheWriteByTtl");
	let cacheWrite = {};
	let cacheWriteStatus = {};
	if (raw.cacheWriteByTtl) {
		cacheWrite = Object.fromEntries(Object.entries(raw.cacheWriteByTtl).map(([ttl, tokens]) => [ttl, finite(tokens)]));
		cacheWriteStatus = Object.fromEntries(Object.entries(raw.cacheWriteByTtl).map(([ttl, tokens]) => [ttl, applicability(tokens, true)]));
	} else if (cacheWritePresent) {
		cacheWrite = { default: finite(raw.cacheWriteTokens) };
		cacheWriteStatus = { default: applicability(raw.cacheWriteTokens, true) };
	}
	const output = finite(raw.outputTokens);
	const reasoningBilling = reasoningFromRaw(raw);
	return {
		uncachedInput: fromCount(split),
		cacheRead,
		cacheReadStatus,
		cacheWrite,
		cacheWriteStatus,
		output,
		reasoningOutputSubset: reasoningBilling.kind === "included" ? reasoningBilling.tokens : null,
		reasoningSeparate: reasoningBilling.kind === "separate" ? reasoningBilling.tokens : null,
		reasoningUnspecified: reasoningBilling.kind === "unknown" ? reasoningBilling.tokens : null,
		reasoningBilling,
		inputIncludesCacheRead: includesCache
	};
}
function cacheWritesFromUsage(usage) {
	const keys = Object.keys(usage.cacheWrite);
	if (!keys.length) return { kind: "not_applicable" };
	if (keys.some((key) => usage.cacheWriteStatus[key] === "unknown" || usage.cacheWrite[key] === null)) {
		if (keys.length === 1 && keys[0] === "default") return usage.cacheWriteStatus.default === "unknown" || usage.cacheWrite.default === null ? { kind: "unknown" } : {
			kind: "aggregate",
			rateKey: "default",
			tokens: toCount(usage.cacheWrite.default ?? null, usage.cacheWriteStatus.default ?? "known")
		};
	}
	if (keys.length === 1 && keys[0] === "default") return {
		kind: "aggregate",
		rateKey: "default",
		tokens: toCount(usage.cacheWrite.default ?? null, usage.cacheWriteStatus.default ?? (usage.cacheWrite.default === null ? "unknown" : "known"))
	};
	return {
		kind: "details",
		buckets: Object.fromEntries(keys.map((key) => [key, {
			rateKey: key,
			tokens: toCount(usage.cacheWrite[key] ?? null, usage.cacheWriteStatus[key] ?? (usage.cacheWrite[key] === null ? "unknown" : "known"))
		}]))
	};
}
function billFromUsage(usage) {
	const billing = usage.reasoningBilling ?? (usage.reasoningOutputSubset !== null ? {
		kind: "included",
		tokens: usage.reasoningOutputSubset
	} : usage.reasoningSeparate !== null ? {
		kind: "separate",
		tokens: usage.reasoningSeparate
	} : usage.reasoningUnspecified !== null ? {
		kind: "unknown",
		tokens: usage.reasoningUnspecified
	} : {
		kind: "not_applicable",
		tokens: null
	});
	return {
		uncachedInput: toCount(usage.uncachedInput, usage.uncachedInput === null ? "unknown" : "known"),
		cacheRead: toCount(usage.cacheRead, usage.cacheReadStatus),
		output: toCount(usage.output, usage.output === null ? "unknown" : "known"),
		cacheWrite: cacheWritesFromUsage(usage),
		reasoning: {
			kind: billing.kind,
			tokens: billing.kind === "not_applicable" ? na() : toCount(billing.tokens, billing.tokens === null ? "unknown" : "known")
		}
	};
}
function observationMode(meta) {
	if (meta?.source === "final") return "final";
	if (meta?.cumulative === false) return "delta";
	return "snapshot";
}
function asObservation(usage, meta, key, side) {
	const bill = billFromUsage(usage);
	const sequence = meta?.sequence ?? (side === "first" ? 0 : 1);
	return {
		id: meta?.observationId ?? `anon:${side}:${sequence}:${JSON.stringify(bill)}`,
		key,
		sequence,
		mode: observationMode(meta),
		bill
	};
}
function observationFromNormalized(usage, key, meta) {
	return asObservation(usage, {
		...meta,
		observationId: meta.id ?? meta.observationId
	}, key, "first");
}
function millionths(tokens, rate) {
	const [whole, frac = ""] = rate.split(".");
	const digits = `${whole}${frac.padEnd(6, "0").slice(0, 6)}`;
	const perMillion = BigInt(digits);
	return BigInt(tokens) * perMillion / 1000000n;
}
function decimalFromMillionths(value) {
	const negative = value < 0n;
	const abs = negative ? -value : value;
	const whole = abs / 1000000n;
	const frac = (abs % 1000000n).toString().padStart(6, "0").replace(/0+$/, "");
	const text = frac ? `${whole.toString()}.${frac}` : whole.toString();
	return UsdDecimal(negative ? `-${text}` : text);
}
function priceBucket(tokens, rate, label, kind, parts, reasons) {
	if (tokens === null) {
		if (kind === "required") reasons.push(`${label} tokens unknown`);
		return;
	}
	if (tokens === 0) return;
	if (rate === null || rate === void 0) {
		reasons.push(`${label} rate missing`);
		return;
	}
	parts.push(millionths(tokens, rate));
}
function priceUsage(usage, card) {
	if (!card) return {
		status: "unknown",
		totalUsd: null,
		observedUsd: null,
		reasons: ["no price card"]
	};
	const parts = [];
	const reasons = [];
	const unreliableBound = usage.inputIncludesCacheRead === true && usage.cacheReadStatus !== "known";
	if (unreliableBound) reasons.push("input includes cache but the cache split is unknown; observed is not a reliable lower bound");
	priceBucket(usage.uncachedInput, card.uncachedInputPerMillion, "uncachedInput", "required", parts, reasons);
	if (usage.cacheReadStatus === "unknown") reasons.push("cacheRead tokens unknown");
	else if (usage.cacheReadStatus === "known") priceBucket(usage.cacheRead, card.cacheReadPerMillion, "cacheRead", "optional", parts, reasons);
	priceBucket(usage.output, card.outputPerMillion, "output", "required", parts, reasons);
	for (const [ttl, tokens] of Object.entries(usage.cacheWrite)) {
		const status = usage.cacheWriteStatus[ttl] ?? (tokens === null ? "unknown" : "known");
		if (status === "unknown") {
			reasons.push(`cacheWrite.${ttl} tokens unknown`);
			continue;
		}
		if (status === "not_applicable") continue;
		priceBucket(tokens, card.cacheWritePerMillion?.[ttl] ?? card.cacheWritePerMillion?.default, `cacheWrite.${ttl}`, "optional", parts, reasons);
	}
	if (usage.reasoningBilling?.kind === "separate" || usage.reasoningSeparate !== null) {
		const rate = card.reasoningPerMillion ?? card.outputPerMillion;
		priceBucket(usage.reasoningBilling?.tokens ?? usage.reasoningSeparate, rate, "reasoningSeparate", "required", parts, reasons);
	}
	if (usage.reasoningBilling?.kind === "unknown" || usage.reasoningUnspecified !== null && usage.reasoningUnspecified !== 0) reasons.push("reasoning contract unspecified; cannot add or omit as a complete total");
	const observed = !unreliableBound && parts.length ? decimalFromMillionths(parts.reduce((sum, part) => sum + part, 0n)) : !unreliableBound && !parts.length ? null : null;
	const primaryMissing = usage.uncachedInput === null && usage.output === null && usage.cacheReadStatus !== "known" && Object.values(usage.cacheWriteStatus).every((status) => status !== "known") && usage.reasoningSeparate === null && usage.reasoningOutputSubset === null && usage.reasoningUnspecified === null;
	if (reasons.length && primaryMissing) return {
		status: "unknown",
		totalUsd: null,
		observedUsd: observed,
		reasons
	};
	if (reasons.length) return {
		status: "incomplete",
		totalUsd: null,
		observedUsd: observed,
		reasons
	};
	const total = observed ?? UsdDecimal("0");
	return {
		status: "complete",
		totalUsd: total,
		observedUsd: total,
		reasons: []
	};
}
function apiEquivalentUsd(usage, card) {
	const priced = priceUsage(usage, card);
	return priced.status === "complete" ? priced.totalUsd : null;
}
//#endregion
//#region src/usage/pricing.ts
function requireThat(value, code) {
	if (!value) throw new FusionError(USAGE_LEDGER_REQUIRED, code);
}
/** 18 decimal places in USD: a rate with <=12 decimals per 1e6 tokens is exact. */
function rateUnits(rate) {
	requireThat(/^\d+(?:\.\d{1,12})?$/.test(rate), "INVALID_PRICE_RATE");
	const [whole, frac = ""] = rate.split(".");
	return BigInt(whole + frac.padEnd(12, "0"));
}
function decimal(units) {
	const div = 10n ** 18n;
	const fraction = (units % div).toString().padStart(18, "0").replace(/0+$/, "");
	return `${units / div}${fraction ? `.${fraction}` : ""}`;
}
function quoteLedger(ledger, rates, priceCardDigest = digestOf(rates)) {
	const projection = projectLedger(restoreLedger(ledger));
	const bill = projection.bill;
	const missing = [];
	let units = 0n;
	function add(count, rate, name) {
		if (count.state === "not_applicable") return;
		if (count.state === "unknown") {
			missing.push(`${name}:unknown`);
			return;
		}
		requireThat(Number.isSafeInteger(count.tokens) && count.tokens >= 0, "INVALID_COUNT");
		if (count.tokens === 0) return;
		if (rate === void 0) {
			missing.push(`${name}:rate-missing`);
			return;
		}
		units += BigInt(count.tokens) * rateUnits(rate);
	}
	if (!bill) return {
		authority: projection.authority,
		status: "unknown",
		totalUsd: null,
		estimateUsd: null,
		priceCardDigest,
		missing: ["no-bill"]
	};
	add(bill.uncachedInput, rates.input, "input");
	add(bill.cacheRead, rates.cachedInput, "cache-read");
	add(bill.output, rates.output, "output");
	if (bill.cacheWrite.kind === "unknown") missing.push("cache-write:unknown");
	if (bill.cacheWrite.kind === "aggregate") add(bill.cacheWrite.tokens, rates.cacheWrite?.[bill.cacheWrite.rateKey], "cache-write");
	if (bill.cacheWrite.kind === "details") for (const [key, bucket] of Object.entries(bill.cacheWrite.buckets)) add(bucket.tokens, rates.cacheWrite?.[bucket.rateKey], `cache-write:${key}`);
	if (bill.reasoning.kind === "unknown") missing.push("reasoning-contract:unknown");
	if (bill.reasoning.kind === "separate") add(bill.reasoning.tokens, rates.reasoning, "reasoning");
	const complete = projection.authority === "final" && missing.length === 0;
	return {
		authority: projection.authority,
		status: complete ? "complete" : projection.authority === "final" ? "incomplete" : "provisional",
		totalUsd: complete ? decimal(units) : null,
		estimateUsd: decimal(units),
		priceCardDigest,
		missing
	};
}
//#endregion
//#region src/approval/logical.ts
function answerApproval(approval, state, decisionBy = "human") {
	if (approval.state !== "pending") throw new FusionError(APPROVAL_SCOPE, `approval ${approval.id} is ${approval.state}`);
	return {
		...approval,
		state,
		decisionBy
	};
}
function consumeApproval(approval, scope) {
	if (approval.state === "consumed") throw new FusionError(APPROVAL_SCOPE, `approval ${approval.id} already consumed`);
	if (approval.state !== "approved") throw new FusionError(APPROVAL_SCOPE, `approval ${approval.id} is ${approval.state}, not approved`);
	if (approval.argsDigest !== scope.argsDigest || approval.snapshot !== scope.snapshot || approval.permissionPolicyDigest !== scope.permissionPolicyDigest) throw new FusionError(APPROVAL_SCOPE, `approval ${approval.id} scope no longer matches`);
	return {
		...approval,
		state: "consumed"
	};
}
function neverMeansDeny(policy) {
	return policy === "never";
}
function pendingDoesNotExpire(_approval, _nowMs) {
	return true;
}
//#endregion
//#region src/review/dispatch.ts
/**
* Offline producer: persist the captured ticket and outbox row before any adapter send.
* The model callback may read the latest TaskState only for seq/CAS.
*/
function persistReviewRequest(store, taskId, ids, payloadRef) {
	const current = store.load(taskId);
	if (!current) throw new FusionError(EVENT_CONFLICT, `unknown task ${taskId}`);
	const ticket = captureTicket(createReviewTicket(current, ids));
	const requested = reviewRequestedEvent(current, current.seq + 1, ids);
	store.transact(taskId, current.seq, (persisted) => ({
		events: [requested],
		outbox: [...persisted.outbox, reviewOutboxRow(ticket, payloadRef)]
	}));
	return ticket;
}
function loadReviewOutboxByRequestId(store, taskId, requestId) {
	const row = store.outbox(taskId).find((item) => item.requestId === requestId || item.ticket?.requestId === requestId);
	if (!row?.ticket) throw new FusionError(EVENT_CONFLICT, `review outbox missing for ${requestId}`);
	return {
		row,
		ticket: captureTicket(row.ticket)
	};
}
function appendCapturedReviewResult(store, taskId, ticket, outcome) {
	const current = store.load(taskId);
	if (!current) throw new FusionError(EVENT_CONFLICT, `unknown task ${taskId}`);
	const event = resultFromCapturedTicket(ticket, outcome, {
		eventId: `review-completed-${ticket.requestId}-${current.seq + 1}`,
		seq: current.seq + 1,
		createdAt: (/* @__PURE__ */ new Date()).toISOString()
	});
	return store.append(taskId, current.revision, [event]);
}
//#endregion
//#region src/fusion-next.ts
const name = "fusion-next";
const inject = [
	"agents",
	"sessions",
	"llm",
	"tools",
	"subagents",
	"systemPrompt",
	"sessionQuery",
	"commands",
	"agentDefaultModel",
	"tokenMeter"
];
const Config = z.object({
	profilePath: z.string(),
	databasePath: z.string(),
	fusionDatabasePath: z.string(),
	authorizationPath: z.string(),
	lifecycleBridge: z.boolean().default(false),
	hostSdkVersion: z.string(),
	leadSandbox: z.boolean().default(true),
	workerTools: z.array(z.string()).default([
		"bash",
		"pwsh",
		"read",
		"write",
		"edit",
		"glob",
		"grep",
		"job_output",
		"job_kill"
	]),
	workerPolicy: z.union([z.const("inherit"), z.const("restricted")]).default("inherit")
});
async function apply(ctx, config = {}) {
	const dshHome = process.env.DSH_HOME || join(homedir(), ".dsh");
	const database = config.databasePath || join(dshHome, "plugins", "fusion-next", "state.sqlite");
	if (!isAbsolute(database)) throw new Error("Fusion databasePath must be absolute");
	const store = new SqliteFusionStore(database), bindings = new BindingRepository(store);
	const cachePolicy = new CachePolicy(store);
	backfillHistory(store);
	let defaultProfile;
	const physicalCatalog = async () => {
		const sessionController = ctx.get("sessionController");
		if (!sessionController) return void 0;
		const catalog = await sessionController.modelCatalog();
		return {
			...catalog,
			groups: catalog.groups.filter((group) => group.id !== FUSION_NEXT_PROVIDER)
		};
	};
	const catalogFromRaw = (raw) => {
		const efforts = [
			"off",
			"low",
			"medium",
			"high",
			"max"
		].map((id) => ({
			id,
			name: id
		}));
		const groups = /* @__PURE__ */ new Map();
		for (const role of [
			"lead",
			"worker",
			"compactor"
		]) {
			const route = raw[role];
			if (typeof route?.provider !== "string" || typeof route?.model !== "string") continue;
			const group = groups.get(route.provider) ?? {
				id: route.provider,
				name: route.provider,
				models: []
			};
			if (!group.models.some((model) => model.id === route.model)) group.models.push({
				id: route.model,
				name: route.model,
				reasoning: { efforts }
			});
			groups.set(route.provider, group);
		}
		return { groups: [...groups.values()] };
	};
	const configuredProfile = async () => {
		defaultProfile = void 0;
		const saved = store.readDocument("settings:profile");
		if (!saved && (!config.profilePath || !isAbsolute(config.profilePath))) throw new Error(bi("请先在设置的 Fusion 页面选择 Lead 和 Worker", "Open Settings → Fusion Next and choose a Lead and a Sidekick first"));
		const raw = saved?.value ?? loadJsonObject(config.profilePath);
		const catalog = await physicalCatalog() ?? catalogFromRaw(raw);
		const pair = validatePairChoice(raw, catalog);
		const next = saved ? modelProfileFromChoice(pair) : raw;
		defaultProfile = resolveProfile(next, next.interactionMode === "model-like" ? loadModelPromptBundle() : loadPromptBundle(), { authorizedRoutes: catalog.groups.flatMap((group) => group.models.map((model) => ({
			provider: group.id,
			model: model.id
		}))) });
		return defaultProfile;
	};
	let runtime;
	let creating;
	const getRuntime = (frozen) => {
		if (runtime) return Promise.resolve(runtime);
		if (creating) return creating;
		creating = (async () => {
			const profile = frozen ?? await configuredProfile();
			runtime = new FusionCoordinator(ctx, store, {
				profile,
				workerTools: config.workerTools ?? [
					"bash",
					"pwsh",
					"read",
					"write",
					"edit",
					"glob",
					"grep",
					"job_output",
					"job_kill"
				]
			});
			return runtime;
		})().finally(() => {
			creating = void 0;
		});
		return creating;
	};
	const leadModelInfo = async () => {
		try {
			const saved = store.readDocument("settings:profile")?.value;
			const lead = savedLeadRoute(saved) ?? (config.profilePath && isAbsolute(config.profilePath) ? savedLeadRoute(loadJsonObject(config.profilePath)) : void 0);
			if (!lead) return void 0;
			return await ctx.llm.resolveModelInfo(lead.provider, lead.model);
		} catch {
			return;
		}
	};
	const fusionDispatch = (options, route) => ctx.llm.stream({
		...options,
		provider: route.provider,
		model: route.model,
		...route.reasoningEffort === void 0 ? {} : { reasoningEffort: ReasoningEffortId(route.reasoningEffort) }
	});
	const resolveFusionLead = () => {
		if (defaultProfile?.profile.lead) return defaultProfile.profile.lead;
		try {
			const saved = store.readDocument("settings:profile")?.value;
			const lead = savedLeadRoute(saved);
			if (lead) return lead;
			for (const binding of bindings.selected()) if (binding.profile.lead?.model) return binding.profile.lead;
		} catch {}
	};
	const WRITE_INTENT = /写|改|实现|创建|生成|开发|重构|修复|部署|安装|删除|更新|新增|添加|替换|编辑|做一|做个|优化|调整|跑|执行|运行|测试|提交|build|write|implement|create|fix|refactor|deploy|install|update|remove|edit|add|generat|change|delete|patch|commit|rename|move|make|optimi|test|run\b/i;
	const READ_INTENT = /看|查|读|分析|解释|比较|列出|统计|找|搜索|梳理|总结|了解|哪里|什么|哪|几|多少|是否|有没有|为什么|怎么|grep|read|check|list|analy|explain|compare|find|search|show|describe|what|how|why|where|who|which|summar|review|trace|count|enum/i;
	const NOTICE_SHAPE = /Fusion Next|fusion_next|fusion_dispatch|subagent|worker|后台|执行模型|Sidekick|settled|review-ready|exploration/i;
	const INJECTED_SHAPE = /^\s*(Current runtime context|<system-reminder|<hindsight|\[MNEMON|MNEMON RUNTIME|<acp|<available_skills|USER\.md|MEMORY\.md|<skill_content|<context)/;
	const userTextOf = (message) => (Array.isArray(message?.content) ? message.content : []).filter((block) => block?.type === "text").map((block) => String(block.text ?? "")).join(" ").trim();
	const lastRealUserText = (messages) => {
		let lastRealIndex = -1;
		for (let index = messages.length - 1; index >= 0; index -= 1) {
			const message = messages[index];
			if (message?.role !== "user") continue;
			const text = userTextOf(message);
			if (text && !INJECTED_SHAPE.test(text) && !NOTICE_SHAPE.test(text)) {
				lastRealIndex = index;
				break;
			}
		}
		if (lastRealIndex < 0) return {
			text: "",
			fresh: false
		};
		const fresh = !messages.slice(lastRealIndex + 1).some((message) => message?.role === "assistant");
		return {
			text: userTextOf(messages[lastRealIndex]),
			fresh
		};
	};
	const classifyUserText = (text) => {
		if (!text) return "lead";
		if (WRITE_INTENT.test(text)) return "lead";
		if (NOTICE_SHAPE.test(text)) return "lead";
		if (READ_INTENT.test(text) || text.length <= 600) return "worker";
		return "lead";
	};
	const resolveFusionRoute = (options) => {
		const lead = resolveFusionLead();
		if (!options || options.purpose || !options.sessionId) return lead;
		try {
			const binding = bindings.read(String(options.sessionId))?.binding;
			const worker = binding?.selected ? binding.profile.worker : void 0;
			if (!worker?.model) return lead;
			return classifyUserText(lastRealUserText(options.messages ?? []).text) === "worker" ? worker : lead;
		} catch {
			return lead;
		}
	};
	ctx.effect(() => ctx.llm.registerAdapter([FUSION_NEXT_PROVIDER], new FusionCatalogAdapter(leadModelInfo, fusionDispatch, resolveFusionRoute)));
	const rerouted = /* @__PURE__ */ new WeakSet();
	const routeVerdicts = /* @__PURE__ */ new Map();
	const judgeWithPlanner = async (route, text) => {
		const prompt = [
			"Decide whether the newest user request can be fully handled by a cheaper junior executor.",
			"SIMPLE = read-only investigation or a short factual answer (reading, searching, explaining, comparing, counting, summarising) with no file changes needed.",
			"COMPLEX = anything that writes, executes, fixes, builds, or needs careful multi-step judgement.",
			"Answer with exactly one word: SIMPLE or COMPLEX. Request:",
			text.length > 4e3 ? text.slice(0, 2e3) + "\n…\n" + text.slice(-2e3) : text
		].join("\n");
		try {
			const judge = {
				provider: route.provider,
				model: route.model,
				maxTokens: 8,
				messages: [{
					role: "user",
					content: [{
						type: "text",
						text: prompt
					}]
				}],
				purpose: "session-title"
			};
			rerouted.add(judge);
			let out = "";
			for await (const chunk of ctx.llm.stream(judge)) if (chunk.type === "text-delta") out += chunk.text;
			return /simple/i.test(out.trim()) ? "worker" : "lead";
		} catch {
			return "lead";
		}
	};
	ctx.effect(() => ctx.on("llm/stream", async function* (request, next) {
		if (rerouted.has(request) || request.purpose || !request.sessionId) {
			yield* next();
			return;
		}
		const binding = bindings.read(String(request.sessionId))?.binding;
		const worker = binding?.selected ? binding.profile.worker : void 0;
		const lead = resolveFusionLead();
		if (!worker?.model || !lead?.model) {
			yield* next();
			return;
		}
		let busy = false;
		try {
			busy = Boolean(binding?.taskId) && dispatchInFlight(store, binding.taskId);
		} catch {
			busy = true;
		}
		if (busy) {
			yield* next();
			return;
		}
		const { text, fresh } = lastRealUserText(request.messages ?? []);
		if (!text) {
			yield* next();
			return;
		}
		const verdictKey = String(request.sessionId) + ":" + text.slice(0, 500);
		let verdict = routeVerdicts.get(verdictKey);
		if (!verdict) {
			if (!fresh) {
				yield* next();
				return;
			}
			verdict = await judgeWithPlanner(worker ?? lead, text);
			routeVerdicts.set(verdictKey, verdict);
		}
		if (verdict !== "worker") {
			yield* next();
			return;
		}
		const forward = {
			...request,
			provider: worker.provider,
			model: worker.model,
			reasoningEffort: void 0
		};
		rerouted.add(forward);
		yield* ctx.llm.stream(forward);
	}, { prepend: true }));
	const workerOf = (sessionId) => readSessionPair(store, sessionId)?.pair.worker;
	const leadChanged = (sessionId, lead) => {
		syncSessionPairLead(store, sessionId, lead);
	};
	const sessionProfile = (_sessionId, lead, worker) => {
		const base = defaultProfile;
		if (base) return {
			profile: completeProfile({
				...base.profile,
				lead,
				worker
			}, base.prompts),
			prompts: base.prompts
		};
		const prompts = loadModelPromptBundle();
		return resolveProfile(modelProfileFromChoice({
			lead,
			worker
		}), prompts, { authorizedRoutes: [lead, worker] });
	};
	ctx.effect(() => installNativeFusionSelection(ctx, {
		coordinator: () => runtime,
		profile: () => defaultProfile,
		workerOf,
		sessionProfile,
		leadChanged,
		ensureCoordinator: async (_sessionId, lead, worker) => {
			await getRuntime(sessionProfile(_sessionId, lead, worker));
		},
		selection: (agent) => {
			const selection = agent.session.snapshotEvents().findLast((event) => event.type === "model/selection");
			if (selection?.type === "model/selection") return selection.data;
			if (bindings.read(agent.id)?.binding.selected) return {
				provider: FUSION_NEXT_PROVIDER,
				model: FUSION_NEXT_MODEL
			};
			const header = agent.session.requestHeader();
			return header ? {
				provider: header.config.provider,
				model: header.config.model
			} : ctx.agentDefaultModel.currentSelection();
		}
	}));
	const restoreFailure = /* @__PURE__ */ new Map();
	ctx.effect(() => ctx.on("agent/pre-step", async (payload, next) => {
		const binding = bindings.read(payload.agent.id)?.binding;
		if (!binding?.selected) return next();
		try {
			await getRuntime({
				profile: binding.profile,
				prompts: binding.prompts
			});
			if (restoreFailure.has(payload.agent.id)) restoreFailure.delete(payload.agent.id);
		} catch (error) {
			restoreFailure.set(payload.agent.id, String(error));
			return { kind: "reject" };
		}
		return next();
	}, { prepend: true }));
	ctx.inject(["webServer"], (webCtx) => webCtx.effect(() => webCtx.get("webServer").register({
		kind: "exact",
		path: "/api/fusion-next",
		handler: async (req, res) => {
			if (!trustedRequest(req)) return json(res, 403, { error: "forbidden" });
			try {
				const url = new URL(req.url ?? "/", "http://localhost");
				if (req.method === "GET") {
					if (url.searchParams.get("view") === "history") return json(res, 200, readHistory(store, url.searchParams.get("cursor") ?? ""));
					if (url.searchParams.get("view") === "scorecard") return json(res, 200, readScorecard(store, Number(url.searchParams.get("limit") ?? "50")));
					if (url.searchParams.get("view") === "activity") return json(res, 200, await readHistoricalFusionActivity(ctx, store, url.searchParams.get("sessionId") ?? "", url.searchParams.get("callId") ?? "", Number(url.searchParams.get("after") ?? -1)));
					if (url.searchParams.get("view") === "status") {
						const abort = new AbortController(), disconnected = () => abort.abort();
						res.once("close", disconnected);
						try {
							const status = await readFusionStatusAsync(store, url.searchParams.get("sessionId") ?? "", abort.signal);
							if (!res.destroyed) return json(res, 200, status);
							return;
						} catch (error) {
							if (!abort.signal.aborted) throw error;
							return;
						} finally {
							res.off("close", disconnected);
						}
					}
					if (url.searchParams.get("view") === "catalog") return json(res, 200, await ctx.get("sessionController")?.modelCatalog() ?? { groups: [] });
					if (url.searchParams.get("view") === "session-pair") {
						const sid = url.searchParams.get("sessionId") ?? "";
						const pair = sid ? readSessionPair(store, sid)?.pair : void 0;
						const bound = sid ? bindings.read(sid)?.binding : void 0;
						const intent = sid ? store.readDocument("sandbox-intent:" + sid)?.value : void 0;
						return json(res, 200, {
							worker: pair?.worker ?? null,
							lead: pair?.lead ?? null,
							selected: Boolean(bound?.selected),
							executorMode: intent?.mode ?? null,
							catalog: await physicalCatalog()
						});
					}
					if (url.searchParams.get("view") === "session-usage") {
						const sid = url.searchParams.get("sessionId") ?? "";
						const binding = sid ? bindings.read(sid)?.binding : void 0;
						const empty = {
							input: 0,
							output: 0,
							cacheRead: 0,
							calls: 0
						};
						const totals = {};
						const models = {};
						const total = { ...empty };
						if (binding) for (const id of store.listDocumentIds("usage-index:" + binding.taskId + ":")) {
							const row = store.readDocument(id)?.value;
							if (!row || row.taskId !== binding.taskId) continue;
							const role = row.role || "lead";
							const bucket = totals[role] ?? (totals[role] = { ...empty });
							const modelKey = row.provider + "/" + row.model;
							const mb = models[modelKey] ?? (models[modelKey] = {
								...empty,
								role
							});
							for (const key of [
								"input",
								"output",
								"cacheRead"
							]) {
								const count = row[key];
								if (count?.state === "known") {
									bucket[key] += count.tokens;
									mb[key] += count.tokens;
									total[key] += count.tokens;
								}
							}
							bucket.calls++;
							mb.calls++;
							total.calls++;
						}
						const inputTotal = total.input + total.cacheRead;
						return json(res, 200, {
							paired: Boolean(binding?.selected),
							roles: totals,
							models,
							total,
							cacheHit: inputTotal > 0 ? total.cacheRead / inputTotal : null
						});
					}
					if (url.searchParams.get("view") === "running") {
						const abort = new AbortController(), disconnected = () => abort.abort();
						res.once("close", disconnected);
						try {
							const sessions = await Promise.all(bindings.selected().map(async (binding) => {
								let title = null;
								try {
									title = (ctx.agents.get(SessionId$1(binding.sessionId))?.session.snapshotEvents().findLast((event) => event.type === "session/title"))?.title ?? null;
								} catch {
									title = null;
								}
								const status = await readFusionStatusAsync(store, binding.sessionId, abort.signal);
								return {
									sessionId: binding.sessionId,
									title,
									lead: binding.profile.lead,
									worker: binding.profile.worker,
									task: status.task ?? null
								};
							}));
							if (!res.destroyed) return json(res, 200, { sessions });
							return;
						} catch (error) {
							if (!abort.signal.aborted) throw error;
							return;
						} finally {
							res.off("close", disconnected);
						}
					}
					if (url.searchParams.get("view") === "cache") {
						let profile;
						try {
							profile = await configuredProfile();
						} catch {
							profile = void 0;
						}
						return json(res, 200, {
							checked: CACHE_DEFAULTS_CHECKED,
							models: cacheView(cachePolicy, profile ? {
								lead: profile.profile.lead,
								worker: profile.profile.worker
							} : void 0, profile?.profile.cacheKeepalive)
						});
					}
					if (url.searchParams.get("view") === "settings") {
						const saved = store.readDocument("settings:profile");
						let profile, reason;
						try {
							profile = await configuredProfile();
						} catch (error) {
							reason = error instanceof Error ? error.message : String(error);
						}
						return json(res, 200, {
							revision: saved?.revision ?? 0,
							catalog: await physicalCatalog(),
							pair: profile ? choiceFromProfile(profile.profile) : null,
							authorized: true,
							reason,
							managedAuthorization: false,
							policy: profile?.profile.interactionMode ?? "legacy",
							actualBilledUsd: null,
							apiEquivalentUsd: null
						});
					}
					const sessionId = url.searchParams.get("sessionId") ?? "";
					const binding = sessionId && bindings.read(sessionId)?.binding;
					let available = false, reason;
					try {
						const profile = binding && binding.selected ? {
							profile: binding.profile,
							prompts: binding.prompts
						} : await configuredProfile();
						(await getRuntime(profile)).transport.assertAvailable();
						available = true;
					} catch (error) {
						reason = error instanceof Error ? error.message : String(error);
					}
					const status = binding ? readFusionStatus(store, sessionId) : void 0;
					return json(res, 200, {
						selected: Boolean(binding && binding.selected),
						available,
						...reason ? { reason } : {},
						...status?.task ? { task: status.task } : {}
					});
				}
				if (req.method !== "POST") return json(res, 405, { error: "method not allowed" });
				const body = await readJson(req);
				if ([
					"continue",
					"switch-role",
					"schedule",
					"cancel-schedule"
				].includes(String(body.action))) throw new Error(bi("v0.3 移除了定时/切换恢复 — 用 /fusion-next recover 提交检查记录，或用 /fusion-next resume 继续。", "v0.3 removed scheduled/switch recovery — use /fusion-next recover with an inspection note, or /fusion-next resume."));
				if (body.action === "authorize") throw new Error(bi("v0.3 移除了额度授权文件 — 模型限额由宿主侧管理。", "v0.3 removed the authorization file — model limits are host-managed."));
				if (body.action === "cache-setting") {
					if (typeof body.provider !== "string" || typeof body.model !== "string" || !body.provider || !body.model) throw new Error(bi("请选择模型", "Choose a model"));
					const setting = body.reset === true ? null : {
						...body.mode === void 0 || body.mode === null ? {} : { mode: body.mode },
						...body.intervalSeconds === void 0 || body.intervalSeconds === null ? {} : { intervalSeconds: Number(body.intervalSeconds) }
					};
					cachePolicy.save(body.provider, body.model, setting);
					return json(res, 200, { ok: true });
				}
				if (body.action === "configure") {
					if (!Number.isSafeInteger(body.revision) || Number(body.revision) < 0) throw new Error(bi("配置版本无效，请刷新后重试", "Invalid settings revision; refresh and retry"));
					const pair = validatePairChoice(body.pair, await physicalCatalog() ?? catalogFromRaw(body.pair));
					const revision = store.writeDocument("settings:profile", Number(body.revision), modelProfileFromChoice(pair));
					const profile = await configuredProfile();
					await getRuntime(profile);
					return json(res, 200, {
						ok: true,
						revision
					});
				}
				if (body.action === "session-pair") {
					if (typeof body.sessionId !== "string" || !body.sessionId) throw new Error(bi("会话参数无效", "Invalid session id"));
					const sessionId = body.sessionId;
					const prior = readSessionPair(store, sessionId);
					if (body.worker === null) {
						writeSessionPair(store, sessionId, prior?.revision ?? 0, {
							schemaVersion: 1,
							...prior?.pair ?? {},
							worker: void 0
						});
						const binding = bindings.read(sessionId)?.binding;
						if (binding?.selected) {
							const agent = ctx.agents.get(SessionId$1(sessionId));
							const controller = await getRuntime({
								profile: binding.profile,
								prompts: binding.prompts
							});
							if (agent) {
								if (agent.status !== "idle") await controller.pause(agent);
								await controller.clear(agent, { abandon: body.force === true });
							} else bindings.clear(sessionId);
						}
						return json(res, 200, {
							ok: true,
							selected: false
						});
					}
					const candidate = body.worker;
					if (!candidate || typeof candidate.provider !== "string" || !candidate.provider || candidate.provider === "fusion-next" || typeof candidate.model !== "string" || !candidate.model) throw new Error(bi("执行模型必须是一个真实模型", "The executor must be a real model"));
					const model = (await physicalCatalog() ?? catalogFromRaw({ worker: candidate })).groups.find((group) => group.id === candidate.provider)?.models.find((item) => item.id === candidate.model);
					if (!model) throw new Error(bi("执行模型已不可用，请刷新后重选", "The executor model is no longer available; refresh and choose again"));
					if (candidate.reasoningEffort !== void 0 && candidate.reasoningEffort !== null && (typeof candidate.reasoningEffort !== "string" || !model.reasoning?.efforts.some((effort) => effort.id === candidate.reasoningEffort))) throw new Error(bi("执行模型不支持所选推理强度", "The executor does not support the selected reasoning level"));
					const worker = {
						provider: candidate.provider,
						model: candidate.model,
						...typeof candidate.reasoningEffort === "string" ? { reasoningEffort: candidate.reasoningEffort } : {}
					};
					writeSessionPair(store, sessionId, prior?.revision ?? 0, {
						schemaVersion: 1,
						...prior?.pair ?? {},
						worker
					});
					return json(res, 200, {
						ok: true,
						worker
					});
				}
				throw new Error(bi("请使用原模型菜单选择 Fusion 或切换普通模型", "Use the model menu to select Fusion or another model"));
			} catch (error) {
				return json(res, 409, { error: error instanceof Error ? error.message : String(error) });
			}
		}
	})));
	ctx.effect(() => ctx.commands.register({
		name: "fusion-next",
		description: bi("Fusion 状态、暂停、恢复与退出（不调用模型）", "Fusion status, pause, resume and exit (no model call)"),
		input: { hint: bi("status | pair [<provider>/]<model> | pair off [--force] | pause | resume | recover [--effects-stopped] <检查记录> | off [--force]", "status | pair [<provider>/]<model> | pair off [--force] | pause | resume | recover [--effects-stopped] <inspection note> | off [--force]") },
		handler: async (invocation) => {
			const [action = "status", ...note] = invocation.rawInput.trim().split(/\s+/);
			try {
				if (action === "pair") {
					const sessionId = invocation.agent.id;
					const prior = readSessionPair(store, sessionId);
					const target = note[0];
					if (!target) {
						const pair = prior?.pair;
						if (!pair?.worker) return {
							kind: "success",
							text: bi("本会话未设定执行模型。用 /fusion-next pair [<provider>/]<model> 设定，pair off 退出。", "No executor set. Use /fusion-next pair [<provider>/]<model> to set one, pair off to exit.")
						};
						const intentMode = (store.readDocument("sandbox-intent:" + sessionId)?.value)?.mode;
						const modeText = intentMode ? bi("，执行权限 " + intentMode, ", executor mode " + intentMode) : "";
						return {
							kind: "success",
							text: bi("本会话执行模型：" + pair.worker.provider + "/" + pair.worker.model + "（规划 " + (pair.lead?.provider ?? "?") + "/" + (pair.lead?.model ?? "?") + "）" + modeText + "。", "Executor: " + pair.worker.provider + "/" + pair.worker.model + " (planner " + (pair.lead?.provider ?? "?") + "/" + (pair.lead?.model ?? "?") + ")" + modeText + ".")
						};
					}
					if (target === "off" || target === "none") {
						writeSessionPair(store, sessionId, prior?.revision ?? 0, {
							schemaVersion: 1,
							...prior?.pair ?? {},
							worker: void 0
						});
						const pairBinding = bindings.read(sessionId)?.binding;
						if (pairBinding?.selected) {
							const controller = await getRuntime({
								profile: pairBinding.profile,
								prompts: pairBinding.prompts
							});
							if (invocation.agent.status !== "idle") await controller.pause(invocation.agent);
							await controller.clear(invocation.agent, { abandon: note.includes("--force") });
						}
						return {
							kind: "success",
							text: bi("本会话已退出 Fusion 编队，恢复为普通会话。", "Fusion pair cleared; this session is a normal conversation again.")
						};
					}
					const entries = (await physicalCatalog() ?? { groups: [] }).groups.flatMap((group) => group.models.map((model) => ({
						provider: group.id,
						model
					})));
					const match = note[1] ? entries.find((entry) => entry.provider === note[0] && entry.model.id === note[1]) : entries.find((entry) => entry.model.id === target) ?? entries.find((entry) => {
						const slash = target.indexOf("/");
						return slash > 0 && entry.provider === target.slice(0, slash) && entry.model.id === target.slice(slash + 1);
					});
					if (!match) throw new Error(bi("执行模型 " + target + " 不可用；请查看模型目录。", "Executor model " + target + " is not available; check the model catalog."));
					const worker = {
						provider: match.provider,
						model: match.model.id
					};
					writeSessionPair(store, sessionId, prior?.revision ?? 0, {
						schemaVersion: 1,
						...prior?.pair ?? {},
						worker
					});
					return {
						kind: "success",
						text: bi("已为会话设定执行模型 " + match.provider + "/" + match.model.id + "。发送下一条消息即按编队执行。", "Executor set to " + match.provider + "/" + match.model.id + ". The next message runs as a Fusion pair.")
					};
				}
				const binding = bindings.read(invocation.agent.id)?.binding;
				if (!binding?.selected) return {
					kind: "success",
					text: bi("当前会话未启用 Fusion。请在模型选择器中选择 Fusion Next · 自动。", "Fusion is not selected in this conversation. Choose Fusion · auto in the model menu.")
				};
				const controller = await getRuntime({
					profile: binding.profile,
					prompts: binding.prompts
				});
				if (action === "status" || action === "") {
					const runtime = controller.state(binding.taskId);
					const unfinishedEffects = controller.effects.pending(binding.taskId).map(({ record }) => ({
						role: record.role,
						tool: record.toolName
					}));
					const usageCalls = store.listDocumentIds("usage-index:" + binding.taskId + ":").length;
					return {
						kind: "success",
						text: JSON.stringify({
							taskId: binding.taskId,
							paused: runtime?.paused ?? null,
							cleared: runtime?.cleared ?? null,
							workerId: runtime?.worker?.childId ?? binding.workerId ?? null,
							dispatches: runtime?.dispatches.slice(-6) ?? [],
							modelCalls: usageCalls,
							unfinishedEffects,
							...unfinishedEffects.length ? { recoveryHint: bi("请核对中断的工具操作，确认对应命令及子进程已停止；Host 退出不代表这些操作已结束。", "Check the interrupted tool operations and confirm their commands and child processes stopped; a Host exit does not end them.") } : {},
							actualBilledUsd: null,
							apiEquivalentUsd: null
						}, null, 2)
					};
				}
				if (action === "pause") await controller.pause(invocation.agent);
				else if (action === "resume") await controller.resume(invocation.agent);
				else if (action === "recover") await controller.reconcile(invocation.agent, {
					commandId: invocation.commandId,
					effectsStopped: note[0] === "--effects-stopped",
					note: (note[0] === "--effects-stopped" ? note.slice(1) : note).join(" ")
				});
				else if (action === "off") {
					await controller.clear(invocation.agent, { abandon: note.includes("--force") });
					await ctx.get("sessionController")?.selectModel({
						sessionId: SessionId$1(invocation.agent.id),
						...binding.profile.lead
					});
				} else throw new Error(bi("使用 /fusion-next status、pause、resume、recover <检查记录> 或 off", "Use /fusion-next status, pause, resume, recover <inspection note> or off"));
				return {
					kind: "success",
					text: action === "resume" ? bi("Fusion 已恢复。发送下一条消息继续当前任务。", "Fusion resumed. Send a message to continue the task.") : bi("Fusion " + action + " 已完成。", "Fusion " + action + " done.")
				};
			} catch (error) {
				return {
					kind: "error",
					text: error instanceof Error ? error.message : String(error)
				};
			}
		}
	}));
	ctx.effect(() => async () => {
		if (creating) await creating.catch(() => void 0);
		if (runtime) await runtime.close();
		store.close();
	});
	try {
		await getRuntime(await configuredProfile());
	} catch {
		const selected = bindings.selected()[0];
		if (selected) await getRuntime({
			profile: selected.profile,
			prompts: selected.prompts
		});
	}
	ctx.logger.info("[my-plugins/fusion-next] loaded (v0.3 single-dispatch)");
}
//#endregion
export { ArtifactId, Config, EpochId, FUSION_NEXT_CONTEXT_BUDGET, FileFusionStore, FusionError, NEEDS_REPAIR, OUTCOME_UNKNOWN, OperationId, SPEND_UNAUTHORIZED, STORE_MIGRATION_REQUIRED, STORE_PROJECTION_VERSION, SessionId, SnapshotId, SqliteFusionStore, TERMINAL_PHASES, TaskId, USAGE_LEDGER_REQUIRED, UsdDecimal, WORK_ORDER_CONFLICT, WorkOrderId, answerApproval, apiEquivalentUsd, appendCapturedReviewResult, apply, assertCurrentSubject, assertFinalBudget, boundedOverflowRecovery, captureTicket, classifyReview, completeProfile, consumeApproval, createReviewTicket, digestOf, failingRenameIo, ingestDurable, ingestObservation, inject, inputBudget, loadJsonObject, loadPromptBundle, loadReviewOutboxByRequestId, measureRequest, name, neverMeansDeny, newLedger, normalizeTermination, normalizeUsage, observationFromNormalized, pendingDoesNotExpire, persistReviewRequest, priceUsage, projectLedger, promptDigests, promptManifest, quoteLedger, reduce, reduceAll, reportSubject, requireStorageProjectionVersion, resolveProfile, restoreLedger, resultFromCapturedTicket, reviewAttemptFields, reviewOutboxRow, reviewReadinessReceipt, reviewRequestedEvent, sha256Hex, snapshotWorkspace, splitInput, toReducerReviewDecision };

//# sourceMappingURL=fusion-next.js.map
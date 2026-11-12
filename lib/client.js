window.__ModuleLoader__.load({
	id: "fusion-next",
	factory: (require) => {
		var module = { exports: {} };
		var exports = module.exports;
"use strict";
var __defProp = Object.defineProperty;
var __getOwnPropDesc = Object.getOwnPropertyDescriptor;
var __getOwnPropNames = Object.getOwnPropertyNames;
var __hasOwnProp = Object.prototype.hasOwnProperty;
var __export = (target, all) => {
  for (var name2 in all)
    __defProp(target, name2, { get: all[name2], enumerable: true });
};
var __copyProps = (to, from, except, desc) => {
  if (from && typeof from === "object" || typeof from === "function") {
    for (let key2 of __getOwnPropNames(from))
      if (!__hasOwnProp.call(to, key2) && key2 !== except)
        __defProp(to, key2, { get: () => from[key2], enumerable: !(desc = __getOwnPropDesc(from, key2)) || desc.enumerable });
  }
  return to;
};
var __toCommonJS = (mod) => __copyProps(__defProp({}, "__esModule", { value: true }), mod);

// src/client/index.ts
var index_exports = {};
__export(index_exports, {
  apply: () => apply,
  inject: () => inject,
  name: () => name
});
module.exports = __toCommonJS(index_exports);

// src/client/FusionSettings.tsx
var import_react2 = require("react");

// src/client/settings-events.ts
var listeners = /* @__PURE__ */ new Set();
var onSettingsChanged = (listener) => {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
};
var settingsChanged = () => {
  for (const listener of listeners) listener();
};

// src/client/i18n.ts
var import_react = require("react");
var source;
var listeners2 = /* @__PURE__ */ new Set();
var notify = () => {
  for (const listener of listeners2) listener();
};
function bindLocale(next) {
  source = next;
  notify();
  const unsubscribe = next.subscribe(notify);
  return () => {
    unsubscribe();
    if (source === next) {
      source = void 0;
      notify();
    }
  };
}
var current = () => {
  const id = source?.getSnapshot().active ?? (typeof navigator === "undefined" ? "en" : navigator.language);
  return id.toLowerCase().startsWith("zh") ? "zh" : "en";
};
function useLang() {
  return (0, import_react.useSyncExternalStore)((listener) => {
    listeners2.add(listener);
    return () => {
      listeners2.delete(listener);
    };
  }, current, () => "en");
}
var tr = (lang, zh, en) => lang === "zh" ? zh : en;

// src/client/FusionSettings.tsx
var import_jsx_runtime = require("react/jsx-runtime");
var styles = `
.fusion-settings{max-width:560px;color:var(--dsw-alias-label-primary);display:flex;flex-direction:column;gap:16px}
.fusion-settings h2{margin:0;font-size:20px;line-height:28px;font-weight:600}
.fusion-settings p{margin:0;font-size:13px;line-height:20px;color:var(--dsw-alias-label-secondary)}
.fusion-settings .fusion-card{padding:18px 20px;border:1px solid var(--dsw-alias-border-l2);border-radius:12px;display:flex;flex-direction:column;gap:16px;background:var(--dsw-alias-bg-module-platform)}
.fusion-settings fieldset{padding:0;margin:0;border:0;min-inline-size:0;display:flex;flex-direction:column;gap:6px}
.fusion-settings legend{font-size:14px;font-weight:600;padding:0}
.fusion-settings fieldset>p{font-size:12px}
.fusion-settings label{display:grid;grid-template-columns:88px minmax(0,1fr);align-items:center;gap:12px;font-size:13px;color:var(--dsw-alias-label-secondary)}
.fusion-settings :is(select,option,optgroup){background-color:var(--dsw-alias-bg-layer-1);color:var(--dsw-alias-label-primary);color-scheme:inherit}
.fusion-settings select{box-sizing:border-box;min-width:0;width:100%;height:34px;border:1px solid var(--dsw-alias-border-l2);border-radius:7px;padding:0 9px;font:inherit;color:var(--dsw-alias-label-primary)}
.fusion-settings .fusion-actions{display:flex;align-items:center;justify-content:flex-end;gap:12px}
.fusion-settings .fusion-actions>p{margin-right:auto}
.fusion-settings button{height:34px;border:1px solid transparent;border-radius:17px;background:var(--dsw-alias-button-primary-fill,var(--dsw-alias-brand-primary));color:var(--dsw-alias-label-primary-foreground,#fff);padding:0 18px;font:inherit;font-size:13px;cursor:pointer}
.fusion-settings button:disabled{opacity:.5;cursor:default}
.fusion-settings :is(button,select):focus-visible{outline:2px solid var(--dsw-alias-brand-primary);outline-offset:2px}
.fusion-settings [role=alert]{color:var(--dsw-alias-state-error-primary);overflow-wrap:anywhere}
.fusion-settings details{font-size:13px;line-height:20px}
.fusion-settings summary{cursor:pointer;font-weight:500;color:var(--dsw-alias-label-secondary)}
.fusion-settings .fusion-limits{display:flex;flex-direction:column;gap:12px;padding-top:10px}
.fusion-settings input[type=number]{min-width:0;width:100%;box-sizing:border-box;height:34px;background-color:var(--dsw-alias-bg-layer-1);color:var(--dsw-alias-label-primary);border:1px solid var(--dsw-alias-border-l2);border-radius:7px;padding:0 9px;font:inherit}
@media(max-width:480px){.fusion-settings label{grid-template-columns:1fr;gap:6px}}
`;
var key = (route) => route ? JSON.stringify([route.provider, route.model]) : "";
function ModelChoice({ role: role2, route, catalog, onChange }) {
  const lang = useLang();
  const name2 = role2 === "Lead" ? tr(lang, "\u89C4\u5212", "Planner") : role2 === "Sidekick" ? tr(lang, "\u6267\u884C", "Executor") : tr(lang, "\u538B\u7F29", "Compaction");
  const model = catalog.groups.find((group) => group.id === route?.provider)?.models.find((model2) => model2.id === route?.model);
  return /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("fieldset", { children: [
    /* @__PURE__ */ (0, import_jsx_runtime.jsx)("legend", { children: name2 }),
    /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("label", { children: [
      tr(lang, "\u6A21\u578B", "Model"),
      /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("select", { "aria-label": tr(lang, `${name2} \u6A21\u578B`, `${name2} model`), value: key(route), onChange: (event) => {
        if (!event.target.value) {
          onChange(void 0);
          return;
        }
        const [provider, model2] = JSON.parse(event.target.value);
        onChange({ provider, model: model2 });
      }, children: [
        /* @__PURE__ */ (0, import_jsx_runtime.jsx)("option", { value: "", disabled: role2 !== "compactor", children: role2 === "compactor" ? tr(lang, "\u8DDF\u968F\u89D2\u8272\u6A21\u578B", "Use the role's own model") : tr(lang, "\u9009\u62E9\u6A21\u578B", "Choose a model") }),
        catalog.groups.map((group) => /* @__PURE__ */ (0, import_jsx_runtime.jsx)("optgroup", { label: group.name, children: group.models.map((model2) => /* @__PURE__ */ (0, import_jsx_runtime.jsx)("option", { value: key({ provider: group.id, model: model2.id }), children: model2.name }, model2.id)) }, group.id))
      ] })
    ] }),
    model?.reasoning && route && /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("label", { children: [
      tr(lang, "\u63A8\u7406\u5F3A\u5EA6", "Reasoning"),
      /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("select", { "aria-label": tr(lang, `${name2} \u63A8\u7406\u5F3A\u5EA6`, `${name2} reasoning`), value: route.reasoningEffort ?? "", onChange: (event) => {
        const { reasoningEffort: _old, ...physical } = route;
        onChange({ ...physical, ...event.target.value ? { reasoningEffort: event.target.value } : {} });
      }, children: [
        /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("option", { value: "", children: [
          tr(lang, "\u6A21\u578B\u9ED8\u8BA4", "Model default"),
          model.reasoning.defaultEffort ? ` \xB7 ${model.reasoning.defaultEffort}` : ""
        ] }),
        model.reasoning.efforts.map((effort) => /* @__PURE__ */ (0, import_jsx_runtime.jsx)("option", { value: effort.id, children: effort.name }, effort.id))
      ] })
    ] })
  ] });
}
function FusionSettings() {
  const lang = useLang();
  const [state, setState] = (0, import_react2.useState)();
  const [draft, setDraft] = (0, import_react2.useState)({});
  const [error, setError] = (0, import_react2.useState)();
  const [notice, setNotice] = (0, import_react2.useState)();
  const [saving, setSaving] = (0, import_react2.useState)(false);
  const chooseModel = (role2, route) => setDraft((value) => ({
    ...value,
    [role2]: route,
    ...value.cacheKeepalive ? { cacheKeepalive: { ...value.cacheKeepalive, [role2]: role2 === "lead" ? "auto" : false } } : {}
  }));
  (0, import_react2.useEffect)(() => {
    const abort = new AbortController();
    void fetch("/api/fusion-next?view=settings", { credentials: "same-origin", cache: "no-store", signal: abort.signal }).then(async (response) => {
      if (!response.ok) throw new Error(tr(lang, "\u65E0\u6CD5\u8BFB\u53D6 Fusion Next \u8BBE\u7F6E", "Cannot read Fusion Next settings"));
      return response.json();
    }).then((value) => {
      setState(value);
      setDraft(value.pair ?? {});
    }).catch((error2) => {
      if (!abort.signal.aborted) setError(String(error2));
    });
    return () => abort.abort();
  }, []);
  const save = async () => {
    if (!state || !draft.lead || !draft.worker) return;
    setSaving(true);
    setError(void 0);
    setNotice(void 0);
    try {
      const { outputTokens, ...rest } = draft;
      const limits = Object.fromEntries(Object.entries(outputTokens ?? {}).filter(([, tokens3]) => Number.isSafeInteger(tokens3) && Number(tokens3) > 0));
      const pair = { ...rest, ...Object.keys(limits).length ? { outputTokens: limits } : {} };
      const response = await fetch("/api/fusion-next", {
        method: "POST",
        credentials: "same-origin",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ action: "configure", revision: state.revision, pair })
      });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error ?? tr(lang, "\u4FDD\u5B58\u5931\u8D25\uFF0C\u8BF7\u5237\u65B0\u540E\u91CD\u8BD5", "Save failed; refresh and try again"));
      const current2 = await fetch("/api/fusion-next?view=settings", { credentials: "same-origin", cache: "no-store" });
      if (!current2.ok) throw new Error(tr(lang, "\u914D\u7F6E\u5DF2\u63D0\u4EA4\uFF0C\u4F46\u6682\u65F6\u65E0\u6CD5\u786E\u8BA4\uFF0C\u8BF7\u5237\u65B0", "Saved, but not confirmed yet; refresh"));
      const confirmed = await current2.json();
      setState(confirmed);
      setDraft(confirmed.pair ?? {});
      settingsChanged();
      setNotice(tr(lang, "\u9ED8\u8BA4\u7EC4\u5408\u5DF2\u4FDD\u5B58\u3002", "Default pair saved."));
    } catch (error2) {
      setError(error2 instanceof Error ? error2.message : String(error2));
    } finally {
      setSaving(false);
    }
  };
  return /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", { className: "fusion-settings", children: [
    /* @__PURE__ */ (0, import_jsx_runtime.jsx)("style", { children: styles }),
    /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("header", { children: [
      /* @__PURE__ */ (0, import_jsx_runtime.jsx)("h2", { children: "Fusion Next" }),
      /* @__PURE__ */ (0, import_jsx_runtime.jsx)("p", { children: tr(
        lang,
        "\u9ED8\u8BA4\u7684\u300C\u89C4\u5212 + \u6267\u884C\u300D\u7EC4\u5408\u3002\u4F1A\u8BDD\u91CC\u76F4\u63A5\u6311\u6267\u884C\u6A21\u578B\u5373\u53EF\u5F00\u542F\u53CC\u6A21\u578B\u534F\u4F5C\uFF1B\u89C4\u5212 = \u4F1A\u8BDD\u6A21\u578B\u672C\u8EAB\u3002\u6267\u884C\u8D8A\u4FBF\u5B9C\u8D8A\u7701\u3002",
        "The default planner\u2013executor pair. Pick an executor beside a session's model selector to start two-model collaboration; the planner is the session model itself. A cheaper executor saves more."
      ) })
    ] }),
    error && /* @__PURE__ */ (0, import_jsx_runtime.jsx)("p", { role: "alert", children: error }),
    !state && !error && /* @__PURE__ */ (0, import_jsx_runtime.jsx)("p", { role: "status", children: tr(lang, "\u6B63\u5728\u8BFB\u53D6\u6A21\u578B\u2026", "Loading models\u2026") }),
    state && /* @__PURE__ */ (0, import_jsx_runtime.jsxs)(import_jsx_runtime.Fragment, { children: [
      /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("fieldset", { className: "fusion-card", disabled: saving, children: [
        /* @__PURE__ */ (0, import_jsx_runtime.jsx)(ModelChoice, { role: "Lead", route: draft.lead, catalog: state.catalog, onChange: (route) => {
          if (route) chooseModel("lead", route);
        } }),
        /* @__PURE__ */ (0, import_jsx_runtime.jsx)(ModelChoice, { role: "Sidekick", route: draft.worker, catalog: state.catalog, onChange: (route) => {
          if (route) chooseModel("worker", route);
        } }),
        /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("details", { children: [
          /* @__PURE__ */ (0, import_jsx_runtime.jsx)("summary", { children: tr(lang, "\u538B\u7F29\u6A21\u578B \xB7 \u53EF\u9009", "Compaction model \xB7 optional") }),
          /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", { className: "fusion-limits", children: [
            /* @__PURE__ */ (0, import_jsx_runtime.jsx)("p", { children: tr(lang, "\u9ED8\u8BA4\u7531\u89D2\u8272\u81EA\u5DF1\u7684\u6A21\u578B\u538B\u7F29\uFF0C\u4E5F\u53EF\u5355\u72EC\u6307\u5B9A\uFF08\u7531\u6240\u9009\u8D26\u53F7\u8BA1\u8D39\uFF09\u3002", "Each role compacts with its own model unless you pin another (billed to that account).") }),
            /* @__PURE__ */ (0, import_jsx_runtime.jsx)(ModelChoice, { role: "compactor", route: draft.compactor?.route, catalog: state.catalog, onChange: (route) => setDraft((value) => {
              const { compactor, ...rest } = value;
              return route ? { ...rest, compactor: { route, maxOutputTokens: compactor?.maxOutputTokens ?? 8192 } } : rest;
            }) }),
            draft.compactor && /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("label", { children: [
              tr(lang, "\u8F93\u51FA\u4E0A\u9650", "Output limit"),
              /* @__PURE__ */ (0, import_jsx_runtime.jsx)(
                "input",
                {
                  "aria-label": tr(lang, "\u538B\u7F29\u8F93\u51FA Token \u4E0A\u9650", "Compaction output token limit"),
                  type: "number",
                  min: "1",
                  max: "128000",
                  value: draft.compactor.maxOutputTokens,
                  onChange: (event) => {
                    const maxOutputTokens = Number(event.target.value);
                    setDraft((value) => value.compactor ? { ...value, compactor: { ...value.compactor, maxOutputTokens } } : value);
                  }
                }
              )
            ] })
          ] })
        ] })
      ] }),
      /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", { className: "fusion-actions", children: [
        /* @__PURE__ */ (0, import_jsx_runtime.jsx)("p", { children: tr(lang, "\u5DF2\u914D\u5BF9\u7684\u4F1A\u8BDD\u4FDD\u7559\u539F\u7EC4\u5408\u3002", "Already-paired sessions keep their pair.") }),
        /* @__PURE__ */ (0, import_jsx_runtime.jsx)("button", { disabled: saving || !draft.lead || !draft.worker || JSON.stringify(draft) === JSON.stringify(state.pair), onClick: () => {
          void save();
        }, children: saving ? tr(lang, "\u6B63\u5728\u4FDD\u5B58\u2026", "Saving\u2026") : tr(lang, "\u4FDD\u5B58", "Save") })
      ] }),
      notice && /* @__PURE__ */ (0, import_jsx_runtime.jsx)("p", { role: "status", children: notice }),
      /* @__PURE__ */ (0, import_jsx_runtime.jsx)("p", { children: tr(lang, "\u4FDD\u5B58\u5373\u8868\u793A\u5141\u8BB8 Fusion Next \u4F7F\u7528\u6240\u9009\u6A21\u578B\u7684\u73B0\u6709\u8D26\u53F7\uFF1B\u8D39\u7528\u7531\u8FD9\u4E9B\u8D26\u53F7\u8BA1\u5165\u3002", "Saving lets Fusion Next use the chosen models' existing accounts; they are billed there.") }),
      state.pair && !state.authorized && /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("p", { role: "status", children: [
        tr(lang, "\u7EC4\u5408\u9700\u8981\u91CD\u65B0\u4FDD\u5B58\u540E\u624D\u80FD\u4F7F\u7528", "Save the pair again before use"),
        state.reason ? `: ${state.reason}` : ""
      ] }),
      state.managedAuthorization && /* @__PURE__ */ (0, import_jsx_runtime.jsx)("p", { children: tr(lang, "\u8FD0\u884C\u989D\u5EA6\u7531\u5916\u90E8\u6388\u6743\u914D\u7F6E\u7BA1\u7406\u3002", "Run limits are managed by an external authorization file.") })
    ] })
  ] });
}

// src/client/FusionHint.tsx
var import_react6 = require("react");

// src/client/FusionRecovery.tsx
var import_react3 = require("react");
var import_jsx_runtime2 = require("react/jsx-runtime");
function FusionRecovery({ sessionId, task }) {
  const lang = useLang();
  const control = task.modelControl;
  const [role2, setRole] = (0, import_react3.useState)("lead");
  const [route, setRoute] = (0, import_react3.useState)();
  const [catalog, setCatalog] = (0, import_react3.useState)();
  const [dueAt, setDueAt] = (0, import_react3.useState)("");
  const [busy, setBusy] = (0, import_react3.useState)(false);
  const [notice, setNotice] = (0, import_react3.useState)("");
  const [error, setError] = (0, import_react3.useState)("");
  const action = async (name2) => {
    setBusy(true);
    setError("");
    setNotice("");
    try {
      const response = await fetch("/api/fusion-next", {
        method: "POST",
        credentials: "same-origin",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          action: name2,
          sessionId,
          taskId: task.id,
          revision: control.revision,
          role: role2,
          route,
          ...dueAt ? { dueAt: new Date(dueAt).toISOString() } : {}
        })
      });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error ?? tr(lang, "\u64CD\u4F5C\u672A\u5B8C\u6210\uFF0C\u8BF7\u5237\u65B0\u72B6\u6001", "Not completed; refresh the status"));
      setNotice(name2 === "schedule" ? tr(lang, "\u5DF2\u8BBE\u7F6E\u4E00\u6B21\u5B9A\u65F6\u7EE7\u7EED\u3002Host \u9700\u8981\u8FD0\u884C\uFF1B\u65B0\u6D88\u606F\u4F1A\u53D6\u6D88\u5B89\u6392\u3002", "One scheduled continuation is set. The Host must be running; a new message cancels it.") : name2 === "cancel-schedule" ? tr(lang, "\u5DF2\u53D6\u6D88\u5B9A\u65F6\u7EE7\u7EED\u3002", "Scheduled continuation cancelled.") : tr(lang, "\u5DF2\u63D0\u4EA4\u7EE7\u7EED\u64CD\u4F5C\uFF0C\u72B6\u6001\u5C06\u81EA\u52A8\u66F4\u65B0\u3002", "Continuation submitted; the status updates automatically."));
    } catch (error2) {
      setError(error2 instanceof Error ? error2.message : String(error2));
    } finally {
      setBusy(false);
    }
  };
  const loadCatalog = async () => {
    setError("");
    try {
      const response = await fetch("/api/fusion-next?view=catalog", { credentials: "same-origin", cache: "no-store" });
      if (!response.ok) throw new Error(tr(lang, "\u65E0\u6CD5\u8BFB\u53D6\u6A21\u578B\u5217\u8868", "Cannot read the model list"));
      const value = await response.json();
      setCatalog({ ...value, groups: value.groups.filter((group) => group.id !== "fusion-next") });
    } catch (error2) {
      setError(String(error2));
    }
  };
  return /* @__PURE__ */ (0, import_jsx_runtime2.jsxs)("section", { className: "fusion-recovery", "aria-label": tr(lang, "Fusion Next \u6062\u590D\u64CD\u4F5C", "Fusion Next recovery"), children: [
    /* @__PURE__ */ (0, import_jsx_runtime2.jsx)("h3", { children: tr(lang, "\u7EE7\u7EED\u5F53\u524D\u4EFB\u52A1", "Continue this task") }),
    Object.entries(control.waits).filter(([, wait]) => wait?.taskId === task.id).map(([key2, wait]) => /* @__PURE__ */ (0, import_jsx_runtime2.jsxs)("p", { children: [
      key2 === "lead" ? "Lead" : "Sidekick",
      " \xB7 ",
      wait.code,
      " \xB7 ",
      wait.code === "NO_PROGRESS" ? tr(lang, "\u91CD\u590D\u64CD\u4F5C\u6CA1\u6709\u8FDB\u5C55\uFF0C\u8BF7\u8C03\u6574\u505A\u6CD5", "Repeated steps made no progress; change the approach") : wait.code === "WORKFLOW_INCOMPLETE" ? tr(lang, "\u62A5\u544A\u3001\u59D4\u6D3E\u6216\u5BA1\u67E5\u5C1A\u672A\u5B8C\u6210\uFF0C\u8BF7\u68C0\u67E5\u4EFB\u52A1\u540E\u7EE7\u7EED", "A report, handoff or review is unfinished; check the task, then continue") : wait.code.includes("QUOTA") ? tr(lang, "\u989D\u5EA6\u91CD\u7F6E\u65F6\u95F4\u672A\u77E5", "Quota reset time unknown") : tr(lang, "\u9700\u8981\u5904\u7406\u6A21\u578B\u9519\u8BEF", "A model error needs attention"),
      wait.retryNotBefore && /* @__PURE__ */ (0, import_jsx_runtime2.jsxs)("small", { children: [
        tr(lang, "\u670D\u52A1\u5546\u5EFA\u8BAE\u91CD\u8BD5\u65F6\u95F4", "Provider retry hint"),
        ": ",
        new Date(wait.retryNotBefore).toLocaleString(),
        " ",
        tr(lang, "\uFF08\u4E0D\u4EE3\u8868\u989D\u5EA6\u91CD\u7F6E\uFF09", "(not a quota reset)")
      ] })
    ] }, key2)),
    control.schedule && /* @__PURE__ */ (0, import_jsx_runtime2.jsxs)("p", { role: "status", children: [
      tr(lang, "\u5B9A\u65F6\u7EE7\u7EED", "Scheduled continuation"),
      ": ",
      new Date(control.schedule.dueAt).toLocaleString(),
      " \xB7 ",
      { scheduled: tr(lang, "\u5DF2\u5B89\u6392", "scheduled"), cancelled: tr(lang, "\u5DF2\u53D6\u6D88", "cancelled"), fired: tr(lang, "\u5DF2\u6267\u884C\u4E00\u6B21", "ran once"), failed: tr(lang, "\u672A\u80FD\u6267\u884C", "failed") }[control.schedule.state],
      control.schedule.reason ? ` \xB7 ${control.schedule.reason}` : ""
    ] }),
    control.operation && ["prepared", "dispatching"].includes(control.operation.state) && /* @__PURE__ */ (0, import_jsx_runtime2.jsx)("p", { role: "alert", children: tr(lang, "\u4E0A\u6B21\u7EE7\u7EED\u64CD\u4F5C\u7684\u6295\u9012\u7ED3\u679C\u5C1A\u672A\u786E\u8BA4\u3002\u8BF7\u68C0\u67E5\u4F1A\u8BDD\uFF1B\u7CFB\u7EDF\u4E0D\u4F1A\u81EA\u52A8\u91CD\u53D1\u3002", "Delivery of the last continuation is unconfirmed. Check the conversation; nothing is resent automatically.") }),
    (task.recovering || task.outcomeUnknown) && /* @__PURE__ */ (0, import_jsx_runtime2.jsx)("p", { role: "alert", children: tr(lang, "\u4E2D\u65AD\u7684\u64CD\u4F5C\u5C1A\u672A\u6838\u5BF9\u3002\u7EE7\u7EED\u548C\u66F4\u6362\u6A21\u578B\u90FD\u4E0D\u4F1A\u751F\u6548\uFF0C\u672C\u6B21\u4E5F\u4E0D\u4F1A\u5207\u6362\u6A21\u578B\u3002\u8BF7\u5148\u7528 /fusion-next recover <\u68C0\u67E5\u8BB0\u5F55> \u63D0\u4EA4\u6838\u5BF9\uFF0C\u518D\u7EE7\u7EED\u6216\u66F4\u6362 Sidekick\u3002\u8BBE\u7F6E\u91CC\u4FDD\u5B58\u7684\u65B0\u7EC4\u5408\u4E0D\u4F1A\u6539\u5199\u8FD9\u4E2A\u4F1A\u8BDD\u3002", "Interrupted operations are not inspected yet. Continue and model switching do nothing, and this attempt does not change the model. Record the inspection with /fusion-next recover <note>, then continue or switch the Sidekick. A new pair saved in Settings does not rewrite this conversation.") }),
    error && /* @__PURE__ */ (0, import_jsx_runtime2.jsx)("p", { role: "alert", children: error }),
    notice && /* @__PURE__ */ (0, import_jsx_runtime2.jsx)("p", { role: "status", children: notice }),
    /* @__PURE__ */ (0, import_jsx_runtime2.jsxs)("fieldset", { disabled: busy || task.unsettledTools > 0 || task.pendingApprovals > 0 || task.recovering || task.outcomeUnknown, children: [
      /* @__PURE__ */ (0, import_jsx_runtime2.jsx)("button", { onClick: () => {
        void action("continue");
      }, children: tr(lang, "\u7EE7\u7EED\u4E00\u6B21", "Continue once") }),
      /* @__PURE__ */ (0, import_jsx_runtime2.jsxs)("details", { children: [
        /* @__PURE__ */ (0, import_jsx_runtime2.jsx)("summary", { onClick: () => {
          if (!catalog) void loadCatalog();
        }, children: tr(lang, "\u66F4\u6362\u89D2\u8272\u6A21\u578B\u5E76\u7EE7\u7EED", "Switch a role model and continue") }),
        /* @__PURE__ */ (0, import_jsx_runtime2.jsxs)("label", { children: [
          tr(lang, "\u89D2\u8272", "Role"),
          " ",
          /* @__PURE__ */ (0, import_jsx_runtime2.jsxs)("select", { value: role2, onChange: (event) => {
            setRole(event.target.value);
            setRoute(void 0);
          }, children: [
            /* @__PURE__ */ (0, import_jsx_runtime2.jsx)("option", { value: "lead", children: "Lead" }),
            /* @__PURE__ */ (0, import_jsx_runtime2.jsx)("option", { value: "worker", children: "Sidekick" })
          ] })
        ] }),
        catalog && /* @__PURE__ */ (0, import_jsx_runtime2.jsx)(ModelChoice, { role: role2 === "lead" ? "Lead" : "Sidekick", route, catalog, onChange: setRoute }),
        /* @__PURE__ */ (0, import_jsx_runtime2.jsx)("p", { children: tr(lang, "\u4EC5\u66F4\u6362\u5F53\u524D\u4F1A\u8BDD\u7684\u89D2\u8272\u6A21\u578B\uFF0C\u4FDD\u7559\u4EFB\u52A1\u4E0E Sidekick \u4F1A\u8BDD\u3002\u540E\u7EED\u8BF7\u6C42\u4F7F\u7528\u65B0\u6A21\u578B\u7684\u8D26\u53F7\u3002", "Changes this conversation's role model only; the task and the Sidekick session are kept. Later requests use the new model's account.") }),
        /* @__PURE__ */ (0, import_jsx_runtime2.jsx)("button", { disabled: !route, onClick: () => {
          void action("switch-role");
        }, children: tr(lang, "\u66F4\u6362\u5E76\u7EE7\u7EED\u4E00\u6B21", "Switch and continue once") })
      ] }),
      /* @__PURE__ */ (0, import_jsx_runtime2.jsxs)("details", { children: [
        /* @__PURE__ */ (0, import_jsx_runtime2.jsx)("summary", { children: tr(lang, "\u5B9A\u65F6\u7EE7\u7EED\u4E00\u6B21", "Continue once at a time") }),
        /* @__PURE__ */ (0, import_jsx_runtime2.jsxs)("label", { children: [
          tr(lang, "\u672C\u5730\u65F6\u95F4", "Local time"),
          " ",
          /* @__PURE__ */ (0, import_jsx_runtime2.jsx)("input", { "aria-label": tr(lang, "\u5B9A\u65F6\u7EE7\u7EED\u65F6\u95F4", "Continuation time"), type: "datetime-local", value: dueAt, onChange: (event) => setDueAt(event.target.value) })
        ] }),
        /* @__PURE__ */ (0, import_jsx_runtime2.jsx)("p", { children: tr(lang, "\u6309\u4F60\u9009\u62E9\u7684\u65F6\u95F4\u5C1D\u8BD5\u4E00\u6B21\uFF1B\u518D\u6B21\u9047\u5230\u989D\u5EA6\u9519\u8BEF\u4F1A\u505C\u6B62\u3002\u6B64\u65F6\u95F4\u4E0D\u4EE3\u8868\u670D\u52A1\u5546\u627F\u8BFA\u7684\u6062\u590D\u65F6\u95F4\u3002", "Tries once at the time you choose and stops on another quota error. It is not a provider-promised reset time.") }),
        /* @__PURE__ */ (0, import_jsx_runtime2.jsx)("button", { disabled: !dueAt, onClick: () => {
          void action("schedule");
        }, children: tr(lang, "\u8BBE\u7F6E\u65F6\u95F4", "Set time") }),
        control.schedule?.state === "scheduled" && /* @__PURE__ */ (0, import_jsx_runtime2.jsx)("button", { onClick: () => {
          void action("cancel-schedule");
        }, children: tr(lang, "\u53D6\u6D88\u5B89\u6392", "Cancel") })
      ] })
    ] })
  ] });
}

// src/client/FusionStatus.tsx
var import_react5 = require("react");

// src/client/status-polling.ts
var import_react4 = require("react");
var entries = /* @__PURE__ */ new Map();
var visible = () => document.visibilityState !== "hidden";
var running = /* @__PURE__ */ new Set(["\u5206\u6790", "\u6267\u884C", "\u4FEE\u6539", "\u5BA1\u67E5", "\u9A8C\u8BC1", "\u6B63\u5728\u505C\u6B62"]);
function subscribe(sessionId, listener, expanded) {
  let entry = entries.get(sessionId);
  if (!entry) {
    entry = { listeners: /* @__PURE__ */ new Map(), busy: false, visibility: () => {
    } };
    entries.set(sessionId, entry);
    const own2 = entry;
    const active = () => entries.get(sessionId) === own2 && own2.listeners.size > 0;
    const publish = (snapshot) => {
      if (!active()) return;
      own2.snapshot = snapshot;
      for (const notify2 of own2.listeners.keys()) notify2();
    };
    const refresh = async () => {
      if (!active() || own2.busy || !visible()) return;
      clearTimeout(own2.timer);
      own2.busy = true;
      const abort = new AbortController();
      own2.abort = abort;
      const deadline = setTimeout(() => {
        if (active() && visible()) publish({ sessionId, failed: true });
        abort.abort();
      }, 1e4);
      try {
        const response = await fetch(
          `/api/fusion-next?view=status&sessionId=${encodeURIComponent(sessionId)}`,
          { credentials: "same-origin", cache: "no-store", signal: abort.signal }
        );
        if (!response.ok) throw new Error("unavailable");
        const status = await response.json();
        if (status.schemaVersion !== 1 || status.sessionId !== sessionId) throw new Error("mismatched status");
        if (!abort.signal.aborted) publish({ sessionId, status, failed: false });
      } catch {
        if (!abort.signal.aborted) publish({ sessionId, failed: true });
      } finally {
        clearTimeout(deadline);
        own2.busy = false;
        if (active() && visible()) {
          const fast = [...own2.listeners.values()].some((value) => value()) && running.has(own2.snapshot?.status?.task?.stage ?? "");
          own2.timer = setTimeout(() => {
            void refresh();
          }, fast ? 2e3 : 15e3);
        }
      }
    };
    own2.visibility = () => {
      clearTimeout(own2.timer);
      if (!visible()) own2.abort?.abort();
      else void refresh();
    };
    document.addEventListener("visibilitychange", own2.visibility);
  }
  entry.listeners.set(listener, expanded);
  if (entry.listeners.size === 1 || expanded()) entry.visibility();
  const own = entry;
  return () => {
    own.listeners.delete(listener);
    if (own.listeners.size) return;
    entries.delete(sessionId);
    clearTimeout(own.timer);
    own.abort?.abort();
    document.removeEventListener("visibilitychange", own.visibility);
  };
}
function useFusionStatus(sessionId, expandedTask, attentionOnly = false) {
  const expandedRef = (0, import_react4.useRef)(expandedTask), attentionRef = (0, import_react4.useRef)(attentionOnly);
  expandedRef.current = expandedTask;
  attentionRef.current = attentionOnly;
  (0, import_react4.useEffect)(() => {
    if (expandedTask) entries.get(sessionId)?.visibility();
  }, [sessionId, expandedTask]);
  return (0, import_react4.useSyncExternalStore)(
    (0, import_react4.useCallback)((listener) => subscribe(sessionId, listener, () => {
      const task = entries.get(sessionId)?.snapshot?.status?.task;
      return expandedRef.current !== void 0 && task?.id === expandedRef.current && (!attentionRef.current || task.attention);
    }), [sessionId]),
    (0, import_react4.useCallback)(() => entries.get(sessionId)?.snapshot, [sessionId]),
    () => void 0
  );
}

// src/client/FusionStatus.tsx
var import_jsx_runtime3 = require("react/jsx-runtime");
var styles2 = `
.fusion-status{margin:8px 12px;color:var(--dsw-alias-label-primary);font-size:13px;line-height:1.5;overflow-wrap:anywhere}
.fusion-status>summary{cursor:pointer;min-height:44px;display:flex;align-items:center;gap:12px;list-style:none;border-top:1px solid var(--dsw-alias-border-l2);outline-offset:2px}
.fusion-status>summary::before{content:'\u203A';font-size:18px;flex:none}.fusion-status[open]>summary::before{content:'\u2304'}
.fusion-status>summary:focus-visible{outline:2px solid var(--dsw-alias-brand-primary)}
.fusion-status .fusion-status-label{font-weight:600}.fusion-status .fusion-status-count{margin-left:auto;color:var(--dsw-alias-label-secondary);white-space:nowrap}
.fusion-status .fusion-status-detail{max-height:320px;overflow:auto;padding:4px 4px 12px 0;scrollbar-gutter:stable}
.fusion-status .fusion-recovery fieldset{border:0;padding:0;display:flex;flex-direction:column;gap:10px}.fusion-recovery :is(button,select,input){font:inherit;color:var(--dsw-alias-label-primary);border:1px solid var(--dsw-alias-border-l2);border-radius:6px;padding:7px;max-width:100%}.fusion-recovery :is(select,input,option,optgroup){background-color:var(--dsw-alias-bg-layer-1);color:var(--dsw-alias-label-primary);color-scheme:inherit}.fusion-recovery button{cursor:pointer;background-color:var(--dsw-alias-button-elevated-fill)}.fusion-recovery :is(button,input,select):focus-visible{outline:2px solid var(--dsw-alias-brand-primary)}.fusion-recovery [role=alert]{color:var(--dsw-alias-state-error-primary)}
.fusion-status:has(.fusion-recovery) .fusion-status-detail{max-height:min(65vh,640px)}.fusion-recovery details>summary{padding:8px 0;cursor:pointer}
.fusion-status p{margin:4px 0 12px}.fusion-status h3{font-size:13px;margin:16px 0 4px;font-weight:600}
.fusion-status dl{margin:0;display:grid;grid-template-columns:minmax(72px,auto) minmax(0,1fr);gap:4px 12px}
.fusion-status dt{color:var(--dsw-alias-label-secondary)}.fusion-status dd{margin:0;min-width:0}
.fusion-status ul{list-style:none;margin:0;padding:0}.fusion-status li{padding:6px 0;border-bottom:1px solid var(--dsw-alias-border-l2)}
.fusion-status small{display:block;color:var(--dsw-alias-label-secondary);font-size:12px}
@media(max-width:400px){.fusion-status>summary{gap:8px}.fusion-status .fusion-status-detail{max-height:280px}}
`;
var role = (value) => value === "lead" ? "Lead" : "Sidekick";
var purposeOf = (lang, value) => ({
  conversation: tr(lang, "\u4EFB\u52A1", "task"),
  compaction: tr(lang, "\u538B\u7F29", "compaction"),
  "cache-keepalive": tr(lang, "\u4FDD\u6D3B", "keepalive"),
  "session-title": tr(lang, "\u6807\u9898", "title")
})[value] ?? value;
var outcomeOf = (lang, value) => ({
  entered: tr(lang, "\u8BF7\u6C42\u4E2D", "in progress"),
  stop: tr(lang, "\u5DF2\u8FD4\u56DE", "returned"),
  "tool-calls": tr(lang, "\u8C03\u7528\u5DE5\u5177", "tool calls"),
  "max-tokens": tr(lang, "\u8F93\u51FA\u622A\u65AD", "output truncated"),
  aborted: tr(lang, "\u5DF2\u4E2D\u65AD", "aborted"),
  error: tr(lang, "\u8BF7\u6C42\u5931\u8D25", "failed"),
  unknown: tr(lang, "\u7ED3\u675F\u72B6\u6001\u672A\u77E5", "unknown end")
})[value] ?? value;
var toolStateOf = (lang, value) => ({
  "dispatch-started": tr(lang, "\u6267\u884C\u672A\u6536\u5C3E", "unfinished"),
  returned: tr(lang, "\u5DF2\u8FD4\u56DE", "returned"),
  "outcome-unknown": tr(lang, "\u7ED3\u679C\u672A\u77E5", "outcome unknown"),
  inspected: tr(lang, "\u5DF2\u4EBA\u5DE5\u68C0\u67E5", "inspected")
})[value] ?? value;
var countOf = (lang, value) => value.totalRequests === 0 ? "\u2014" : value.reportedRequests === 0 ? tr(lang, "\u672A\u63D0\u4F9B", "not reported") : `${value.knownTokens.toLocaleString()}${value.reportedRequests < value.totalRequests ? tr(lang, `\uFF08${value.reportedRequests}/${value.totalRequests} \u6B21\u6709\u62A5\u544A\uFF09`, ` (${value.reportedRequests}/${value.totalRequests} reported)`) : ""}`;
var noteStyle = { margin: "8px 12px", color: "var(--dsw-alias-label-secondary)", fontSize: 12, lineHeight: 1.5 };
function FusionTaskOverview({ sessionId, task }) {
  const lang = useLang();
  const verification = task.automatedChecks === 0 && task.verification === "verified" ? tr(lang, "\u4EC5\u7ECF Lead \u5BA1\u67E5\uFF08\u672A\u8FD0\u884C\u81EA\u52A8\u68C0\u67E5\uFF09", "Lead review only (no automated checks ran)") : { verified: tr(lang, "\u9A8C\u8BC1\u901A\u8FC7", "verified"), partial: tr(lang, "\u90E8\u5206\u9A8C\u8BC1", "partly verified"), unverified: tr(lang, "\u5C1A\u672A\u9A8C\u8BC1", "unverified") }[task.verification];
  const detail = lang === "en" && task.detailEn !== void 0 ? task.detailEn : task.detail;
  return /* @__PURE__ */ (0, import_jsx_runtime3.jsxs)(import_jsx_runtime3.Fragment, { children: [
    /* @__PURE__ */ (0, import_jsx_runtime3.jsx)("p", { children: detail ?? (task.stage === "\u5B8C\u6210" ? tr(lang, `\u672C\u8F6E\u4EFB\u52A1\u5DF2\u7ED3\u675F \xB7 ${verification}`, `This task has finished \xB7 ${verification}`) : tr(lang, `\u672C\u8F6E\u4EFB\u52A1 \xB7 ${verification}`, `This task \xB7 ${verification}`)) }),
    task.modelControl && task.stage !== "\u5B8C\u6210" && /* @__PURE__ */ (0, import_jsx_runtime3.jsx)(FusionRecovery, { sessionId, task }),
    /* @__PURE__ */ (0, import_jsx_runtime3.jsxs)("dl", { children: [
      /* @__PURE__ */ (0, import_jsx_runtime3.jsx)("dt", { children: "Lead" }),
      /* @__PURE__ */ (0, import_jsx_runtime3.jsxs)("dd", { children: [
        task.models.lead.model,
        /* @__PURE__ */ (0, import_jsx_runtime3.jsx)("small", { children: task.models.lead.provider })
      ] }),
      /* @__PURE__ */ (0, import_jsx_runtime3.jsx)("dt", { children: "Sidekick" }),
      /* @__PURE__ */ (0, import_jsx_runtime3.jsxs)("dd", { children: [
        task.models.worker.model,
        /* @__PURE__ */ (0, import_jsx_runtime3.jsxs)("small", { children: [
          task.models.worker.provider,
          task.workerId ? tr(lang, " \xB7 \u5DF2\u5EFA\u7ACB\u6301\u7EED\u4F1A\u8BDD", " \xB7 persistent session") : tr(lang, " \xB7 \u5C1A\u672A\u59D4\u6D3E", " \xB7 not delegated yet")
        ] })
      ] }),
      task.models.compactor && /* @__PURE__ */ (0, import_jsx_runtime3.jsxs)(import_jsx_runtime3.Fragment, { children: [
        /* @__PURE__ */ (0, import_jsx_runtime3.jsx)("dt", { children: tr(lang, "\u538B\u7F29\u6A21\u578B", "Compaction") }),
        /* @__PURE__ */ (0, import_jsx_runtime3.jsxs)("dd", { children: [
          task.models.compactor.model,
          /* @__PURE__ */ (0, import_jsx_runtime3.jsx)("small", { children: task.models.compactor.provider })
        ] })
      ] }),
      /* @__PURE__ */ (0, import_jsx_runtime3.jsx)("dt", { children: tr(lang, "\u5F85\u786E\u8BA4", "Pending approvals") }),
      /* @__PURE__ */ (0, import_jsx_runtime3.jsx)("dd", { children: task.pendingApprovals }),
      /* @__PURE__ */ (0, import_jsx_runtime3.jsx)("dt", { children: tr(lang, "\u672A\u6536\u5C3E\u5DE5\u5177", "Unsettled tools") }),
      /* @__PURE__ */ (0, import_jsx_runtime3.jsx)("dd", { children: task.unsettledTools })
    ] })
  ] });
}
function FusionTaskActivity({ task }) {
  const lang = useLang();
  const purpose2 = (value) => purposeOf(lang, value), outcome = (value) => outcomeOf(lang, value);
  const toolState = (value) => toolStateOf(lang, value), count = (value) => countOf(lang, value);
  const { usage } = task;
  const share = (role2) => {
    const total = usage.byRole.lead.output.knownTokens + usage.byRole.worker.output.knownTokens;
    return total ? tr(lang, ` \xB7 \u8F93\u51FA\u5360 ${Math.round(usage.byRole[role2].output.knownTokens / total * 100)}%`, ` \xB7 ${Math.round(usage.byRole[role2].output.knownTokens / total * 100)}% of output`) : "";
  };
  return /* @__PURE__ */ (0, import_jsx_runtime3.jsxs)(import_jsx_runtime3.Fragment, { children: [
    /* @__PURE__ */ (0, import_jsx_runtime3.jsx)("h3", { children: tr(lang, "\u672C\u8F6E\u7528\u91CF", "Usage this task") }),
    /* @__PURE__ */ (0, import_jsx_runtime3.jsxs)("dl", { children: [
      /* @__PURE__ */ (0, import_jsx_runtime3.jsx)("dt", { children: tr(lang, "\u6A21\u578B\u8BF7\u6C42", "Model requests") }),
      /* @__PURE__ */ (0, import_jsx_runtime3.jsxs)("dd", { children: [
        usage.calls,
        /* @__PURE__ */ (0, import_jsx_runtime3.jsx)("small", { children: tr(lang, `\u542B\u538B\u7F29 ${usage.compactionCalls} \u6B21\u3001\u4FDD\u6D3B ${usage.keepaliveCalls} \u6B21`, `incl. ${usage.compactionCalls} compaction, ${usage.keepaliveCalls} keepalive`) })
      ] }),
      /* @__PURE__ */ (0, import_jsx_runtime3.jsx)("dt", { children: tr(lang, "\u7528\u91CF\u62A5\u544A", "Usage reports") }),
      /* @__PURE__ */ (0, import_jsx_runtime3.jsx)("dd", { children: tr(lang, `${usage.finalCalls} \u6B21\u5DF2\u5B9A\u7A3F \xB7 ${usage.provisionalCalls} \u6B21\u6682\u62A5 \xB7 ${usage.unreportedCalls} \u6B21\u672A\u63D0\u4F9B`, `${usage.finalCalls} final \xB7 ${usage.provisionalCalls} provisional \xB7 ${usage.unreportedCalls} unreported`) }),
      /* @__PURE__ */ (0, import_jsx_runtime3.jsx)("dt", { children: tr(lang, "\u8F93\u5165 Token", "Input tokens") }),
      /* @__PURE__ */ (0, import_jsx_runtime3.jsxs)("dd", { children: [
        count(usage.input),
        /* @__PURE__ */ (0, import_jsx_runtime3.jsx)("small", { children: tr(lang, "\u5DF2\u62A5\u544A\u7684\u672A\u7F13\u5B58\u8F93\u5165", "reported uncached input") })
      ] }),
      /* @__PURE__ */ (0, import_jsx_runtime3.jsx)("dt", { children: tr(lang, "\u7F13\u5B58\u8BFB\u53D6", "Cache read") }),
      /* @__PURE__ */ (0, import_jsx_runtime3.jsx)("dd", { children: count(usage.cacheRead) }),
      /* @__PURE__ */ (0, import_jsx_runtime3.jsx)("dt", { children: tr(lang, "\u8F93\u51FA Token", "Output tokens") }),
      /* @__PURE__ */ (0, import_jsx_runtime3.jsx)("dd", { children: count(usage.output) }),
      /* @__PURE__ */ (0, import_jsx_runtime3.jsx)("dt", { children: tr(lang, "\u5B9E\u9645\u8D39\u7528", "Actual cost") }),
      /* @__PURE__ */ (0, import_jsx_runtime3.jsxs)("dd", { children: [
        tr(lang, "\u672A\u77E5", "unknown"),
        /* @__PURE__ */ (0, import_jsx_runtime3.jsx)("small", { children: tr(lang, "\u5F53\u524D\u8D26\u53F7\u672A\u63D0\u4F9B\u53EF\u9760\u8D26\u5355\u91D1\u989D", "the account reports no reliable billed amount") })
      ] })
    ] }),
    /* @__PURE__ */ (0, import_jsx_runtime3.jsx)("h3", { children: tr(lang, "\u6309\u89D2\u8272", "By role") }),
    /* @__PURE__ */ (0, import_jsx_runtime3.jsx)("dl", { children: ["lead", "worker"].map((role2) => /* @__PURE__ */ (0, import_jsx_runtime3.jsxs)(import_react5.Fragment, { children: [
      /* @__PURE__ */ (0, import_jsx_runtime3.jsx)("dt", { children: role2 === "lead" ? "Lead" : "Sidekick" }),
      /* @__PURE__ */ (0, import_jsx_runtime3.jsxs)("dd", { children: [
        tr(lang, `${usage.byRole[role2].calls} \u6B21`, `${usage.byRole[role2].calls} requests`),
        " \xB7 ",
        tr(lang, "\u8F93\u51FA", "output"),
        " ",
        count(usage.byRole[role2].output),
        /* @__PURE__ */ (0, import_jsx_runtime3.jsxs)("small", { children: [
          tr(lang, "\u8F93\u5165", "input"),
          " ",
          count(usage.byRole[role2].input),
          " \xB7 ",
          tr(lang, "\u7F13\u5B58\u8BFB\u53D6", "cache read"),
          " ",
          count(usage.byRole[role2].cacheRead),
          share(role2)
        ] })
      ] })
    ] }, role2)) }),
    /* @__PURE__ */ (0, import_jsx_runtime3.jsx)("small", { children: tr(lang, "Token \u6570\u5305\u542B\u6682\u62A5\u6570\u636E\uFF1B\u7F3A\u5931\u5B57\u6BB5\u4E0D\u8BA1\u4E3A 0\u3002\u8BF7\u6C42\u6570\u6765\u81EA DSH\uFF0C\u4F9B\u5E94\u5546\u5185\u90E8\u91CD\u8BD5\u6B21\u6570\u672A\u77E5\u3002", "Token counts include provisional data; missing fields are not counted as 0. Request counts come from DSH; provider-internal retries are unknown.") }),
    /* @__PURE__ */ (0, import_jsx_runtime3.jsx)("h3", { children: tr(lang, "\u6700\u8FD1\u4E0A\u4E0B\u6587\u68C0\u67E5", "Recent context checks") }),
    task.contexts.length ? /* @__PURE__ */ (0, import_jsx_runtime3.jsx)("ul", { children: task.contexts.map((context) => /* @__PURE__ */ (0, import_jsx_runtime3.jsxs)("li", { children: [
      role(context.role),
      " \xB7 ",
      purpose2(context.purpose),
      " \xB7 ",
      context.admitted ? tr(lang, "\u53EF\u53D1\u9001", "admitted") : tr(lang, "\u8D85\u51FA\u9884\u7B97", "over budget"),
      /* @__PURE__ */ (0, import_jsx_runtime3.jsxs)("small", { children: [
        context.inputTokens.toLocaleString(),
        " / ",
        context.budget.toLocaleString(),
        " Token \xB7 ",
        context.quality === "exact" ? tr(lang, "\u7CBE\u786E\u8BA1\u6570", "exact") : tr(lang, "\u4F30\u7B97", "estimated")
      ] })
    ] }, context.role)) }) : /* @__PURE__ */ (0, import_jsx_runtime3.jsx)("small", { children: tr(lang, "\u5C1A\u65E0\u4E0A\u4E0B\u6587\u68C0\u67E5\u8BB0\u5F55\u3002", "No context checks yet.") }),
    /* @__PURE__ */ (0, import_jsx_runtime3.jsx)("h3", { children: tr(lang, "\u6700\u8FD1\u6A21\u578B\u8BF7\u6C42", "Recent model requests") }),
    task.requests.length ? /* @__PURE__ */ (0, import_jsx_runtime3.jsx)("ul", { children: task.requests.map((request) => /* @__PURE__ */ (0, import_jsx_runtime3.jsxs)("li", { children: [
      role(request.role),
      " \xB7 ",
      purpose2(request.purpose),
      " \xB7 ",
      outcome(request.outcome),
      /* @__PURE__ */ (0, import_jsx_runtime3.jsxs)("small", { children: [
        request.model,
        " \xB7 ",
        request.provider,
        " \xB7 ",
        request.authority === "final" ? tr(lang, "\u7528\u91CF\u5DF2\u5B9A\u7A3F", "usage final") : request.authority === "provisional" ? tr(lang, "\u7528\u91CF\u6682\u62A5", "usage provisional") : tr(lang, "\u7528\u91CF\u672A\u63D0\u4F9B", "usage not reported")
      ] })
    ] }, request.id)) }) : /* @__PURE__ */ (0, import_jsx_runtime3.jsx)("small", { children: tr(lang, "\u5C1A\u672A\u53D1\u51FA\u6A21\u578B\u8BF7\u6C42\u3002", "No model requests yet.") }),
    /* @__PURE__ */ (0, import_jsx_runtime3.jsx)("h3", { children: tr(lang, "\u6700\u8FD1\u547D\u4EE4\u4E0E\u5199\u5165", "Recent commands and writes") }),
    task.tools.length ? /* @__PURE__ */ (0, import_jsx_runtime3.jsx)("ul", { children: task.tools.map((tool) => /* @__PURE__ */ (0, import_jsx_runtime3.jsxs)("li", { children: [
      role(tool.role),
      " \xB7 ",
      tool.name,
      " \xB7 ",
      tool.failed ? tr(lang, "\u8FD4\u56DE\u9519\u8BEF", "error") : toolState(tool.state)
    ] }, tool.id)) }) : /* @__PURE__ */ (0, import_jsx_runtime3.jsx)("small", { children: tr(lang, "\u5C1A\u65E0\u5DE5\u5177\u6267\u884C\u8BB0\u5F55\u3002", "No tool runs yet.") }),
    /* @__PURE__ */ (0, import_jsx_runtime3.jsx)("small", { children: tr(lang, "\u663E\u793A\u6700\u8FD1 12 \u6B21\u8BF7\u6C42\u30018 \u9879\u547D\u4EE4\u6216\u5199\u5165\u64CD\u4F5C\uFF1B\u7528\u91CF\u6C47\u603B\u8986\u76D6\u672C\u8F6E\u5168\u90E8\u8BF7\u6C42\u3002\u8BFB\u53D6\u64CD\u4F5C\u4ECD\u53EF\u5728\u4F1A\u8BDD\u4E2D\u67E5\u770B\u3002", "Shows the last 12 requests and 8 commands or writes; usage totals cover all requests of this task. Reads remain visible in the conversation.") })
  ] });
}
function FusionStatus({ sessionId, attentionOnly = false }) {
  const lang = useLang();
  const [expandedTask, setExpandedTask] = (0, import_react5.useState)();
  const snapshot = useFusionStatus(sessionId, expandedTask, attentionOnly);
  if (!snapshot || snapshot.sessionId !== sessionId) return attentionOnly ? null : /* @__PURE__ */ (0, import_jsx_runtime3.jsx)("p", { style: noteStyle, role: "status", children: tr(lang, "\u6B63\u5728\u8BFB\u53D6 Fusion \u72B6\u6001\u2026", "Loading Fusion status\u2026") });
  if (snapshot.failed) return attentionOnly ? null : /* @__PURE__ */ (0, import_jsx_runtime3.jsx)("p", { style: noteStyle, role: "status", children: tr(lang, "Fusion \u72B6\u6001\u6682\u65F6\u65E0\u6CD5\u66F4\u65B0\uFF0C\u6062\u590D\u8FDE\u63A5\u540E\u4F1A\u91CD\u8BD5\u3002\u53EF\u7528 /fusion-next status \u67E5\u770B\u3002", "Fusion status cannot update right now; it retries when reconnected. Use /fusion-next status.") });
  const task = snapshot.status?.task;
  if (!snapshot.status?.selected || !task) return null;
  if (attentionOnly && !task.attention) return null;
  const stage = lang === "en" ? task.stageEn ?? task.stage : task.stage;
  return /* @__PURE__ */ (0, import_jsx_runtime3.jsxs)("details", { className: "fusion-status", onToggle: (event) => setExpandedTask(event.currentTarget.open ? task.id : void 0), children: [
    /* @__PURE__ */ (0, import_jsx_runtime3.jsx)("style", { children: styles2 }),
    /* @__PURE__ */ (0, import_jsx_runtime3.jsxs)("summary", { "aria-label": tr(lang, `Fusion Next \xB7 ${stage}\uFF0C\u4EFB\u52A1\u8BE6\u60C5`, `Fusion Next \xB7 ${stage}, task details`), "data-ud-check": "fusion-status-summary", children: [
      /* @__PURE__ */ (0, import_jsx_runtime3.jsxs)("span", { className: "fusion-status-label", role: "status", children: [
        "Fusion Next \xB7 ",
        stage
      ] }),
      /* @__PURE__ */ (0, import_jsx_runtime3.jsx)("span", { className: "fusion-status-count", children: tr(lang, `${task.usage.calls} \u6B21\u8BF7\u6C42`, `${task.usage.calls} requests`) }),
      /* @__PURE__ */ (0, import_jsx_runtime3.jsx)("span", { children: tr(lang, "\u8BE6\u60C5", "Details") })
    ] }),
    /* @__PURE__ */ (0, import_jsx_runtime3.jsxs)("div", { className: "fusion-status-detail", tabIndex: 0, "aria-label": tr(lang, "Fusion Next \u4EFB\u52A1\u8BE6\u60C5", "Fusion Next task details"), "data-ud-check": "fusion-status-detail", children: [
      /* @__PURE__ */ (0, import_jsx_runtime3.jsx)(FusionTaskOverview, { sessionId, task }),
      /* @__PURE__ */ (0, import_jsx_runtime3.jsx)(FusionTaskActivity, { task })
    ] })
  ] }, task.id);
}

// src/client/FusionHint.tsx
var import_jsx_runtime4 = require("react/jsx-runtime");
function FusionDockAttention({ sessionId }) {
  return /* @__PURE__ */ (0, import_jsx_runtime4.jsx)(FusionStatus, { sessionId, attentionOnly: true });
}
function FusionHint({ sessionId, directory, load }) {
  const selected = (0, import_react6.useSyncExternalStore)(directory.subscribe, directory.getSnapshot).current;
  const fusion = selected?.provider === "fusion-next" && selected.model === "auto";
  const lang = useLang();
  const [message, setMessage] = (0, import_react6.useState)();
  (0, import_react6.useEffect)(() => {
    load();
  }, [load]);
  (0, import_react6.useEffect)(() => {
    if (!fusion) {
      setMessage(void 0);
      return;
    }
    let active = true;
    const abort = new AbortController();
    const refresh = () => {
      void fetch("/api/fusion-next?view=settings", { credentials: "same-origin", cache: "no-store", signal: abort.signal }).then(async (response) => {
        if (!response.ok) throw new Error("unavailable");
        return response.json();
      }).then((state) => {
        if (active) setMessage(!state.pair ? tr(lang, "Fusion \u5C1A\u672A\u914D\u7F6E\u6A21\u578B\uFF0C\u8BF7\u524D\u5F80\u8BBE\u7F6E \u2192 Fusion \u9009\u62E9 Lead \u548C Sidekick\u3002", "Fusion has no models yet: open Settings \u2192 Fusion Next and choose a Lead and a Sidekick.") : !state.authorized ? tr(lang, "Fusion \u5F53\u524D\u914D\u7F6E\u672A\u5C31\u7EEA\uFF0C\u8BF7\u524D\u5F80\u8BBE\u7F6E \u2192 Fusion \u67E5\u770B\u3002", "The Fusion setup is not ready: see Settings \u2192 Fusion Next.") : void 0);
      }).catch(() => {
        if (active) setMessage(tr(lang, "\u6682\u65F6\u65E0\u6CD5\u786E\u8BA4 Fusion \u914D\u7F6E\uFF0C\u8BF7\u524D\u5F80\u8BBE\u7F6E \u2192 Fusion \u67E5\u770B\u3002", "Cannot confirm the Fusion setup right now: see Settings \u2192 Fusion Next."));
      });
    };
    refresh();
    const off = onSettingsChanged(refresh);
    return () => {
      active = false;
      abort.abort();
      off();
    };
  }, [fusion, lang]);
  if (!fusion) return null;
  return /* @__PURE__ */ (0, import_jsx_runtime4.jsxs)(import_jsx_runtime4.Fragment, { children: [
    message && /* @__PURE__ */ (0, import_jsx_runtime4.jsx)("p", { role: "status", style: { margin: "8px 12px", color: "var(--dsw-alias-label-secondary)", fontSize: 12, lineHeight: "18px" }, children: message }),
    /* @__PURE__ */ (0, import_jsx_runtime4.jsx)(FusionStatus, { sessionId, attentionOnly: true })
  ] });
}

// src/client/FusionPairPicker.tsx
var import_react7 = require("react");
var import_jsx_runtime5 = require("react/jsx-runtime");
var styles3 = `
.fusion-executor{display:flex;align-items:center;gap:6px;min-width:0}
.fusion-executor .fusion-executor-mark{display:flex;align-items:center;gap:4px;color:var(--dsw-alias-label-secondary);flex:none}
.fusion-executor .fusion-executor-label{display:var(--dsh-composer-model-text-display,inline);font-size:12px;white-space:nowrap}
.fusion-executor select{font:inherit;font-size:12px;height:28px;max-width:190px;min-width:0;padding:0 6px;border-radius:6px;cursor:pointer;
  border:1px solid var(--dsw-alias-border-l2);background-color:var(--dsw-alias-bg-layer-1);color:var(--dsw-alias-label-primary);color-scheme:inherit;
  text-overflow:ellipsis;white-space:nowrap;overflow:hidden}
.fusion-executor select[data-active=true]{border-color:var(--dsw-alias-brand-primary);color:var(--dsw-alias-brand-primary)}
.fusion-executor select:disabled{cursor:default;opacity:.6}
.fusion-executor select:focus-visible{outline:2px solid var(--dsw-alias-brand-primary);outline-offset:1px}
.fusion-executor [role=status]{font-size:12px;color:var(--dsw-alias-state-error-primary);white-space:nowrap}
`;
var keyOf = (route) => `${route.provider}/${route.model}`;
var routeOf = (key2) => {
  const cut = key2.indexOf("/");
  return cut > 0 ? { provider: key2.slice(0, cut), model: key2.slice(cut + 1) } : void 0;
};
function FusionPairPicker({ sessionId, directory, load }) {
  const lang = useLang();
  const [view, setView] = (0, import_react7.useState)();
  const [busy, setBusy] = (0, import_react7.useState)(false);
  const [error, setError] = (0, import_react7.useState)();
  const refresh = () => {
    void fetch(
      `/api/fusion-next?view=session-pair&sessionId=${encodeURIComponent(sessionId)}`,
      { credentials: "same-origin", cache: "no-store" }
    ).then(async (response) => response.ok ? response.json() : void 0).then((data) => setView(data)).catch(() => setView(void 0));
  };
  (0, import_react7.useEffect)(() => {
    load();
    refresh();
  }, [load, sessionId]);
  const choose = (value) => {
    if (busy) return;
    setBusy(true);
    setError(void 0);
    void fetch("/api/fusion-next", {
      method: "POST",
      credentials: "same-origin",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ action: "session-pair", sessionId, worker: value ? routeOf(value) ?? null : null })
    }).then(async (response) => {
      if (!response.ok) {
        const body = await response.json().catch(() => ({}));
        throw new Error(body.error ?? `HTTP ${response.status}`);
      }
      refresh();
    }).catch((cause) => setError(cause instanceof Error ? cause.message : String(cause))).finally(() => setBusy(false));
  };
  const groups = view?.catalog?.groups ?? [];
  const current2 = view?.worker ? keyOf(view.worker) : "";
  return /* @__PURE__ */ (0, import_jsx_runtime5.jsxs)("div", { className: "fusion-executor", "data-ud-check": "fusion-executor", children: [
    /* @__PURE__ */ (0, import_jsx_runtime5.jsx)("style", { children: styles3 }),
    /* @__PURE__ */ (0, import_jsx_runtime5.jsxs)("span", { className: "fusion-executor-mark", title: tr(lang, "Fusion Next \u6267\u884C\u6A21\u578B", "Fusion Next executor"), children: [
      /* @__PURE__ */ (0, import_jsx_runtime5.jsxs)("svg", { width: "13", height: "13", viewBox: "0 0 18 18", fill: "none", "aria-hidden": "true", children: [
        /* @__PURE__ */ (0, import_jsx_runtime5.jsx)("circle", { cx: "5.5", cy: "5.5", r: "3", stroke: "currentColor", strokeWidth: "1.4" }),
        /* @__PURE__ */ (0, import_jsx_runtime5.jsx)("circle", { cx: "12.5", cy: "12.5", r: "3", stroke: "currentColor", strokeWidth: "1.4" }),
        /* @__PURE__ */ (0, import_jsx_runtime5.jsx)("path", { d: "M7.8 7.8 10.2 10.2", stroke: "currentColor", strokeWidth: "1.4", strokeLinecap: "round" })
      ] }),
      /* @__PURE__ */ (0, import_jsx_runtime5.jsx)("span", { className: "fusion-executor-label", children: tr(lang, "\u6267\u884C", "Exec") })
    ] }),
    /* @__PURE__ */ (0, import_jsx_runtime5.jsxs)(
      "select",
      {
        "aria-label": tr(lang, "\u6267\u884C\u6A21\u578B\uFF1B\u9009\u4E00\u4E2A\u5373\u5F00\u542F Fusion Next", "Executor model; picking one enables Fusion Next"),
        value: current2,
        disabled: busy,
        "data-active": Boolean(view?.worker),
        onChange: (event) => choose(event.target.value),
        children: [
          /* @__PURE__ */ (0, import_jsx_runtime5.jsx)("option", { value: "", children: tr(lang, "\u5173\u95ED", "Off") }),
          groups.map((group) => /* @__PURE__ */ (0, import_jsx_runtime5.jsx)("optgroup", { label: group.name, children: group.models.map((model) => /* @__PURE__ */ (0, import_jsx_runtime5.jsx)("option", { value: `${group.id}/${model.id}`, children: model.name }, model.id)) }, group.id))
        ]
      }
    ),
    error && /* @__PURE__ */ (0, import_jsx_runtime5.jsx)("span", { role: "status", title: error, children: "\u26A0" })
  ] });
}

// src/client/FusionTool.tsx
var import_react9 = require("react");

// src/activity.ts
function activityCallId(activity) {
  const event = activity.source;
  const id = event.type === "tool/call" ? event.data.callId : event.data.message.source.callId;
  return `fusion:${activity.childSessionId}:${id}`;
}

// src/client/activity-model.ts
function activityRows(events) {
  const rows = /* @__PURE__ */ new Map();
  for (const event of events) {
    const id = activityCallId(event);
    if (event.source.type === "tool/call") rows.set(id, { id, call: event.source });
    else {
      const row = rows.get(id);
      if (row) rows.set(id, { ...row, result: event.source });
    }
  }
  return [...rows.values()];
}
function activityDiffs(row) {
  if (!row.result || row.result.data.message.isError) return [];
  const meta = row.result.data.meta;
  if (!Array.isArray(meta?.diffs)) return [];
  return meta.diffs.filter((hunk) => hunk && typeof hunk === "object" && typeof hunk.path === "string" && (typeof hunk.oldText === "string" || hunk.oldText === null) && typeof hunk.newText === "string");
}

// src/client/ActivityRows.tsx
var import_react8 = require("react");
var import_dsh_client_ui_primitives = require("@deepseek-ai/dsh-client-ui-primitives");
var import_jsx_runtime6 = require("react/jsx-runtime");
var labelsFor = (lang) => ({
  codeLabel: tr(lang, "\u4EE3\u7801", "Code"),
  wrapLabel: tr(lang, "\u81EA\u52A8\u6362\u884C", "Wrap"),
  unwrapLabel: tr(lang, "\u53D6\u6D88\u81EA\u52A8\u6362\u884C", "No wrap"),
  copy: tr(lang, "\u590D\u5236", "Copy"),
  copied: tr(lang, "\u5DF2\u590D\u5236", "Copied"),
  collapseAria: tr(lang, "\u6536\u8D77\u5185\u5BB9", "Collapse"),
  collapse: tr(lang, "\u6536\u8D77", "Collapse"),
  expandAria: (n) => tr(lang, `\u5C55\u5F00\u5176\u4F59 ${n} \u884C`, `Show ${n} more lines`),
  expand: (n) => tr(lang, `\u5C55\u5F00\u5176\u4F59 ${n} \u884C`, `Show ${n} more lines`)
});
var terminalLabelsFor = (lang) => ({
  ...labelsFor(lang),
  commandLine: (n) => tr(lang, `\u547D\u4EE4\u884C\u7B2C ${n} \u884C`, `command line ${n}`),
  signal: (s) => tr(lang, `\u4FE1\u53F7 ${s}`, `signal ${s}`),
  exitCode: (n) => tr(lang, `\u9000\u51FA\u7801 ${n}`, `exit code ${n}`),
  running: tr(lang, "\u6267\u884C\u4E2D", "Running"),
  failed: tr(lang, "\u6267\u884C\u5931\u8D25", "Failed"),
  done: tr(lang, "\u5DF2\u8FD4\u56DE", "Done"),
  noOutput: tr(lang, "\u65E0\u8F93\u51FA", "No output"),
  noExitCode: tr(lang, "\u672A\u8BB0\u5F55\u9000\u51FA\u7801", "No exit code")
});
var titleFor = (lang) => ({
  bash: tr(lang, "\u7EC8\u7AEF", "Terminal"),
  pwsh: tr(lang, "\u7EC8\u7AEF", "Terminal"),
  read: tr(lang, "\u8BFB\u53D6", "Read"),
  write: tr(lang, "\u5199\u5165", "Write"),
  edit: tr(lang, "\u7F16\u8F91", "Edit"),
  glob: tr(lang, "\u67E5\u627E\u6587\u4EF6", "Find files"),
  grep: tr(lang, "\u641C\u7D22", "Search"),
  job_output: tr(lang, "\u547D\u4EE4\u8F93\u51FA", "Command output"),
  job_kill: tr(lang, "\u505C\u6B62\u547D\u4EE4", "Stop command"),
  str_replace_editor: tr(lang, "\u7F16\u8F91", "Edit")
});
function ActivityCard({ row, done, cwd, openFile }) {
  const lang = useLang();
  const [open, setOpen] = (0, import_react8.useState)(false);
  let args = {};
  try {
    const parsed = JSON.parse(row.call.data.arguments);
    if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) args = parsed;
  } catch {
  }
  const result = row.result?.data.message;
  const output = result?.content.flatMap((part) => part.type === "text" ? [part.text] : []).join("\n") ?? "";
  const path = typeof args.file_path === "string" ? args.file_path : typeof args.path === "string" ? args.path : void 0;
  const command = typeof args.command === "string" ? args.command : void 0;
  const exit = /\n\[exit code: (\d+)\]\s*$/.exec(output);
  const failed = result?.isError || exit && Number(exit[1]) !== 0;
  const diffs = activityDiffs(row);
  const label = titleFor(lang)[row.call.data.name] ?? row.call.data.name;
  const summary = path ?? (typeof args.description === "string" ? args.description : command) ?? (typeof args.pattern === "string" ? args.pattern : label);
  const status = failed ? tr(lang, "\u5931\u8D25", "Failed") : !row.result ? done ? tr(lang, "\u7ED3\u679C\u672A\u8BB0\u5F55", "No result recorded") : tr(lang, "\u6267\u884C\u4E2D", "Running") : "";
  return /* @__PURE__ */ (0, import_jsx_runtime6.jsxs)("div", { className: "fusion-activity-row", "data-fusion-tool": row.call.data.name, "data-fusion-call": row.id, children: [
    /* @__PURE__ */ (0, import_jsx_runtime6.jsxs)("button", { type: "button", "aria-expanded": open, onClick: () => setOpen(!open), className: "fusion-activity-toggle", children: [
      /* @__PURE__ */ (0, import_jsx_runtime6.jsx)("span", { "aria-hidden": true, children: open ? "\u2304" : "\u203A" }),
      /* @__PURE__ */ (0, import_jsx_runtime6.jsx)("span", { children: label }),
      /* @__PURE__ */ (0, import_jsx_runtime6.jsx)("span", { className: "fusion-activity-summary", children: summary }),
      status && /* @__PURE__ */ (0, import_jsx_runtime6.jsx)("small", { role: "status", "data-failed": Boolean(failed), children: status })
    ] }),
    open && /* @__PURE__ */ (0, import_jsx_runtime6.jsxs)("div", { className: "fusion-activity-body", children: [
      path && /* @__PURE__ */ (0, import_jsx_runtime6.jsxs)("button", { type: "button", className: "fusion-activity-file", onClick: () => openFile(path), children: [
        tr(lang, "\u6253\u5F00", "Open"),
        " ",
        path
      ] }),
      diffs.length ? /* @__PURE__ */ (0, import_jsx_runtime6.jsx)(import_dsh_client_ui_primitives.DiffBlock, { diffs, labels: labelsFor(lang), maxLines: 16 }) : (row.call.data.name === "bash" || row.call.data.name === "pwsh") && command ? /* @__PURE__ */ (0, import_jsx_runtime6.jsx)(
        import_dsh_client_ui_primitives.TerminalBlock,
        {
          command,
          cwd,
          output,
          running: !row.result && !done,
          exitCode: exit ? Number(exit[1]) : void 0,
          labels: terminalLabelsFor(lang)
        }
      ) : /* @__PURE__ */ (0, import_jsx_runtime6.jsx)("pre", { children: output || (row.result ? tr(lang, "\u5DF2\u8FD4\u56DE\uFF0C\u65E0\u6587\u672C\u8F93\u51FA\u3002", "Returned without text output.") : row.call.data.arguments) })
    ] })
  ] });
}
var activityStyles = `
.fusion-activity-row{font-size:13px;line-height:1.5;margin:4px 0;min-width:0;color:var(--dsw-alias-label-secondary)}
.fusion-activity-toggle{display:flex;align-items:center;gap:8px;width:100%;padding:6px 0;background:none;border:0;color:inherit;text-align:left;cursor:pointer;font:inherit}
.fusion-activity-toggle:focus-visible,.fusion-activity-file:focus-visible{outline:2px solid var(--dsw-alias-brand-primary);outline-offset:2px}
.fusion-activity-summary{flex:1;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;color:var(--dsw-alias-label-primary)}
.fusion-activity-toggle small{white-space:nowrap}.fusion-activity-toggle small[data-failed=true]{color:var(--dsw-alias-state-error-primary)}
.fusion-activity-body{padding:4px 0 10px;overflow:hidden}.fusion-activity-body pre{white-space:pre-wrap;overflow-wrap:anywhere;max-height:360px;overflow:auto;font-size:12px}
.fusion-activity-file{font:inherit;border:0;background:none;color:var(--dsw-alias-brand-primary);padding:0 0 6px;cursor:pointer}
`;

// src/client/FusionTool.tsx
var import_jsx_runtime7 = require("react/jsx-runtime");
var fusionControlTools = [
  "fusion_next_read_state",
  "fusion_next_delegate_text",
  "fusion_next_explore",
  "fusion_next_delegate",
  "fusion_next_rework",
  "fusion_next_wait",
  "fusion_next_review_result",
  "fusion_next_submit_result",
  "fusion_next_takeover",
  "fusion_next_finish_direct",
  "fusion_next_read_evidence"
];
function FusionTool({ block, sessionId, callId, toolName, cwd, openFile }) {
  const lang = useLang();
  const settled = "kind" in block;
  const tracksActivity = toolName === "fusion_next_delegate_text" || toolName === "fusion_next_explore" || toolName === "fusion_next_delegate" || toolName === "fusion_next_rework";
  const [snapshot, setSnapshot] = (0, import_react9.useState)();
  const key2 = `${sessionId}:${callId}`;
  (0, import_react9.useEffect)(() => {
    if (!tracksActivity) return;
    let active = true, busy = false, cursor = -1, timer;
    const events = /* @__PURE__ */ new Map();
    let abort;
    const visible2 = () => document.visibilityState !== "hidden";
    const refresh = async () => {
      if (!active || busy || !visible2()) return;
      busy = true;
      abort = new AbortController();
      const deadline = setTimeout(() => abort?.abort(), 1e4);
      let again = true, delay = 2e3;
      try {
        const response = await fetch(
          `/api/fusion-next?view=activity&sessionId=${encodeURIComponent(sessionId)}&callId=${encodeURIComponent(callId)}&after=${cursor}`,
          { credentials: "same-origin", cache: "no-store", signal: abort.signal }
        );
        if (!response.ok) throw new Error("Activity unavailable");
        const page = await response.json();
        if (!Array.isArray(page.events) || !Number.isSafeInteger(page.cursor) || page.cursor < cursor) throw new Error("Invalid activity page");
        for (const event of page.events) if (event.parentCallId === callId) events.set(event.source.seq, event);
        cursor = page.cursor;
        again = page.more || !page.done || !settled;
        delay = page.more ? 0 : 2e3;
        if (active) setSnapshot({ key: key2, events: [...events.values()].sort((a, b) => a.source.seq - b.source.seq), done: page.done });
      } catch {
        if (active) setSnapshot((previous) => ({ key: key2, events: previous?.key === key2 ? previous.events : [], done: false, failed: true }));
      } finally {
        clearTimeout(deadline);
        busy = false;
        if (active && again && visible2()) timer = setTimeout(() => {
          void refresh();
        }, delay);
      }
    };
    const visibility = () => {
      if (timer) clearTimeout(timer);
      if (document.visibilityState === "hidden") abort?.abort();
      else void refresh();
    };
    void refresh();
    document.addEventListener("visibilitychange", visibility);
    return () => {
      active = false;
      abort?.abort();
      if (timer) clearTimeout(timer);
      document.removeEventListener("visibilitychange", visibility);
    };
  }, [sessionId, callId, key2, tracksActivity, settled]);
  const current2 = tracksActivity && snapshot?.key === key2 ? snapshot : void 0;
  const rows = (0, import_react9.useMemo)(() => activityRows(current2?.events ?? []), [current2?.events]);
  const text = settled ? block.content.flatMap((part) => part.type === "text" ? [part.text] : []).join("\n") : "";
  let problem = settled && block.isError ? text : "";
  if (!problem) {
    try {
      const result = JSON.parse(text);
      if (result.status === "needs-decision") problem = result.reason ?? tr(lang, "\u4EFB\u52A1\u9700\u8981\u8FDB\u4E00\u6B65\u5904\u7406\u3002", "The task needs attention.");
    } catch {
    }
  }
  return /* @__PURE__ */ (0, import_jsx_runtime7.jsxs)(import_jsx_runtime7.Fragment, { children: [
    rows.length > 0 && /* @__PURE__ */ (0, import_jsx_runtime7.jsx)("style", { children: activityStyles }),
    rows.map((row) => /* @__PURE__ */ (0, import_jsx_runtime7.jsx)(ActivityCard, { row, done: current2?.done ?? false, cwd, openFile }, row.id)),
    current2?.failed && /* @__PURE__ */ (0, import_jsx_runtime7.jsx)("p", { role: "status", children: tr(lang, "\u6267\u884C\u8BB0\u5F55\u6682\u65F6\u65E0\u6CD5\u52A0\u8F7D\uFF0C\u6B63\u5728\u91CD\u8BD5\u3002", "Activity is unavailable; retrying.") }),
    problem && /* @__PURE__ */ (0, import_jsx_runtime7.jsx)("p", { role: "status", style: { fontSize: 13, whiteSpace: "pre-wrap" }, children: problem })
  ] });
}

// src/client/FusionConsole.tsx
var import_react10 = require("react");
var import_jsx_runtime8 = require("react/jsx-runtime");
var routeLabel = (route) => route ? `${route.model}` : void 0;
var styles4 = `
.fusion-console{padding:20px 24px;max-width:860px;color:var(--dsw-alias-label-primary);font-size:13px;line-height:1.6}
.fusion-console h2{font-size:16px;margin:0 0 14px;font-weight:600;letter-spacing:-0.01em}
.fusion-console .fusion-pair{display:grid;grid-template-columns:repeat(auto-fit,minmax(140px,1fr));gap:0;padding:4px 0;border:1px solid var(--dsw-alias-border-l2);border-radius:12px;background:var(--dsw-alias-bg-layer-1)}
.fusion-console .fusion-pair>div{padding:10px 16px}
.fusion-console .fusion-pair>div+div{border-left:1px solid var(--dsw-alias-border-l2)}
.fusion-console .fusion-pair b{font-weight:600}
.fusion-console .fusion-pair small{display:block;color:var(--dsw-alias-label-secondary);font-size:12px;margin-top:2px}
.fusion-console .fusion-console-note{margin:14px 0;color:var(--dsw-alias-label-secondary)}
.fusion-console .fusion-tabs{display:flex;gap:2px;margin:18px 0 14px;border-bottom:1px solid var(--dsw-alias-border-l2)}
.fusion-console .fusion-tabs button{font:inherit;font-size:13px;color:var(--dsw-alias-label-secondary);background:none;border:0;border-bottom:2px solid transparent;padding:7px 12px;cursor:pointer;transition:color .12s}
.fusion-console .fusion-tabs button:hover{color:var(--dsw-alias-label-primary)}
.fusion-console .fusion-tabs button[aria-selected=true]{color:var(--dsw-alias-label-primary);border-bottom-color:var(--dsw-alias-brand-primary);font-weight:600}
.fusion-console .fusion-recovery fieldset{border:0;padding:0;display:flex;flex-direction:column;gap:10px}.fusion-console .fusion-recovery :is(button,select,input){font:inherit;color:var(--dsw-alias-label-primary);border:1px solid var(--dsw-alias-border-l2);border-radius:8px;padding:7px 10px;max-width:100%}.fusion-console .fusion-recovery :is(select,input,option,optgroup){background-color:var(--dsw-alias-bg-layer-1);color-scheme:inherit}.fusion-console .fusion-recovery button{cursor:pointer;background-color:var(--dsw-alias-button-elevated-fill)}.fusion-console .fusion-recovery [role=alert]{color:var(--dsw-alias-state-error-primary)}
.fusion-console p{margin:4px 0 12px}.fusion-console h3{font-size:13px;margin:18px 0 6px;font-weight:600}
.fusion-console dl{margin:0;display:grid;grid-template-columns:minmax(72px,auto) minmax(0,1fr);gap:6px 14px}
.fusion-console dt{color:var(--dsw-alias-label-secondary)}.fusion-console dd{margin:0;min-width:0}
.fusion-console ul{list-style:none;margin:0;padding:0}.fusion-console li{padding:8px 0;border-bottom:1px solid var(--dsw-alias-border-l2)}
.fusion-console small{display:block;color:var(--dsw-alias-label-secondary);font-size:12px;margin-top:2px}
.fusion-console .fusion-stage{display:inline-flex;align-items:center;gap:8px;font-size:13px;font-weight:600;margin:0 0 6px;padding:4px 12px;border-radius:999px;background:var(--dsw-alias-bg-layer-1);border:1px solid var(--dsw-alias-border-l2)}
.fusion-console .fusion-stage::before{content:'';width:7px;height:7px;border-radius:50%;background:var(--dsw-alias-brand-primary)}
.fusion-console .fusion-stage[data-attention=true]{color:var(--dsw-alias-state-error-primary);border-color:var(--dsw-alias-state-error-primary)}
.fusion-console .fusion-stage[data-attention=true]::before{background:var(--dsw-alias-state-error-primary)}
`;
function FusionConsole({ sessionId }) {
  const lang = useLang();
  const [pair, setPair] = (0, import_react10.useState)();
  const [pairFailed, setPairFailed] = (0, import_react10.useState)(false);
  const [tab, setTab] = (0, import_react10.useState)("task");
  const snapshot = useFusionStatus(sessionId ?? "", void 0);
  (0, import_react10.useEffect)(() => {
    if (!sessionId) {
      setPair(void 0);
      return;
    }
    const abort = new AbortController();
    const load = () => {
      void fetch(
        `/api/fusion-next?view=session-pair&sessionId=${encodeURIComponent(sessionId)}`,
        { credentials: "same-origin", cache: "no-store", signal: abort.signal }
      ).then(async (response) => {
        if (!response.ok) throw new Error("unavailable");
        const view = await response.json();
        setPair(view);
        setPairFailed(false);
      }).catch(() => {
        if (!abort.signal.aborted) setPairFailed(true);
      });
    };
    load();
    const timer = setInterval(load, 15e3);
    return () => {
      abort.abort();
      clearInterval(timer);
    };
  }, [sessionId]);
  if (!sessionId) return null;
  const task = snapshot?.status?.selected ? snapshot.status.task : void 0;
  const stage = task ? lang === "en" ? task.stageEn ?? task.stage : task.stage : void 0;
  return /* @__PURE__ */ (0, import_jsx_runtime8.jsxs)("section", { className: "fusion-console", "aria-label": tr(lang, "Fusion Next \u4F1A\u8BDD\u9762\u677F", "Fusion Next session console"), "data-ud-check": "fusion-console", children: [
    /* @__PURE__ */ (0, import_jsx_runtime8.jsx)("style", { children: styles4 }),
    /* @__PURE__ */ (0, import_jsx_runtime8.jsx)("h2", { children: "Fusion Next" }),
    pair?.worker ? /* @__PURE__ */ (0, import_jsx_runtime8.jsxs)("div", { className: "fusion-pair", children: [
      /* @__PURE__ */ (0, import_jsx_runtime8.jsxs)("div", { children: [
        /* @__PURE__ */ (0, import_jsx_runtime8.jsx)("b", { children: tr(lang, "\u89C4\u5212", "Planner") }),
        /* @__PURE__ */ (0, import_jsx_runtime8.jsx)("small", { children: routeLabel(pair.lead) ?? tr(lang, "\u8DDF\u968F\u4F1A\u8BDD\u6A21\u578B", "follows the session model") })
      ] }),
      /* @__PURE__ */ (0, import_jsx_runtime8.jsxs)("div", { children: [
        /* @__PURE__ */ (0, import_jsx_runtime8.jsx)("b", { children: tr(lang, "\u6267\u884C", "Executor") }),
        /* @__PURE__ */ (0, import_jsx_runtime8.jsx)("small", { children: routeLabel(pair.worker) })
      ] }),
      /* @__PURE__ */ (0, import_jsx_runtime8.jsxs)("div", { children: [
        /* @__PURE__ */ (0, import_jsx_runtime8.jsx)("b", { children: tr(lang, "\u72B6\u6001", "State") }),
        /* @__PURE__ */ (0, import_jsx_runtime8.jsx)("small", { children: pair.selected ? stage ?? tr(lang, "\u8FDB\u884C\u4E2D", "active") : tr(lang, "\u5DF2\u914D\u7F6E\uFF0C\u53D1\u9001\u6D88\u606F\u540E\u5F00\u59CB", "paired; starts on the next message") })
      ] })
    ] }) : /* @__PURE__ */ (0, import_jsx_runtime8.jsx)("p", { className: "fusion-console-note", children: pairFailed ? tr(lang, "\u6682\u65F6\u65E0\u6CD5\u8BFB\u53D6 Fusion \u72B6\u6001\uFF0C\u7A0D\u540E\u81EA\u52A8\u91CD\u8BD5\u3002", "Fusion status is unavailable right now; it retries automatically.") : tr(
      lang,
      "\u672C\u4F1A\u8BDD\u672A\u542F\u7528 Fusion Next\uFF1A\u5728\u8F93\u5165\u6846\u65C1\u7684\u300C\u6267\u884C\u300D\u9009\u62E9\u5668\u6311\u4E00\u4E2A\u6267\u884C\u6A21\u578B\u5373\u53EF\u5F00\u542F\u53CC\u6A21\u578B\u534F\u4F5C\u3002",
      "Fusion Next is off in this session: pick an executor beside the model selector to start two-model collaboration."
    ) }),
    task && /* @__PURE__ */ (0, import_jsx_runtime8.jsxs)(import_jsx_runtime8.Fragment, { children: [
      /* @__PURE__ */ (0, import_jsx_runtime8.jsxs)("div", { className: "fusion-tabs", role: "tablist", children: [
        /* @__PURE__ */ (0, import_jsx_runtime8.jsx)("button", { role: "tab", "aria-selected": tab === "task", onClick: () => setTab("task"), children: tr(lang, "\u5F53\u524D\u4EFB\u52A1", "Current task") }),
        /* @__PURE__ */ (0, import_jsx_runtime8.jsx)("button", { role: "tab", "aria-selected": tab === "activity", onClick: () => setTab("activity"), children: tr(lang, "\u8BF7\u6C42\u4E0E\u7528\u91CF", "Requests & usage") })
      ] }),
      tab === "task" && /* @__PURE__ */ (0, import_jsx_runtime8.jsxs)(import_jsx_runtime8.Fragment, { children: [
        /* @__PURE__ */ (0, import_jsx_runtime8.jsx)("p", { className: "fusion-stage", "data-attention": task.attention, children: stage }),
        /* @__PURE__ */ (0, import_jsx_runtime8.jsx)(FusionTaskOverview, { sessionId, task })
      ] }),
      tab === "activity" && /* @__PURE__ */ (0, import_jsx_runtime8.jsx)(FusionTaskActivity, { task })
    ] }),
    pair?.worker && !task && /* @__PURE__ */ (0, import_jsx_runtime8.jsx)("p", { className: "fusion-console-note", role: "status", children: tr(lang, "\u5C1A\u65E0\u8FDB\u884C\u4E2D\u7684\u4EFB\u52A1\u3002\u53D1\u9001\u6D88\u606F\u540E\u8FD9\u91CC\u4F1A\u663E\u793A\u4EFB\u52A1\u9636\u6BB5\u4E0E\u7528\u91CF\u3002", "No task yet. Task stage and usage appear here after you send a message.") })
  ] });
}

// src/client/FusionPanel.tsx
var import_react13 = require("react");

// src/client/FusionHistory.tsx
var import_react11 = require("react");
var import_jsx_runtime9 = require("react/jsx-runtime");
var takeoverReason = (lang, reason) => ({
  "checks-still-failing": tr(lang, "\u8FD4\u5DE5\u540E\u68C0\u67E5\u4ECD\u5931\u8D25", "checks still failing after rework"),
  "worker-step-limit": tr(lang, "Sidekick \u6B65\u6570\u7528\u5C3D", "Sidekick step limit"),
  "worker-stalled": tr(lang, "Sidekick \u53CD\u590D\u505C\u6EDE", "Sidekick stalled repeatedly")
})[reason] ?? reason;
var tokens = (lang, field, calls) => !calls ? "\u2014" : !field.reported ? tr(lang, "\u672A\u63D0\u4F9B", "not reported") : `${field.known.toLocaleString()}${field.reported < calls ? tr(lang, `\uFF08${field.reported}/${calls} \u6B21\u6709\u62A5\u544A\uFF09`, ` (${field.reported}/${calls} reported)`) : ""}`;
var purpose = (lang, value) => ({
  conversation: tr(lang, "\u4EFB\u52A1", "task"),
  compaction: tr(lang, "\u538B\u7F29", "compaction"),
  "cache-keepalive": tr(lang, "\u4FDD\u6D3B", "keepalive"),
  "session-title": tr(lang, "\u6807\u9898", "title")
})[value] ?? value;
function FusionHistory() {
  const lang = useLang();
  const [page, setPage] = (0, import_react11.useState)();
  const [cursor, setCursor] = (0, import_react11.useState)("");
  const [error, setError] = (0, import_react11.useState)("");
  const [refresh, setRefresh] = (0, import_react11.useState)(0);
  const [loading, setLoading] = (0, import_react11.useState)(false);
  (0, import_react11.useEffect)(() => {
    const abort = new AbortController();
    setLoading(true);
    setError("");
    void fetch(`/api/fusion-next?view=history&cursor=${encodeURIComponent(cursor)}`, { credentials: "same-origin", cache: "no-store", signal: abort.signal }).then(async (response) => {
      if (!response.ok) throw new Error(tr(lang, "\u5386\u53F2\u8BB0\u5F55\u6682\u65F6\u65E0\u6CD5\u8BFB\u53D6", "History is unavailable right now"));
      return response.json();
    }).then(setPage).catch((error2) => {
      if (!abort.signal.aborted) setError(String(error2));
    }).finally(() => {
      if (!abort.signal.aborted) setLoading(false);
    });
    return () => abort.abort();
  }, [cursor, refresh, lang]);
  return /* @__PURE__ */ (0, import_jsx_runtime9.jsxs)("section", { className: "fusion-history", "aria-label": tr(lang, "Fusion Next \u5386\u53F2\u4E0E\u7EDF\u8BA1", "Fusion Next history and statistics"), "data-ud-check": "fusion-history", children: [
    /* @__PURE__ */ (0, import_jsx_runtime9.jsx)("h2", { children: tr(lang, "\u5386\u53F2\u4E0E\u7EDF\u8BA1", "History and statistics") }),
    /* @__PURE__ */ (0, import_jsx_runtime9.jsx)("p", { children: tr(
      lang,
      "\u6309\u5B9E\u9645\u6A21\u578B\u8BF7\u6C42\u6C47\u603B\uFF0C\u5305\u542B\u4EFB\u52A1\u3001\u538B\u7F29\u3001\u4FDD\u6D3B\u53CA\u5DF2\u6709\u6807\u9898\u8BF7\u6C42\u3002\u672A\u62A5\u544A\u7684\u7528\u91CF\u4E0D\u7B97\u4F5C 0\uFF1B\u91D1\u989D\u4E0E\u8282\u7701\u7387\u5C1A\u65E0\u53EF\u9760\u6570\u636E\u3002",
      "Totals of actual model requests: tasks, compaction, keepalive and title requests. Unreported usage is not counted as 0; no reliable billed amount or saving rate is available."
    ) }),
    /* @__PURE__ */ (0, import_jsx_runtime9.jsx)("button", { disabled: loading, onClick: () => setRefresh((value) => value + 1), children: tr(lang, "\u5237\u65B0\u8BB0\u5F55", "Refresh") }),
    error && /* @__PURE__ */ (0, import_jsx_runtime9.jsx)("p", { role: "alert", children: error }),
    loading && /* @__PURE__ */ (0, import_jsx_runtime9.jsx)("p", { role: "status", children: tr(lang, "\u6B63\u5728\u8BFB\u53D6\u8BB0\u5F55\u2026", "Loading\u2026") }),
    page && /* @__PURE__ */ (0, import_jsx_runtime9.jsxs)(import_jsx_runtime9.Fragment, { children: [
      /* @__PURE__ */ (0, import_jsx_runtime9.jsx)("p", { children: tr(
        lang,
        `${page.totalTasks} \u9879\u4EFB\u52A1 \xB7 ${page.totals.calls} \u6B21\u539F\u751F\u8BF7\u6C42 \xB7 ${page.totals.final} \u6B21\u7528\u91CF\u5B9A\u7A3F \xB7 ${page.totals.provisional} \u6B21\u6682\u62A5 \xB7 ${page.totals.unreported} \u6B21\u672A\u63D0\u4F9B`,
        `${page.totalTasks} tasks \xB7 ${page.totals.calls} native requests \xB7 ${page.totals.final} final usage \xB7 ${page.totals.provisional} provisional \xB7 ${page.totals.unreported} unreported`
      ) }),
      /* @__PURE__ */ (0, import_jsx_runtime9.jsxs)("p", { children: [
        tr(lang, "\u672A\u7F13\u5B58\u8F93\u5165", "Uncached input"),
        " ",
        tokens(lang, page.totals.input, page.totals.calls),
        " \xB7 ",
        tr(lang, "\u7F13\u5B58\u8BFB\u53D6", "cache read"),
        " ",
        tokens(lang, page.totals.cacheRead, page.totals.calls),
        " \xB7 ",
        tr(lang, "\u8F93\u51FA", "output"),
        " ",
        tokens(lang, page.totals.output, page.totals.calls),
        " Token"
      ] }),
      /* @__PURE__ */ (0, import_jsx_runtime9.jsxs)("p", { children: [
        tr(lang, `Lead \u63A5\u624B\u6539\u4EE3\u7801 ${page.takeovers?.total ?? 0} \u6B21\uFF08${page.takeovers?.tasks ?? 0} \u9879\u4EFB\u52A1\uFF09`, `Lead takeovers: ${page.takeovers?.total ?? 0} (${page.takeovers?.tasks ?? 0} tasks)`),
        page.takeovers?.total ? `: ${Object.entries(page.takeovers.reasons).map(([reason, count]) => `${takeoverReason(lang, reason)} ${count}`).join(", ")}` : "",
        tr(lang, "\u3002\u53EA\u6709 Sidekick \u786E\u5B9E\u5B8C\u6210\u4E0D\u4E86\u65F6\uFF0C\u7A0B\u5E8F\u624D\u4F1A\u89E3\u9501\u63A5\u624B\u3002", ". The Host unlocks a takeover only when the Sidekick demonstrably cannot finish.")
      ] }),
      /* @__PURE__ */ (0, import_jsx_runtime9.jsx)("div", { style: { overflowX: "auto" }, tabIndex: 0, "aria-label": tr(lang, "\u6309\u5B9E\u9645\u6A21\u578B\u7EDF\u8BA1", "By actual model"), children: /* @__PURE__ */ (0, import_jsx_runtime9.jsxs)("table", { children: [
        /* @__PURE__ */ (0, import_jsx_runtime9.jsx)("caption", { children: tr(lang, "\u6309\u89D2\u8272\u3001\u5B9E\u9645\u6A21\u578B\u548C\u8BF7\u6C42\u7528\u9014", "By role, actual model and purpose") }),
        /* @__PURE__ */ (0, import_jsx_runtime9.jsx)("thead", { children: /* @__PURE__ */ (0, import_jsx_runtime9.jsxs)("tr", { children: [
          /* @__PURE__ */ (0, import_jsx_runtime9.jsx)("th", { scope: "col", children: tr(lang, "\u89D2\u8272 / \u6A21\u578B", "Role / model") }),
          /* @__PURE__ */ (0, import_jsx_runtime9.jsx)("th", { scope: "col", children: tr(lang, "\u7528\u9014", "Purpose") }),
          /* @__PURE__ */ (0, import_jsx_runtime9.jsx)("th", { scope: "col", children: tr(lang, "\u8BF7\u6C42", "Requests") }),
          /* @__PURE__ */ (0, import_jsx_runtime9.jsx)("th", { scope: "col", children: tr(lang, "\u8F93\u51FA Token", "Output tokens") })
        ] }) }),
        /* @__PURE__ */ (0, import_jsx_runtime9.jsx)("tbody", { children: page.groups.map((group) => /* @__PURE__ */ (0, import_jsx_runtime9.jsxs)("tr", { children: [
          /* @__PURE__ */ (0, import_jsx_runtime9.jsxs)("th", { scope: "row", children: [
            group.role === "lead" ? "Lead" : "Sidekick",
            " \xB7 ",
            group.model,
            /* @__PURE__ */ (0, import_jsx_runtime9.jsx)("small", { children: group.provider })
          ] }),
          /* @__PURE__ */ (0, import_jsx_runtime9.jsx)("td", { children: purpose(lang, group.purpose) }),
          /* @__PURE__ */ (0, import_jsx_runtime9.jsx)("td", { children: group.calls }),
          /* @__PURE__ */ (0, import_jsx_runtime9.jsx)("td", { children: tokens(lang, group.output, group.calls) })
        ] }, JSON.stringify([group.role, group.provider, group.model, group.purpose]))) })
      ] }) }),
      /* @__PURE__ */ (0, import_jsx_runtime9.jsx)("h3", { children: tr(lang, "\u4EFB\u52A1\u8BB0\u5F55", "Tasks") }),
      !page.tasks.length && /* @__PURE__ */ (0, import_jsx_runtime9.jsx)("p", { children: tr(lang, "\u8FD8\u6CA1\u6709 Fusion \u4EFB\u52A1\u3002", "No Fusion tasks yet.") }),
      /* @__PURE__ */ (0, import_jsx_runtime9.jsx)("ol", { children: page.tasks.map((task) => /* @__PURE__ */ (0, import_jsx_runtime9.jsxs)("li", { children: [
        /* @__PURE__ */ (0, import_jsx_runtime9.jsx)("strong", { children: task.title }),
        /* @__PURE__ */ (0, import_jsx_runtime9.jsxs)("small", { children: [
          new Date(task.createdAt).toLocaleString(),
          " \xB7 ",
          task.mode === "completed" ? tr(lang, "\u5DF2\u7ED3\u675F", "finished") : task.phase,
          " \xB7 ",
          tr(lang, `${task.usage.calls} \u6B21\u8BF7\u6C42`, `${task.usage.calls} requests`),
          task.takeovers ? tr(lang, ` \xB7 Lead \u63A5\u624B ${task.takeovers} \u6B21`, ` \xB7 ${task.takeovers} Lead takeovers`) : ""
        ] }),
        /* @__PURE__ */ (0, import_jsx_runtime9.jsxs)("details", { children: [
          /* @__PURE__ */ (0, import_jsx_runtime9.jsx)("summary", { children: tr(lang, "\u8BB0\u5F55\u8BE6\u60C5", "Details") }),
          /* @__PURE__ */ (0, import_jsx_runtime9.jsxs)("p", { children: [
            tr(lang, "\u4EFB\u52A1", "Task"),
            ": ",
            task.id
          ] }),
          /* @__PURE__ */ (0, import_jsx_runtime9.jsxs)("p", { children: [
            tr(lang, "\u4F1A\u8BDD", "Session"),
            ": ",
            task.sessionId
          ] }),
          /* @__PURE__ */ (0, import_jsx_runtime9.jsx)("p", { children: tr(lang, `\u9A8C\u8BC1\u72B6\u6001\uFF1A${task.verification}\u3002\u5386\u53F2\u8FD0\u884C\u72B6\u6001\u4E0D\u4EE3\u8868\u5F53\u524D\u4ECD\u5728\u6267\u884C\u3002`, `Verification: ${task.verification}. A recorded state does not mean it is still running.`) }),
          /* @__PURE__ */ (0, import_jsx_runtime9.jsxs)("p", { children: [
            tr(lang, "\u8F93\u5165", "Input"),
            " ",
            tokens(lang, task.usage.input, task.usage.calls),
            " \xB7 ",
            tr(lang, "\u7F13\u5B58\u8BFB\u53D6", "cache read"),
            " ",
            tokens(lang, task.usage.cacheRead, task.usage.calls),
            " \xB7 ",
            tr(lang, "\u8F93\u51FA", "output"),
            " ",
            tokens(lang, task.usage.output, task.usage.calls),
            " Token"
          ] })
        ] })
      ] }, task.id)) }),
      /* @__PURE__ */ (0, import_jsx_runtime9.jsxs)("div", { className: "fusion-actions", children: [
        /* @__PURE__ */ (0, import_jsx_runtime9.jsx)("button", { disabled: loading || !cursor, onClick: () => setCursor(""), children: tr(lang, "\u6700\u65B0\u8BB0\u5F55", "Newest") }),
        /* @__PURE__ */ (0, import_jsx_runtime9.jsx)("button", { disabled: loading || !page.nextCursor, onClick: () => setCursor(page.nextCursor), children: tr(lang, "\u66F4\u65E9\u8BB0\u5F55", "Older") })
      ] }),
      /* @__PURE__ */ (0, import_jsx_runtime9.jsx)("p", { children: tr(lang, `\u66F4\u65B0\u4E8E ${new Date(page.observedAt).toLocaleString()}\u3002\u4F9B\u5E94\u5546\u5185\u90E8\u91CD\u8BD5\u6B21\u6570\u672A\u77E5\u3002`, `Updated ${new Date(page.observedAt).toLocaleString()}. Provider-internal retries are unknown.`) })
    ] })
  ] });
}

// src/client/FusionCache.tsx
var import_react12 = require("react");
var import_jsx_runtime10 = require("react/jsx-runtime");
var tokens2 = (value) => value >= 1e6 ? `${(value / 1e6).toFixed(1)}M` : value >= 1e3 ? `${Math.round(value / 1e3)}k` : String(value);
var minutes = (seconds) => seconds % 60 ? `${(seconds / 60).toFixed(1)} min` : `${seconds / 60} min`;
var modeName = (lang, mode) => ({ auto: tr(lang, "\u81EA\u52A8", "Auto"), on: tr(lang, "\u5F00\u542F", "On"), off: tr(lang, "\u5173\u95ED", "Off") })[mode];
function modeSource(lang, row) {
  switch (row.modeSource) {
    case "user":
      return tr(lang, "\u4F60\u7684\u8BBE\u7F6E", "your setting");
    case "pair":
      return tr(lang, "\u65E7\u7248\u7EC4\u5408\u8BBE\u7F6E", "older pair setting");
    case "role":
      return tr(lang, "Sidekick \u9ED8\u8BA4\u5173\u95ED\uFF08\u5B83\u5F88\u5C11\u957F\u65F6\u95F4\u7B49\u5F85\uFF09", "Sidekick default off (it rarely waits long)");
    case "route":
      return `${row.defaults.route.label}: ${lang === "zh" ? row.defaults.route.reason.zh : row.defaults.route.reason.en}`;
    case "family":
      return tr(lang, `${row.defaults.family.label} \u5B98\u65B9\u9ED8\u8BA4`, `${row.defaults.family.label} documented default`);
    default:
      return tr(lang, "\u901A\u7528\u9ED8\u8BA4", "generic default");
  }
}
function intervalSource(lang, row) {
  if (row.intervalSource === "user") return tr(lang, "\u4F60\u7684\u8BBE\u7F6E", "your setting");
  if (row.intervalSource === "learned") return tr(lang, "\u81EA\u52A8\u5B66\u4E60\uFF1A\u4FDD\u6D3B\u591A\u6B21\u672A\u547D\u4E2D\uFF0C\u5DF2\u7F29\u77ED", "learned: pings kept missing, shortened");
  return tr(lang, "\u9ED8\u8BA4", "default");
}
function ModelCard({ row, onSaved }) {
  const lang = useLang();
  const [interval, setInterval2] = (0, import_react12.useState)(String(row.setting.intervalSeconds ? row.setting.intervalSeconds / 60 : ""));
  const [busy, setBusy] = (0, import_react12.useState)(false), [error, setError] = (0, import_react12.useState)();
  const save = async (body) => {
    setBusy(true);
    setError(void 0);
    try {
      const response = await fetch("/api/fusion-next", {
        method: "POST",
        credentials: "same-origin",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ action: "cache-setting", provider: row.provider, model: row.model, ...body })
      });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error ?? tr(lang, "\u4FDD\u5B58\u5931\u8D25", "Save failed"));
      onSaved();
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : String(reason));
    } finally {
      setBusy(false);
    }
  };
  const t = row.totals;
  const family = row.defaults.family;
  return /* @__PURE__ */ (0, import_jsx_runtime10.jsxs)("div", { className: "fusion-cache-model", children: [
    /* @__PURE__ */ (0, import_jsx_runtime10.jsxs)("strong", { children: [
      row.model,
      /* @__PURE__ */ (0, import_jsx_runtime10.jsxs)("small", { children: [
        row.provider,
        row.role ? ` \xB7 ${row.role === "lead" ? "Lead" : "Sidekick"}` : ""
      ] })
    ] }),
    /* @__PURE__ */ (0, import_jsx_runtime10.jsxs)("p", { children: [
      tr(lang, "\u73B0\u5728", "Now"),
      ": ",
      /* @__PURE__ */ (0, import_jsx_runtime10.jsx)("b", { children: modeName(lang, row.mode) }),
      row.mode !== "off" && /* @__PURE__ */ (0, import_jsx_runtime10.jsxs)(import_jsx_runtime10.Fragment, { children: [
        tr(lang, "\uFF0C\u6BCF ", ", every "),
        /* @__PURE__ */ (0, import_jsx_runtime10.jsx)("b", { children: minutes(row.intervalSeconds) }),
        tr(lang, " \u7EED\u4E00\u6B21", "")
      ] }),
      /* @__PURE__ */ (0, import_jsx_runtime10.jsxs)("small", { children: [
        tr(lang, "\u5F00\u5173\u6765\u6E90", "Mode"),
        ": ",
        modeSource(lang, row),
        " \xB7 ",
        tr(lang, "\u95F4\u9694\u6765\u6E90", "Interval"),
        ": ",
        intervalSource(lang, row)
      ] })
    ] }),
    family && /* @__PURE__ */ (0, import_jsx_runtime10.jsx)("p", { children: /* @__PURE__ */ (0, import_jsx_runtime10.jsxs)("small", { children: [
      tr(lang, "\u5B98\u65B9\u6587\u6863", "Documented"),
      ": ",
      lang === "zh" ? family.lifetime.zh : family.lifetime.en,
      "\uFF1B",
      tr(lang, "\u7F13\u5B58\u4EF7\u7EA6\u4E3A\u5168\u4EF7", "cached price \u2248"),
      " ",
      family.discount,
      " \xB7 ",
      /* @__PURE__ */ (0, import_jsx_runtime10.jsx)("a", { href: family.docs, target: "_blank", rel: "noreferrer", children: tr(lang, "\u6765\u6E90", "source") })
    ] }) }),
    /* @__PURE__ */ (0, import_jsx_runtime10.jsxs)("div", { className: "fusion-cache-controls", children: [
      /* @__PURE__ */ (0, import_jsx_runtime10.jsxs)("label", { children: [
        tr(lang, "\u4FDD\u6D3B", "Keepalive"),
        /* @__PURE__ */ (0, import_jsx_runtime10.jsxs)(
          "select",
          {
            "aria-label": `${row.model} keepalive`,
            disabled: busy,
            value: row.setting.mode ?? "",
            onChange: (event) => {
              void save({ mode: event.target.value || null, intervalSeconds: row.setting.intervalSeconds ?? null });
            },
            children: [
              /* @__PURE__ */ (0, import_jsx_runtime10.jsx)("option", { value: "", children: tr(lang, `\u9ED8\u8BA4\uFF08${modeName(lang, row.defaults.mode)}\uFF09`, `Default (${modeName(lang, row.defaults.mode)})`) }),
              /* @__PURE__ */ (0, import_jsx_runtime10.jsx)("option", { value: "auto", children: tr(lang, "\u81EA\u52A8\uFF1A\u8BE5\u6A21\u578B\u8FD4\u56DE\u8FC7\u7F13\u5B58\u547D\u4E2D\u540E\u624D\u5F00\u542F", "Auto: only after this model reports cache hits") }),
              /* @__PURE__ */ (0, import_jsx_runtime10.jsx)("option", { value: "on", children: tr(lang, "\u5F00\u542F", "On") }),
              /* @__PURE__ */ (0, import_jsx_runtime10.jsx)("option", { value: "off", children: tr(lang, "\u5173\u95ED\uFF08\u6309\u8BF7\u6C42\u6B21\u6570\u8BA1\u8D39\u7684\u5957\u9910\u9009\u8FD9\u4E2A\uFF09", "Off (choose for plans billed per request)") })
            ]
          }
        )
      ] }),
      /* @__PURE__ */ (0, import_jsx_runtime10.jsxs)("label", { children: [
        tr(lang, "\u95F4\u9694\uFF08\u5206\u949F\uFF09", "Interval (min)"),
        /* @__PURE__ */ (0, import_jsx_runtime10.jsx)(
          "input",
          {
            type: "number",
            min: "1",
            max: "59",
            step: "0.5",
            disabled: busy,
            value: interval,
            placeholder: String(+(row.intervalSeconds / 60).toFixed(2)),
            onChange: (event) => setInterval2(event.target.value),
            onBlur: () => {
              if (interval !== String(row.setting.intervalSeconds ? row.setting.intervalSeconds / 60 : ""))
                void save({ mode: row.setting.mode ?? null, intervalSeconds: interval ? Math.round(Number(interval) * 60) : null });
            }
          }
        )
      ] }),
      /* @__PURE__ */ (0, import_jsx_runtime10.jsx)("button", { type: "button", disabled: busy || !row.setting.mode && !row.setting.intervalSeconds, onClick: () => {
        setInterval2("");
        void save({ reset: true });
      }, children: tr(lang, "\u6062\u590D\u9ED8\u8BA4", "Reset") })
    ] }),
    row.suggestion && /* @__PURE__ */ (0, import_jsx_runtime10.jsx)("p", { role: "status", children: tr(
      lang,
      `\u89C2\u5BDF\u5230\u7B49\u5F85 ${minutes(row.suggestion)} \u4EE5\u4E0A\u7F13\u5B58\u4ECD\u7136\u547D\u4E2D\uFF0C\u53EF\u4EE5\u628A\u95F4\u9694\u653E\u5BBD\u5230 ${minutes(row.suggestion)}\uFF08\u4E0D\u4F1A\u81EA\u52A8\u4FEE\u6539\uFF09\u3002`,
      `Cache still hit after waits over ${minutes(row.suggestion)}; you can lengthen the interval to ${minutes(row.suggestion)} (not changed automatically).`
    ) }),
    t ? /* @__PURE__ */ (0, import_jsx_runtime10.jsxs)("p", { children: [
      tr(lang, "\u6548\u679C", "Effect"),
      ": ",
      tr(lang, `\u7B49\u5F85\u540E\u547D\u4E2D ${t.waitHits}/${t.waits} \u6B21`, `hit after ${t.waitHits}/${t.waits} waits`),
      t.waits ? ` (${Math.round(100 * t.waitHits / t.waits)}%)` : "",
      "\uFF1B",
      tr(lang, ` \u4FDD\u6D3B ${t.pings} \u6B21\uFF08${t.pingHits} \u6B21\u547D\u4E2D\uFF0C\u8BFB\u53D6 ${tokens2(t.pingTokens)} token\uFF0C\u591A\u4E3A\u7F13\u5B58\u4EF7${t.pingOutputTokens != null ? `\uFF0C\u8F93\u51FA ${tokens2(t.pingOutputTokens)} token` : ""}\uFF09\uFF1B`, ` ${t.pings} pings (${t.pingHits} hit, ${tokens2(t.pingTokens)} tokens read, mostly at cache price${t.pingOutputTokens != null ? `, ${tokens2(t.pingOutputTokens)} output` : ""}); `),
      tr(lang, ` \u7B49\u5F85\u540E\u4ECD\u4ECE\u7F13\u5B58\u8BFB\u53D6 ${tokens2(t.keptWarmTokens)} token\uFF0C\u6309\u5168\u4EF7\u91CD\u53D1 ${tokens2(t.resentTokens)} token\u3002`, ` after waits ${tokens2(t.keptWarmTokens)} tokens served from cache, ${tokens2(t.resentTokens)} resent at full price.`),
      t.pings >= 5 && t.pingHits / t.pings < 0.5 && /* @__PURE__ */ (0, import_jsx_runtime10.jsx)("b", { children: tr(lang, " \u4FDD\u6D3B\u5927\u591A\u6CA1\u547D\u4E2D\uFF0C\u5EFA\u8BAE\u5173\u95ED\u6216\u7F29\u77ED\u95F4\u9694\u3002", " Most pings missed: turn it off or shorten the interval.") })
    ] }) : /* @__PURE__ */ (0, import_jsx_runtime10.jsx)("p", { children: tr(lang, "\u8FD8\u6CA1\u6709\u6570\u636E\uFF1ALead \u7B49\u5F85 Sidekick \u4E4B\u540E\u624D\u4F1A\u4EA7\u751F\u8BB0\u5F55\u3002", "No data yet: records appear after the Lead waits for the Sidekick.") }),
    !!row.recent.length && /* @__PURE__ */ (0, import_jsx_runtime10.jsx)("p", { children: /* @__PURE__ */ (0, import_jsx_runtime10.jsxs)("small", { children: [
      tr(lang, "\u6700\u8FD1", "Recent"),
      ": ",
      row.recent.map((item, i) => /* @__PURE__ */ (0, import_jsx_runtime10.jsxs)("span", { children: [
        item.ping ? "\u21BB" : "",
        minutes(item.gapSeconds),
        item.hit ? " \u2713" : " \u2717",
        i < row.recent.length - 1 ? " \xB7 " : ""
      ] }, i))
    ] }) }),
    error && /* @__PURE__ */ (0, import_jsx_runtime10.jsx)("p", { role: "alert", children: error })
  ] });
}
function FusionCache({ refresh }) {
  const lang = useLang();
  const [rows, setRows] = (0, import_react12.useState)(), [checked, setChecked] = (0, import_react12.useState)(), [error, setError] = (0, import_react12.useState)();
  const [reload, setReload] = (0, import_react12.useState)(0);
  (0, import_react12.useEffect)(() => {
    const abort = new AbortController();
    void fetch("/api/fusion-next?view=cache", { credentials: "same-origin", cache: "no-store", signal: abort.signal }).then(async (response) => {
      if (!response.ok) throw new Error(tr(lang, "\u65E0\u6CD5\u8BFB\u53D6\u7F13\u5B58\u8BBE\u7F6E", "Cannot read cache settings"));
      return response.json();
    }).then((value) => {
      setRows(value.models);
      setChecked(value.checked);
    }).catch((reason) => {
      if (!abort.signal.aborted) setError(String(reason));
    });
    return () => abort.abort();
  }, [refresh, reload, lang]);
  return /* @__PURE__ */ (0, import_jsx_runtime10.jsxs)("section", { className: "fusion-cache", "aria-label": tr(lang, "\u7F13\u5B58\u4FDD\u6D3B", "Cache keepalive"), children: [
    /* @__PURE__ */ (0, import_jsx_runtime10.jsx)("h3", { children: tr(lang, "\u7F13\u5B58\u4FDD\u6D3B", "Cache keepalive") }),
    /* @__PURE__ */ (0, import_jsx_runtime10.jsx)("p", { children: tr(
      lang,
      "Lead \u7B49 Sidekick \u5E72\u6D3B\u65F6\u53EF\u80FD\u8981\u7B49\u51E0\u5206\u949F\uFF0C\u6A21\u578B\u7684\u8F93\u5165\u7F13\u5B58\u8FC7\u671F\u540E\uFF0C\u4E0B\u4E00\u6B21\u8BF7\u6C42\u4F1A\u6309\u5168\u4EF7\u91CD\u8BFB\u6574\u6BB5\u5BF9\u8BDD\u3002\u4FDD\u6D3B\u5728\u7B49\u5F85\u671F\u95F4\u5B9A\u65F6\u628A Lead \u4E0A\u4E00\u6B21\u7684\u8BF7\u6C42\u539F\u6837\u518D\u53D1\u4E00\u904D\uFF0C\u672B\u5C3E\u53EA\u52A0\u4E00\u53E5\u201CReply OK\u201D\uFF0C\u6A21\u578B\u53EA\u56DE\u4E00\u4E2A OK\uFF0C\u7F13\u5B58\u5C31\u4E0D\u4F1A\u8FC7\u671F\u3002\u9ED8\u8BA4\u503C\u6765\u81EA\u5404\u5BB6\u5B98\u65B9\u6587\u6863\uFF0C\u6BCF\u4E2A\u6A21\u578B\u90FD\u53EF\u4EE5\u5355\u72EC\u8C03\u6574\u3002",
      "While the Lead waits for the Sidekick, the model's prompt cache can expire and the next request re-reads the whole conversation at full price. Keepalive resends the Lead's previous request at intervals with only \u201CReply OK\u201D appended; the model answers OK and the cache stays warm. Defaults come from each provider's documentation; every model can be adjusted."
    ) }),
    checked && /* @__PURE__ */ (0, import_jsx_runtime10.jsx)("p", { children: /* @__PURE__ */ (0, import_jsx_runtime10.jsx)("small", { children: tr(lang, `\u5B98\u65B9\u9ED8\u8BA4\u503C\u6838\u5BF9\u65E5\u671F\uFF1A${checked}\u3002`, `Documented defaults checked on ${checked}.`) }) }),
    error && /* @__PURE__ */ (0, import_jsx_runtime10.jsx)("p", { role: "alert", children: error }),
    rows?.map((row) => /* @__PURE__ */ (0, import_jsx_runtime10.jsx)(ModelCard, { row, onSaved: () => setReload((value) => value + 1) }, `${row.provider}/${row.model}/${row.setting.mode ?? ""}/${row.setting.intervalSeconds ?? ""}`))
  ] });
}

// src/client/FusionPanel.tsx
var import_jsx_runtime11 = require("react/jsx-runtime");
var styles5 = `
.fusion-panel{padding:24px 28px;max-width:920px;overflow:auto;height:100%;box-sizing:border-box;color:var(--dsw-alias-label-primary);font-size:13px;line-height:1.6}
.fusion-panel h1{font-size:20px;margin:0 0 6px;font-weight:600;letter-spacing:-0.01em}
.fusion-panel>p{margin:0 0 20px;color:var(--dsw-alias-label-secondary);max-width:640px}
.fusion-panel .fusion-history,.fusion-panel .fusion-cache{margin:0 0 28px}
.fusion-panel table{border-collapse:collapse;width:100%;border:1px solid var(--dsw-alias-border-l2);border-radius:10px;overflow:hidden}
.fusion-panel :is(th,td){text-align:left;padding:10px 14px;border-bottom:1px solid var(--dsw-alias-border-l2);font-weight:400;vertical-align:top}
.fusion-panel tbody tr:last-child td{border-bottom:0}
.fusion-panel tbody tr{transition:background-color .12s}
.fusion-panel tbody tr:hover{background-color:var(--dsw-alias-bg-layer-1)}
.fusion-panel thead th{color:var(--dsw-alias-label-secondary);font-weight:600;font-size:12px;background-color:var(--dsw-alias-bg-layer-1);white-space:nowrap}
.fusion-panel small{display:block;color:var(--dsw-alias-label-secondary);font-size:12px;margin-top:2px}
.fusion-panel button{font:inherit;color:var(--dsw-alias-label-primary);border:1px solid var(--dsw-alias-border-l2);border-radius:8px;padding:6px 14px;background-color:var(--dsw-alias-button-elevated-fill);cursor:pointer;transition:background-color .12s,border-color .12s}
.fusion-panel button:hover:not(:disabled){background-color:var(--dsw-alias-bg-layer-2,var(--dsw-alias-bg-layer-1))}
.fusion-panel button:disabled{opacity:.5;cursor:default}
.fusion-panel .fusion-actions{display:flex;gap:8px;margin:8px 0}
.fusion-panel h2{font-size:14px;margin:0 0 8px;font-weight:600}
.fusion-panel h3{font-size:13px;margin:14px 0 6px;font-weight:600}
.fusion-panel ol,.fusion-panel ul{margin:0;padding-left:20px}
.fusion-panel li{margin:0 0 10px}
.fusion-panel [role=alert]{color:var(--dsw-alias-state-error-primary)}
.fusion-panel select,.fusion-panel input{font:inherit;color:var(--dsw-alias-label-primary);background-color:var(--dsw-alias-bg-layer-1);border:1px solid var(--dsw-alias-border-l2);border-radius:8px;padding:4px 8px;color-scheme:inherit}
.fusion-panel .fusion-empty{padding:48px 16px;text-align:center;color:var(--dsw-alias-label-secondary);border:1px dashed var(--dsw-alias-border-l2);border-radius:12px;font-size:13px}
.fusion-panel .fusion-running{display:flex;flex-wrap:wrap;gap:8px;margin:0 0 20px}
.fusion-panel .fusion-chip{display:inline-flex;align-items:center;gap:8px;padding:6px 12px;border:1px solid var(--dsw-alias-border-l2);border-radius:999px;background:var(--dsw-alias-bg-layer-1);font-size:12px;line-height:1.3}
.fusion-panel .fusion-chip b{font-weight:600;max-width:220px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.fusion-panel .fusion-chip[data-attention=true]{border-color:var(--dsw-alias-state-error-primary);color:var(--dsw-alias-state-error-primary)}
.fusion-panel .fusion-chip .fusion-dot{width:7px;height:7px;border-radius:50%;background:var(--dsw-alias-brand-primary);flex:none}
.fusion-panel .fusion-chip[data-stage=\u5B8C\u6210] .fusion-dot{background:var(--dsw-alias-state-success-primary,#3a5)}
.fusion-panel .fusion-chip[data-stage=\u5F85\u547D] .fusion-dot{background:var(--dsw-alias-label-secondary);opacity:.5}
.fusion-panel .fusion-tabs{display:flex;gap:2px;margin:0 0 20px;border-bottom:1px solid var(--dsw-alias-border-l2)}
.fusion-panel .fusion-tabs button{font:inherit;font-size:13px;color:var(--dsw-alias-label-secondary);background:none;border:0;border-bottom:2px solid transparent;padding:7px 14px;cursor:pointer;border-radius:0;transition:color .12s}
.fusion-panel .fusion-tabs button:hover{color:var(--dsw-alias-label-primary)}
.fusion-panel .fusion-tabs button[aria-selected=true]{color:var(--dsw-alias-label-primary);border-bottom-color:var(--dsw-alias-brand-primary);font-weight:600}
`;
var FINISHED = /* @__PURE__ */ new Set(["\u5B8C\u6210"]);
var stageOf = (lang, task) => task ? lang === "en" ? task.stageEn ?? task.stage : task.stage : tr(lang, "\u5F85\u547D", "idle");
function FusionNextIcon() {
  return /* @__PURE__ */ (0, import_jsx_runtime11.jsxs)("svg", { width: "18", height: "18", viewBox: "0 0 18 18", fill: "none", "aria-hidden": "true", children: [
    /* @__PURE__ */ (0, import_jsx_runtime11.jsx)("circle", { cx: "5.5", cy: "5.5", r: "3", stroke: "currentColor", strokeWidth: "1.4" }),
    /* @__PURE__ */ (0, import_jsx_runtime11.jsx)("circle", { cx: "12.5", cy: "12.5", r: "3", stroke: "currentColor", strokeWidth: "1.4" }),
    /* @__PURE__ */ (0, import_jsx_runtime11.jsx)("path", { d: "M7.8 7.8 10.2 10.2", stroke: "currentColor", strokeWidth: "1.4", strokeLinecap: "round" })
  ] });
}
function FusionPanel() {
  const lang = useLang();
  const [tab, setTab] = (0, import_react13.useState)("running");
  const [sessions, setSessions] = (0, import_react13.useState)([]);
  const [loaded, setLoaded] = (0, import_react13.useState)(false);
  (0, import_react13.useEffect)(() => {
    const abort = new AbortController();
    const load = () => {
      void fetch("/api/fusion-next?view=running", { credentials: "same-origin", cache: "no-store", signal: abort.signal }).then(async (response) => {
        if (!response.ok) throw new Error("unavailable");
        const view = await response.json();
        setSessions(view.sessions ?? []);
        setLoaded(true);
      }).catch(() => {
        if (!abort.signal.aborted) setLoaded(true);
      });
    };
    load();
    const timer = setInterval(load, 1e4);
    return () => {
      abort.abort();
      clearInterval(timer);
    };
  }, []);
  const running2 = sessions.filter((session) => session.task && !FINISHED.has(session.task.stage));
  const labelOf = (session) => session.title ?? session.sessionId.replace(/^session-/, "").split("-")[0];
  return /* @__PURE__ */ (0, import_jsx_runtime11.jsxs)("main", { className: "fusion-panel", "aria-label": tr(lang, "Fusion Next \u63A7\u5236\u53F0", "Fusion Next console"), "data-ud-check": "fusion-panel", children: [
    /* @__PURE__ */ (0, import_jsx_runtime11.jsx)("style", { children: styles5 }),
    /* @__PURE__ */ (0, import_jsx_runtime11.jsx)("h1", { children: "Fusion Next" }),
    /* @__PURE__ */ (0, import_jsx_runtime11.jsx)("p", { children: tr(
      lang,
      "\u6BCF\u4E2A\u4F1A\u8BDD\u4E00\u652F\u300C\u89C4\u5212 + \u6267\u884C\u300D\u53CC\u4EBA\u7EC4\uFF1A\u89C4\u5212\u8D1F\u8D23\u62C6\u89E3\u3001\u5BA1\u67E5\u4E0E\u63A5\u7BA1\uFF0C\u6267\u884C\u8D1F\u8D23\u5B9E\u9645\u6539\u52A8\u3002\u8FD9\u91CC\u6C47\u603B\u6240\u6709\u4F1A\u8BDD\u7684\u8FD0\u884C\u8BB0\u5F55\u4E0E\u7528\u91CF\u3002",
      "Each session runs a planner\u2013executor pair: the planner decomposes, reviews and takes over; the executor makes the changes. This page aggregates runs and usage across sessions."
    ) }),
    sessions.length > 0 && /* @__PURE__ */ (0, import_jsx_runtime11.jsx)("div", { className: "fusion-running", "aria-label": tr(lang, "\u542F\u7528 Fusion \u7684\u4F1A\u8BDD", "Sessions on Fusion Next"), children: sessions.map((session) => {
      const stage = stageOf(lang, session.task);
      return /* @__PURE__ */ (0, import_jsx_runtime11.jsxs)("span", { className: "fusion-chip", "data-attention": session.task?.attention ?? false, "data-stage": session.task?.stage ?? "", children: [
        /* @__PURE__ */ (0, import_jsx_runtime11.jsx)("span", { className: "fusion-dot" }),
        /* @__PURE__ */ (0, import_jsx_runtime11.jsx)("b", { children: labelOf(session) }),
        /* @__PURE__ */ (0, import_jsx_runtime11.jsxs)("span", { children: [
          stage,
          session.task?.usage ? ` \xB7 ${session.task.usage.calls} \u6B21` : ""
        ] })
      ] }, session.sessionId);
    }) }),
    /* @__PURE__ */ (0, import_jsx_runtime11.jsxs)("div", { className: "fusion-tabs", role: "tablist", children: [
      /* @__PURE__ */ (0, import_jsx_runtime11.jsx)("button", { role: "tab", "aria-selected": tab === "running", onClick: () => setTab("running"), children: tr(lang, `\u8FD0\u884C\u4E2D${running2.length ? `\uFF08${running2.length}\uFF09` : ""}`, `Running${running2.length ? ` (${running2.length})` : ""}`) }),
      /* @__PURE__ */ (0, import_jsx_runtime11.jsx)("button", { role: "tab", "aria-selected": tab === "history", onClick: () => setTab("history"), children: tr(lang, "\u5386\u53F2\u4E0E\u7EDF\u8BA1", "History & stats") }),
      /* @__PURE__ */ (0, import_jsx_runtime11.jsx)("button", { role: "tab", "aria-selected": tab === "cache", onClick: () => setTab("cache"), children: tr(lang, "\u7F13\u5B58\u4FDD\u6D3B", "Cache keepalive") })
    ] }),
    tab === "running" && /* @__PURE__ */ (0, import_jsx_runtime11.jsxs)(import_jsx_runtime11.Fragment, { children: [
      running2.length === 0 && /* @__PURE__ */ (0, import_jsx_runtime11.jsx)("p", { className: "fusion-empty", children: loaded ? tr(
        lang,
        "\u5F53\u524D\u6CA1\u6709\u8FD0\u884C\u4E2D\u7684 Fusion \u4EFB\u52A1\u3002\u5728\u67D0\u4E2A\u4F1A\u8BDD\u8F93\u5165\u6846\u65C1\u7684\u300C\u6267\u884C\u300D\u9009\u62E9\u5668\u6311\u4E00\u4E2A\u6267\u884C\u6A21\u578B\u5373\u53EF\u5F00\u59CB\u3002",
        "No fusion tasks are running. Pick an executor beside a session's model selector to start one."
      ) : tr(lang, "\u6B63\u5728\u8BFB\u53D6\u2026", "Loading\u2026") }),
      running2.length > 0 && /* @__PURE__ */ (0, import_jsx_runtime11.jsxs)("table", { children: [
        /* @__PURE__ */ (0, import_jsx_runtime11.jsx)("thead", { children: /* @__PURE__ */ (0, import_jsx_runtime11.jsxs)("tr", { children: [
          /* @__PURE__ */ (0, import_jsx_runtime11.jsx)("th", { children: tr(lang, "\u4F1A\u8BDD", "Session") }),
          /* @__PURE__ */ (0, import_jsx_runtime11.jsx)("th", { children: tr(lang, "\u89C4\u5212", "Planner") }),
          /* @__PURE__ */ (0, import_jsx_runtime11.jsx)("th", { children: tr(lang, "\u6267\u884C", "Executor") }),
          /* @__PURE__ */ (0, import_jsx_runtime11.jsx)("th", { children: tr(lang, "\u5F53\u524D\u4EFB\u52A1", "Current task") }),
          /* @__PURE__ */ (0, import_jsx_runtime11.jsx)("th", { children: tr(lang, "\u8BF7\u6C42", "Requests") })
        ] }) }),
        /* @__PURE__ */ (0, import_jsx_runtime11.jsx)("tbody", { children: running2.map((session) => /* @__PURE__ */ (0, import_jsx_runtime11.jsxs)("tr", { children: [
          /* @__PURE__ */ (0, import_jsx_runtime11.jsxs)("td", { children: [
            /* @__PURE__ */ (0, import_jsx_runtime11.jsx)("b", { children: labelOf(session) }),
            /* @__PURE__ */ (0, import_jsx_runtime11.jsx)("small", { children: session.sessionId })
          ] }),
          /* @__PURE__ */ (0, import_jsx_runtime11.jsxs)("td", { children: [
            session.lead.model,
            /* @__PURE__ */ (0, import_jsx_runtime11.jsx)("small", { children: session.lead.provider })
          ] }),
          /* @__PURE__ */ (0, import_jsx_runtime11.jsxs)("td", { children: [
            session.worker.model,
            /* @__PURE__ */ (0, import_jsx_runtime11.jsx)("small", { children: session.worker.provider })
          ] }),
          /* @__PURE__ */ (0, import_jsx_runtime11.jsxs)("td", { "data-attention": session.task?.attention ?? false, children: [
            session.task?.attention ? "\u26A0 " : "",
            stageOf(lang, session.task),
            /* @__PURE__ */ (0, import_jsx_runtime11.jsx)("small", { children: lang === "en" && session.task?.detailEn !== void 0 ? session.task.detailEn : session.task?.detail ?? "" })
          ] }),
          /* @__PURE__ */ (0, import_jsx_runtime11.jsx)("td", { children: session.task?.usage?.calls ?? "\u2014" })
        ] }, session.sessionId)) })
      ] })
    ] }),
    tab === "history" && /* @__PURE__ */ (0, import_jsx_runtime11.jsx)(FusionHistory, {}),
    tab === "cache" && /* @__PURE__ */ (0, import_jsx_runtime11.jsx)(FusionCache, { refresh: 0 })
  ] });
}

// src/client/index.ts
var name = "fusion-next/client";
var inject = ["slots"];
function apply(ctx) {
  ctx.inject(["locale"], (scope) => {
    scope.effect(() => bindLocale(scope.locale));
  });
  for (const tool of fusionControlTools) ctx.slots.inject("tool.call.toolview", () => ctx.slots.register({
    name: "tool.call.toolview",
    key: tool
  }, FusionTool));
  ctx.slots.inject("settings.section", () => ctx.slots.register({
    name: "settings.section",
    id: "fusion-next",
    order: 18,
    label: () => "Fusion Next",
    inject: () => ({})
  }, FusionSettings));
  ctx.slots.inject("conversation.view", () => ctx.slots.register({
    name: "conversation.view",
    id: "fusion-next",
    order: 30,
    label: () => "Fusion Next",
    inject: () => ({})
  }, FusionConsole));
  ctx.slots.inject("sidebar.panellist", () => ctx.slots.register({
    name: "sidebar.panellist",
    id: "fusion-next",
    order: 40,
    label: () => "Fusion Next",
    inject: () => ({})
  }, FusionNextIcon));
  ctx.slots.inject("main", () => ctx.slots.register({
    name: "main",
    key: "fusion-next",
    inject: () => ({})
  }, FusionPanel));
  ctx.inject(["modelDirectories"], (scope) => {
    const directoryInject = (sessionId) => {
      const directory = scope.modelDirectories.directoryFor(sessionId);
      return { sessionId, directory: directory.store, load: () => {
        void directory.load().catch(() => void 0);
      } };
    };
    scope.slots.inject("conversation.input.right", () => scope.slots.register({
      name: "conversation.input.right",
      id: "fusion-next-executor",
      order: 5,
      inject: directoryInject
    }, FusionPairPicker));
    scope.slots.inject("conversation.input.dock", () => scope.slots.register({
      name: "conversation.input.dock",
      id: "fusion-next-attention",
      order: 19,
      inject: directoryInject
    }, FusionDockAttention));
    scope.slots.inject("conversation.input.dock", () => scope.slots.register({
      name: "conversation.input.dock",
      id: "fusion-next-configuration",
      order: 20,
      inject: directoryInject
    }, FusionHint));
  });
}
		return module.exports;
	}
});

//# sourceMappingURL=client.js.map
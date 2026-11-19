window.__ModuleLoader__.load({
	id: "fusion-next",
	factory: (require) => {
		var module = { exports: {} };
		var exports = module.exports;
		Object.defineProperty(exports, Symbol.toStringTag, { value: "Module" });
		let react = require("react");
		let react_jsx_runtime = require("react/jsx-runtime");
		let _deepseek_ai_dsh_client_ui_primitives = require("@deepseek-ai/dsh-client-ui-primitives");
		//#region src/client/settings-events.ts
		const listeners$1 = /* @__PURE__ */ new Set();
		const onSettingsChanged = (listener) => {
			listeners$1.add(listener);
			return () => {
				listeners$1.delete(listener);
			};
		};
		const settingsChanged = () => {
			for (const listener of listeners$1) listener();
		};
		//#endregion
		//#region src/client/i18n.ts
		let source;
		const listeners = /* @__PURE__ */ new Set();
		const notify = () => {
			for (const listener of listeners) listener();
		};
		/** Called from the client entry when DSH's locale service is available; follows the user's language setting. */
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
		const current = () => {
			return (source?.getSnapshot().active ?? (typeof navigator === "undefined" ? "en" : navigator.language)).toLowerCase().startsWith("zh") ? "zh" : "en";
		};
		/** The UI language: Chinese for any zh locale, English otherwise (DSH's own fallback). */
		function useLang() {
			return (0, react.useSyncExternalStore)((listener) => {
				listeners.add(listener);
				return () => {
					listeners.delete(listener);
				};
			}, current, () => "en");
		}
		/** Pick the text for the active language. */
		const tr = (lang, zh, en) => lang === "zh" ? zh : en;
		//#endregion
		//#region src/client/FusionSettings.tsx
		const styles$3 = `
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
		const key = (route) => route ? JSON.stringify([route.provider, route.model]) : "";
		function ModelChoice({ role, route, catalog, onChange }) {
			const lang = useLang();
			const name = role === "Lead" ? tr(lang, "规划", "Planner") : role === "Sidekick" ? tr(lang, "执行", "Executor") : tr(lang, "压缩", "Compaction");
			const model = catalog.groups.find((group) => group.id === route?.provider)?.models.find((model) => model.id === route?.model);
			return /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("fieldset", { children: [
				/* @__PURE__ */ (0, react_jsx_runtime.jsx)("legend", { children: name }),
				/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("label", { children: [tr(lang, "模型", "Model"), /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("select", {
					"aria-label": tr(lang, `${name} 模型`, `${name} model`),
					value: key(route),
					onChange: (event) => {
						if (!event.target.value) {
							onChange(void 0);
							return;
						}
						const [provider, model] = JSON.parse(event.target.value);
						onChange({
							provider,
							model
						});
					},
					children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("option", {
						value: "",
						disabled: role !== "compactor",
						children: role === "compactor" ? tr(lang, "跟随角色模型", "Use the role's own model") : tr(lang, "选择模型", "Choose a model")
					}), catalog.groups.map((group) => /* @__PURE__ */ (0, react_jsx_runtime.jsx)("optgroup", {
						label: group.name,
						children: group.models.map((model) => /* @__PURE__ */ (0, react_jsx_runtime.jsx)("option", {
							value: key({
								provider: group.id,
								model: model.id
							}),
							children: model.name
						}, model.id))
					}, group.id))]
				})] }),
				model?.reasoning && route && /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("label", { children: [tr(lang, "推理强度", "Reasoning"), /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("select", {
					"aria-label": tr(lang, `${name} 推理强度`, `${name} reasoning`),
					value: route.reasoningEffort ?? "",
					onChange: (event) => {
						const { reasoningEffort: _old, ...physical } = route;
						onChange({
							...physical,
							...event.target.value ? { reasoningEffort: event.target.value } : {}
						});
					},
					children: [/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("option", {
						value: "",
						children: [tr(lang, "模型默认", "Model default"), model.reasoning.defaultEffort ? ` · ${model.reasoning.defaultEffort}` : ""]
					}), model.reasoning.efforts.map((effort) => /* @__PURE__ */ (0, react_jsx_runtime.jsx)("option", {
						value: effort.id,
						children: effort.name
					}, effort.id))]
				})] })
			] });
		}
		function FusionSettings() {
			const lang = useLang();
			const [state, setState] = (0, react.useState)();
			const [draft, setDraft] = (0, react.useState)({});
			const [error, setError] = (0, react.useState)();
			const [notice, setNotice] = (0, react.useState)();
			const [saving, setSaving] = (0, react.useState)(false);
			const chooseModel = (role, route) => setDraft((value) => ({
				...value,
				[role]: route,
				...value.cacheKeepalive ? { cacheKeepalive: {
					...value.cacheKeepalive,
					[role]: role === "lead" ? "auto" : false
				} } : {}
			}));
			(0, react.useEffect)(() => {
				const abort = new AbortController();
				fetch("/api/fusion-next?view=settings", {
					credentials: "same-origin",
					cache: "no-store",
					signal: abort.signal
				}).then(async (response) => {
					if (!response.ok) throw new Error(tr(lang, "无法读取 Fusion Next 设置", "Cannot read Fusion Next settings"));
					return response.json();
				}).then((value) => {
					setState(value);
					setDraft(value.pair ?? {});
				}).catch((error) => {
					if (!abort.signal.aborted) setError(String(error));
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
					const limits = Object.fromEntries(Object.entries(outputTokens ?? {}).filter(([, tokens]) => Number.isSafeInteger(tokens) && Number(tokens) > 0));
					const pair = {
						...rest,
						...Object.keys(limits).length ? { outputTokens: limits } : {}
					};
					const response = await fetch("/api/fusion-next", {
						method: "POST",
						credentials: "same-origin",
						headers: { "content-type": "application/json" },
						body: JSON.stringify({
							action: "configure",
							revision: state.revision,
							pair
						})
					});
					const result = await response.json();
					if (!response.ok) throw new Error(result.error ?? tr(lang, "保存失败，请刷新后重试", "Save failed; refresh and try again"));
					const current = await fetch("/api/fusion-next?view=settings", {
						credentials: "same-origin",
						cache: "no-store"
					});
					if (!current.ok) throw new Error(tr(lang, "配置已提交，但暂时无法确认，请刷新", "Saved, but not confirmed yet; refresh"));
					const confirmed = await current.json();
					setState(confirmed);
					setDraft(confirmed.pair ?? {});
					settingsChanged();
					setNotice(tr(lang, "默认组合已保存。", "Default pair saved."));
				} catch (error) {
					setError(error instanceof Error ? error.message : String(error));
				} finally {
					setSaving(false);
				}
			};
			return /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
				className: "fusion-settings",
				children: [
					/* @__PURE__ */ (0, react_jsx_runtime.jsx)("style", { children: styles$3 }),
					/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("header", { children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("h2", { children: "Fusion Next" }), /* @__PURE__ */ (0, react_jsx_runtime.jsx)("p", { children: tr(lang, "默认的「规划 + 执行」组合。会话里直接挑执行模型即可开启双模型协作；规划 = 会话模型本身。执行越便宜越省。", "The default planner–executor pair. Pick an executor beside a session's model selector to start two-model collaboration; the planner is the session model itself. A cheaper executor saves more.") })] }),
					error && /* @__PURE__ */ (0, react_jsx_runtime.jsx)("p", {
						role: "alert",
						children: error
					}),
					!state && !error && /* @__PURE__ */ (0, react_jsx_runtime.jsx)("p", {
						role: "status",
						children: tr(lang, "正在读取模型…", "Loading models…")
					}),
					state && /* @__PURE__ */ (0, react_jsx_runtime.jsxs)(react_jsx_runtime.Fragment, { children: [
						/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("fieldset", {
							className: "fusion-card",
							disabled: saving,
							children: [
								/* @__PURE__ */ (0, react_jsx_runtime.jsx)(ModelChoice, {
									role: "Lead",
									route: draft.lead,
									catalog: state.catalog,
									onChange: (route) => {
										if (route) chooseModel("lead", route);
									}
								}),
								/* @__PURE__ */ (0, react_jsx_runtime.jsx)(ModelChoice, {
									role: "Sidekick",
									route: draft.worker,
									catalog: state.catalog,
									onChange: (route) => {
										if (route) chooseModel("worker", route);
									}
								}),
								/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("label", { children: [tr(lang, "规划权限", "Planner mode"), /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("select", {
									"aria-label": tr(lang, "规划模型权限", "Planner access mode"),
									value: draft.leadConfinement ?? "read-only",
									onChange: (event) => setDraft((value) => ({
										...value,
										leadConfinement: event.target.value === "user-mode" ? "user-mode" : "read-only"
									})),
									children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("option", {
										value: "read-only",
										children: tr(lang, "只读（推荐：所有改动都过执行模型验收）", "Read-only (recommended: all changes go through executor review)")
									}), /* @__PURE__ */ (0, react_jsx_runtime.jsx)("option", {
										value: "user-mode",
										children: tr(lang, "跟随你的权限（规划模型可直接改，改动不经验收）", "Follow your mode (planner can change files directly, unreviewed)")
									})]
								})] }),
								/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("details", { children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("summary", { children: tr(lang, "压缩模型 · 可选", "Compaction model · optional") }), /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
									className: "fusion-limits",
									children: [
										/* @__PURE__ */ (0, react_jsx_runtime.jsx)("p", { children: tr(lang, "默认由角色自己的模型压缩，也可单独指定（由所选账号计费）。", "Each role compacts with its own model unless you pin another (billed to that account).") }),
										/* @__PURE__ */ (0, react_jsx_runtime.jsx)(ModelChoice, {
											role: "compactor",
											route: draft.compactor?.route,
											catalog: state.catalog,
											onChange: (route) => setDraft((value) => {
												const { compactor, ...rest } = value;
												return route ? {
													...rest,
													compactor: {
														route,
														maxOutputTokens: compactor?.maxOutputTokens ?? 8192
													}
												} : rest;
											})
										}),
										draft.compactor && /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("label", { children: [tr(lang, "输出上限", "Output limit"), /* @__PURE__ */ (0, react_jsx_runtime.jsx)("input", {
											"aria-label": tr(lang, "压缩输出 Token 上限", "Compaction output token limit"),
											type: "number",
											min: "1",
											max: "128000",
											value: draft.compactor.maxOutputTokens,
											onChange: (event) => {
												const maxOutputTokens = Number(event.target.value);
												setDraft((value) => value.compactor ? {
													...value,
													compactor: {
														...value.compactor,
														maxOutputTokens
													}
												} : value);
											}
										})] })
									]
								})] })
							]
						}),
						/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
							className: "fusion-actions",
							children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("p", { children: tr(lang, "已配对的会话保留原组合。", "Already-paired sessions keep their pair.") }), /* @__PURE__ */ (0, react_jsx_runtime.jsx)("button", {
								disabled: saving || !draft.lead || !draft.worker || JSON.stringify(draft) === JSON.stringify(state.pair),
								onClick: () => {
									save();
								},
								children: saving ? tr(lang, "正在保存…", "Saving…") : tr(lang, "保存", "Save")
							})]
						}),
						notice && /* @__PURE__ */ (0, react_jsx_runtime.jsx)("p", {
							role: "status",
							children: notice
						}),
						/* @__PURE__ */ (0, react_jsx_runtime.jsx)("p", { children: tr(lang, "保存即表示允许 Fusion Next 使用所选模型的现有账号；费用由这些账号计入。", "Saving lets Fusion Next use the chosen models' existing accounts; they are billed there.") }),
						state.pair && !state.authorized && /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("p", {
							role: "status",
							children: [tr(lang, "组合需要重新保存后才能使用", "Save the pair again before use"), state.reason ? `: ${state.reason}` : ""]
						}),
						state.managedAuthorization && /* @__PURE__ */ (0, react_jsx_runtime.jsx)("p", { children: tr(lang, "运行额度由外部授权配置管理。", "Run limits are managed by an external authorization file.") })
					] })
				]
			});
		}
		//#endregion
		//#region src/client/FusionHint.tsx
		/** Additive composer hint. The original selector and its selection state stay native. */
		function FusionHint({ sessionId, directory, load }) {
			const selected = (0, react.useSyncExternalStore)(directory.subscribe, directory.getSnapshot).current;
			const fusion = selected?.provider === "fusion-next" && selected.model === "auto";
			const lang = useLang();
			const [message, setMessage] = (0, react.useState)();
			(0, react.useEffect)(() => {
				load();
			}, [load]);
			(0, react.useEffect)(() => {
				if (!fusion) {
					setMessage(void 0);
					return;
				}
				let active = true;
				const abort = new AbortController();
				const refresh = () => {
					fetch("/api/fusion-next?view=settings", {
						credentials: "same-origin",
						cache: "no-store",
						signal: abort.signal
					}).then(async (response) => {
						if (!response.ok) throw new Error("unavailable");
						return response.json();
					}).then((state) => {
						if (active) setMessage(!state.pair ? tr(lang, "Fusion 尚未配置模型，请前往设置 → Fusion 选择 Lead 和 Sidekick。", "Fusion has no models yet: open Settings → Fusion Next and choose a Lead and a Sidekick.") : !state.authorized ? tr(lang, "Fusion 当前配置未就绪，请前往设置 → Fusion 查看。", "The Fusion setup is not ready: see Settings → Fusion Next.") : void 0);
					}).catch(() => {
						if (active) setMessage(tr(lang, "暂时无法确认 Fusion 配置，请前往设置 → Fusion 查看。", "Cannot confirm the Fusion setup right now: see Settings → Fusion Next."));
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
			return /* @__PURE__ */ (0, react_jsx_runtime.jsx)(react_jsx_runtime.Fragment, { children: message && /* @__PURE__ */ (0, react_jsx_runtime.jsx)("p", {
				role: "status",
				style: {
					margin: "8px 12px",
					color: "var(--dsw-alias-label-secondary)",
					fontSize: 12,
					lineHeight: "18px"
				},
				children: message
			}) });
		}
		//#endregion
		//#region src/client/FusionPairPicker.tsx
		const styles$2 = `
		.fusion-executor{display:flex;align-items:center;gap:6px;min-width:0}
		.fusion-executor .fusion-executor-mark{display:flex;align-items:center;gap:4px;color:var(--dsw-alias-label-secondary);flex:none}
		.fusion-executor .fusion-executor-label{display:var(--dsh-composer-model-text-display,inline);font-size:12px;white-space:nowrap}
		.fusion-executor select{appearance:none;-webkit-appearance:none;font:inherit;font-size:13px;height:28px;width:auto;min-width:0;max-width:150px;padding:0 18px 0 4px;border-radius:8px;cursor:pointer;
		  border:0;background-color:transparent;color:var(--dsw-alias-label-primary);color-scheme:inherit;
		  text-overflow:ellipsis;white-space:nowrap;overflow:hidden;
		  background-image:url("data:image/svg+xml;utf8,<svg xmlns='http://www.w3.org/2000/svg' width='14' height='14' viewBox='0 0 16 16'><path d='M4.5 6.5l3.5 3.5 3.5-3.5' fill='none' stroke='%23999' stroke-width='1.4' stroke-linecap='round' stroke-linejoin='round'/></svg>");
		  background-repeat:no-repeat;background-position:right 4px center}
		.fusion-executor .fusion-executor-sizer{visibility:hidden;position:absolute;height:0;overflow:hidden;white-space:nowrap;font-size:13px;pointer-events:none}
		.fusion-executor select:hover{background-color:var(--dsw-alias-bg-layer-1)}
		.fusion-executor select[data-active=true]{color:var(--dsw-alias-brand-primary)}
		.fusion-executor select:disabled{cursor:default;opacity:.6}
		.fusion-executor select:focus-visible{outline:2px solid var(--dsw-alias-brand-primary);outline-offset:1px}
		.fusion-executor [role=status]{font-size:12px;color:var(--dsw-alias-state-error-primary);white-space:nowrap}
		.fusion-executor .fusion-executor-mode{display:var(--dsh-composer-model-text-display,inline);font-size:11px;padding:1px 7px;border-radius:999px;white-space:nowrap;
		  border:1px solid var(--dsw-alias-border-primary);color:var(--dsw-alias-label-secondary);flex:none}
		`;
		const keyOf = (route) => `${route.provider}/${route.model}`;
		const MODE_LABEL = {
			"read-only": "只读",
			"workspace-write": "工作区修改",
			"danger-full-access": "完全权限"
		};
		const routeOf = (key) => {
			const cut = key.indexOf("/");
			return cut > 0 ? {
				provider: key.slice(0, cut),
				model: key.slice(cut + 1)
			} : void 0;
		};
		/**
		* Composer tool-row executor picker, next to the native model selector: the
		* session's own model is the planner; picking an executor here turns Fusion
		* Next on for this session, choosing Off returns it to a plain session.
		*/
		function FusionPairPicker({ sessionId, directory, load }) {
			const lang = useLang();
			const [view, setView] = (0, react.useState)();
			const [busy, setBusy] = (0, react.useState)(false);
			const [error, setError] = (0, react.useState)();
			const cmdPair = async (line) => {
				const res = await fetch("api/commands/execute", {
					method: "POST",
					credentials: "same-origin",
					headers: { "content-type": "application/json" },
					body: JSON.stringify({
						type: "client-request",
						rpcId: crypto.randomUUID(),
						method: "commands/execute",
						payload: { args: {
							agentId: sessionId,
							line,
							submittedAttachments: []
						} }
					})
				});
				if (!res.ok) return void 0;
				const body = await res.json().catch(() => void 0);
				return body?.result?.value?.result?.text ?? body?.result?.value?.text;
			};
			const refreshViaCommand = async () => {
				const text = await cmdPair("/fusion-next pair");
				const found = text?.match(/执行模型[：:]\s*([^\s（(]+)|Executor:\s*([^\s(]+)/i);
				const worker = found ? routeOf(found[1] ?? found[2] ?? "") ?? null : null;
				const modeFound = text?.match(/执行权限[：:]?\s*([a-z-]+)|executor mode\s+([a-z-]+)/i);
				setView(text === void 0 ? void 0 : {
					worker,
					lead: null,
					selected: Boolean(worker),
					executorMode: modeFound?.[1] ?? modeFound?.[2] ?? null
				});
			};
			const refresh = () => {
				fetch(`/api/fusion-next?view=session-pair&sessionId=${encodeURIComponent(sessionId)}`, {
					credentials: "same-origin",
					cache: "no-store"
				}).then(async (response) => response.ok ? response.json() : void 0).then(async (data) => data === void 0 ? void refreshViaCommand() : setView(data)).catch(() => void refreshViaCommand());
			};
			(0, react.useEffect)(() => {
				load();
				refresh();
				const timer = setInterval(refresh, 15e3);
				return () => clearInterval(timer);
			}, [load, sessionId]);
			const choose = (value) => {
				if (busy) return;
				setBusy(true);
				setError(void 0);
				fetch("/api/fusion-next", {
					method: "POST",
					credentials: "same-origin",
					headers: { "content-type": "application/json" },
					body: JSON.stringify({
						action: "session-pair",
						sessionId,
						worker: value ? routeOf(value) ?? null : null
					})
				}).then(async (response) => {
					if (response.ok) {
						refresh();
						return;
					}
					const body = await response.json().catch(() => ({}));
					if (response.status === 401 || response.status === 403) {
						if (await cmdPair(`/fusion-next pair ${value || "off"}`) === void 0) throw new Error(tr(lang, `远程模式：请发送 /fusion-next pair ${value || "off"}`, `Remote mode: send /fusion-next pair ${value || "off"}`));
						refreshViaCommand();
						return;
					}
					throw new Error(body.error ?? `HTTP ${response.status}`);
				}).catch((cause) => setError(cause instanceof Error ? cause.message : String(cause))).finally(() => setBusy(false));
			};
			const dirState = (0, react.useSyncExternalStore)(directory.subscribe, directory.getSnapshot);
			const groups = dirState.groups.length ? dirState.groups.map((group) => ({
				id: group.id,
				name: group.name,
				models: group.models.map((model) => ({
					id: model.id,
					name: model.name
				}))
			})) : view?.catalog?.groups ?? [];
			const current = view?.worker ? keyOf(view.worker) : "";
			const offLabel = tr(lang, "关闭", "Off");
			let selectedLabel = offLabel;
			if (current) {
				for (const group of groups) {
					const found = group.models.find((model) => `${group.id}/${model.id}` === current);
					if (found) {
						selectedLabel = found.name;
						break;
					}
				}
				if (selectedLabel === offLabel) selectedLabel = current;
			}
			const sizerRef = (0, react.useRef)(null);
			const [selectWidth, setSelectWidth] = (0, react.useState)(void 0);
			(0, react.useLayoutEffect)(() => {
				const sizer = sizerRef.current;
				if (!sizer) return;
				const measured = Math.ceil(sizer.getBoundingClientRect().width) + 26;
				setSelectWidth(Math.min(Math.max(measured, 44), 240));
			}, [selectedLabel]);
			return /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
				className: "fusion-executor",
				"data-ud-check": "fusion-executor",
				children: [
					/* @__PURE__ */ (0, react_jsx_runtime.jsx)("style", { children: styles$2 }),
					/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("span", {
						className: "fusion-executor-mark",
						title: tr(lang, "Fusion Next 执行模型", "Fusion Next executor"),
						children: [/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("svg", {
							width: "13",
							height: "13",
							viewBox: "0 0 18 18",
							fill: "none",
							"aria-hidden": "true",
							children: [
								/* @__PURE__ */ (0, react_jsx_runtime.jsx)("circle", {
									cx: "5.5",
									cy: "5.5",
									r: "3",
									stroke: "currentColor",
									strokeWidth: "1.4"
								}),
								/* @__PURE__ */ (0, react_jsx_runtime.jsx)("circle", {
									cx: "12.5",
									cy: "12.5",
									r: "3",
									stroke: "currentColor",
									strokeWidth: "1.4"
								}),
								/* @__PURE__ */ (0, react_jsx_runtime.jsx)("path", {
									d: "M7.8 7.8 10.2 10.2",
									stroke: "currentColor",
									strokeWidth: "1.4",
									strokeLinecap: "round"
								})
							]
						}), /* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
							className: "fusion-executor-label",
							children: tr(lang, "执行", "Exec")
						})]
					}),
					/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("select", {
						"aria-label": tr(lang, "执行模型；选一个即开启 Fusion Next", "Executor model; picking one enables Fusion Next"),
						value: current,
						disabled: busy,
						"data-active": Boolean(view?.worker),
						style: selectWidth ? { width: selectWidth } : void 0,
						onChange: (event) => choose(event.target.value),
						children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("option", {
							value: "",
							children: offLabel
						}), groups.map((group) => /* @__PURE__ */ (0, react_jsx_runtime.jsx)("optgroup", {
							label: group.name,
							children: group.models.map((model) => /* @__PURE__ */ (0, react_jsx_runtime.jsx)("option", {
								value: `${group.id}/${model.id}`,
								children: model.name
							}, model.id))
						}, group.id))]
					}),
					/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
						ref: sizerRef,
						className: "fusion-executor-sizer",
						"aria-hidden": "true",
						children: selectedLabel
					}),
					current && view?.executorMode && /* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
						className: "fusion-executor-mode",
						title: tr(lang, `执行模型权限：${view.executorMode}`, `Executor mode: ${view.executorMode}`),
						children: MODE_LABEL[view.executorMode] ?? view.executorMode
					}),
					error && /* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
						role: "status",
						title: error,
						children: "⚠"
					})
				]
			});
		}
		//#endregion
		//#region src/client/FusionUsageBadge.tsx
		const fmt = (n) => n >= 1e6 ? `${(n / 1e6).toFixed(1)}M` : n >= 1e3 ? `${(n / 1e3).toFixed(1)}K` : `${n}`;
		const sum = (b) => b.input + b.cacheRead + b.output;
		const pct = (b) => {
			const inp = b.input + b.cacheRead;
			return inp > 0 ? `${Math.round(b.cacheRead / inp * 100)}%` : "—";
		};
		/** Executor-only spend beside the composer model row. Click opens a detail
		* popover (per-role and per-model breakdown) like the host usage meter. */
		function FusionUsageBadge({ sessionId }) {
			const lang = useLang();
			const [usage, setUsage] = (0, react.useState)(null);
			const [open, setOpen] = (0, react.useState)(false);
			const box = (0, react.useRef)(null);
			(0, react.useEffect)(() => {
				let live = true;
				const load = async () => {
					try {
						const res = await fetch(`/api/fusion-next?view=session-usage&sessionId=${encodeURIComponent(sessionId)}`);
						if (!res.ok) return;
						const body = await res.json();
						if (live) setUsage(body);
					} catch {}
				};
				load();
				const timer = setInterval(load, 15e3);
				return () => {
					live = false;
					clearInterval(timer);
				};
			}, [sessionId]);
			(0, react.useEffect)(() => {
				if (!open) return;
				const close = (e) => {
					if (!box.current?.contains(e.target)) setOpen(false);
				};
				document.addEventListener("mousedown", close);
				return () => document.removeEventListener("mousedown", close);
			}, [open]);
			if (!usage?.paired) return null;
			const worker = usage.roles.worker ?? {
				input: 0,
				output: 0,
				cacheRead: 0,
				calls: 0
			};
			const tokens = sum(worker);
			if (!tokens) return null;
			const wPct = pct(worker);
			const lead = usage.roles.lead ?? {
				input: 0,
				output: 0,
				cacheRead: 0,
				calls: 0
			};
			const row = (label, b, role) => /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
				className: "urow",
				"data-role": role,
				children: [
					/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
						className: "uname",
						children: label
					}),
					/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
						className: "unum",
						children: fmt(b.input)
					}),
					/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
						className: "unum",
						children: fmt(b.cacheRead)
					}),
					/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
						className: "unum",
						children: fmt(b.output)
					}),
					/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
						className: "unum",
						children: pct(b)
					}),
					/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
						className: "unum ucall",
						children: b.calls
					})
				]
			}, label + (role ?? ""));
			const modelRows = Object.entries(usage.models ?? {}).sort((a, b) => sum(b[1]) - sum(a[1])).map(([key, b]) => row(key, b, b.role === "worker" ? "worker" : "lead"));
			return /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("span", {
				className: "fusion-usage",
				ref: box,
				children: [
					/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("button", {
						type: "button",
						className: "fusion-usage-btn",
						onClick: () => setOpen((v) => !v),
						"aria-haspopup": "dialog",
						"aria-expanded": open,
						title: tr(lang, "执行模型用量详情", "Executor token detail"),
						children: [
							fmt(tokens),
							" tok",
							wPct === "—" ? "" : ` · ${wPct}`
						]
					}),
					open && /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
						className: "fusion-usage-pop",
						role: "dialog",
						"aria-label": tr(lang, "Fusion 会话用量", "Fusion session usage"),
						children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", {
							className: "uhead",
							children: tr(lang, "本会话 token 用量", "Token usage this session")
						}), /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
							className: "ugrid",
							children: [
								/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
									className: "urow ulabels",
									children: [
										/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {}),
										/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
											className: "unum",
											children: tr(lang, "输入", "in")
										}),
										/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
											className: "unum",
											children: tr(lang, "缓存读", "cache")
										}),
										/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
											className: "unum",
											children: tr(lang, "输出", "out")
										}),
										/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
											className: "unum",
											children: tr(lang, "命中", "hit%")
										}),
										/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
											className: "unum ucall",
											children: tr(lang, "调用", "calls")
										})
									]
								}),
								modelRows,
								/* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", { className: "usep" }),
								row(tr(lang, "规划 lead", "lead"), lead, "lead"),
								row(tr(lang, "执行 worker", "worker"), worker, "worker"),
								row(tr(lang, "合计", "total"), usage.total)
							]
						})]
					}),
					/* @__PURE__ */ (0, react_jsx_runtime.jsx)("style", { children: `.fusion-usage{position:relative;display:inline-flex;align-items:center}
		.fusion-usage-btn{height:28px;padding:0 6px;border:none;background:transparent;cursor:pointer;border-radius:8px;
		  font-size:11px;line-height:1;color:var(--dsh-text-2,rgba(255,255,255,.5));white-space:nowrap;
		  font-variant-numeric:tabular-nums;user-select:none}
		.fusion-usage-btn:hover{background:var(--dsh-hover,rgba(255,255,255,.06));color:var(--dsh-text-1,rgba(255,255,255,.8))}
		.fusion-usage-pop{position:absolute;bottom:34px;right:0;z-index:50;min-width:430px;padding:10px 12px;
		  background:var(--dsh-bg-pop,#1c1e22);border:1px solid var(--dsh-border,rgba(255,255,255,.1));border-radius:10px;
		  box-shadow:0 8px 28px rgba(0,0,0,.45);font-size:11px;color:var(--dsh-text-1,rgba(255,255,255,.85))}
		.fusion-usage-pop .uhead{font-weight:600;font-size:12px;margin-bottom:8px}
		.fusion-usage-pop .ugrid{display:flex;flex-direction:column;gap:2px}
		.fusion-usage-pop .urow{display:grid;grid-template-columns:1fr repeat(5,54px);gap:4px;align-items:baseline}
		.fusion-usage-pop .ulabels{color:var(--dsh-text-2,rgba(255,255,255,.45));font-size:10px}
		.fusion-usage-pop .uname{overflow:hidden;text-overflow:ellipsis;white-space:nowrap;max-width:190px}
		.fusion-usage-pop .urow[data-role] .uname::before{content:'';display:inline-block;width:6px;height:6px;border-radius:50%;margin-right:6px;vertical-align:middle}
		.fusion-usage-pop .urow[data-role='lead'] .uname::before{background:#7aa2f7}
		.fusion-usage-pop .urow[data-role='worker'] .uname::before{background:#9ece6a}
		.fusion-usage-pop .unum{text-align:right;font-variant-numeric:tabular-nums}
		.fusion-usage-pop .usep{height:1px;margin:6px 0 2px;background:var(--dsh-border,rgba(255,255,255,.1))}` })
				]
			});
		}
		//#endregion
		//#region src/activity.ts
		/** Namespaced display identity; the unchanged native identity remains in source. */
		function activityCallId(activity) {
			const event = activity.source;
			const id = event.type === "tool/call" ? event.data.callId : event.data.message.source.callId;
			return `fusion:${activity.childSessionId}:${id}`;
		}
		//#endregion
		//#region src/client/activity-model.ts
		function activityRows(events) {
			const rows = /* @__PURE__ */ new Map();
			for (const event of events) {
				const id = activityCallId(event);
				if (event.source.type === "tool/call") rows.set(id, {
					id,
					call: event.source
				});
				else {
					const row = rows.get(id);
					if (row) rows.set(id, {
						...row,
						result: event.source
					});
				}
			}
			return [...rows.values()];
		}
		/** Only actual result-time metadata is labelled an applied diff. */
		function activityDiffs(row) {
			if (!row.result || row.result.data.message.isError) return [];
			const meta = row.result.data.meta;
			if (!Array.isArray(meta?.diffs)) return [];
			return meta.diffs.filter((hunk) => hunk && typeof hunk === "object" && typeof hunk.path === "string" && (typeof hunk.oldText === "string" || hunk.oldText === null) && typeof hunk.newText === "string");
		}
		//#endregion
		//#region src/client/ActivityRows.tsx
		const labelsFor = (lang) => ({
			codeLabel: tr(lang, "代码", "Code"),
			wrapLabel: tr(lang, "自动换行", "Wrap"),
			unwrapLabel: tr(lang, "取消自动换行", "No wrap"),
			copy: tr(lang, "复制", "Copy"),
			copied: tr(lang, "已复制", "Copied"),
			collapseAria: tr(lang, "收起内容", "Collapse"),
			collapse: tr(lang, "收起", "Collapse"),
			expandAria: (n) => tr(lang, `展开其余 ${n} 行`, `Show ${n} more lines`),
			expand: (n) => tr(lang, `展开其余 ${n} 行`, `Show ${n} more lines`)
		});
		const terminalLabelsFor = (lang) => ({
			...labelsFor(lang),
			commandLine: (n) => tr(lang, `命令行第 ${n} 行`, `command line ${n}`),
			signal: (s) => tr(lang, `信号 ${s}`, `signal ${s}`),
			exitCode: (n) => tr(lang, `退出码 ${n}`, `exit code ${n}`),
			running: tr(lang, "执行中", "Running"),
			failed: tr(lang, "执行失败", "Failed"),
			done: tr(lang, "已返回", "Done"),
			noOutput: tr(lang, "无输出", "No output"),
			noExitCode: tr(lang, "未记录退出码", "No exit code")
		});
		const titleFor = (lang) => ({
			bash: tr(lang, "终端", "Terminal"),
			pwsh: tr(lang, "终端", "Terminal"),
			read: tr(lang, "读取", "Read"),
			write: tr(lang, "写入", "Write"),
			edit: tr(lang, "编辑", "Edit"),
			glob: tr(lang, "查找文件", "Find files"),
			grep: tr(lang, "搜索", "Search"),
			job_output: tr(lang, "命令输出", "Command output"),
			job_kill: tr(lang, "停止命令", "Stop command"),
			str_replace_editor: tr(lang, "编辑", "Edit")
		});
		function ActivityCard({ row, done, cwd, openFile }) {
			const lang = useLang();
			const [open, setOpen] = (0, react.useState)(false);
			let args = {};
			try {
				const parsed = JSON.parse(row.call.data.arguments);
				if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) args = parsed;
			} catch {}
			const result = row.result?.data.message;
			const output = result?.content.flatMap((part) => part.type === "text" ? [part.text] : []).join("\n") ?? "";
			const path = typeof args.file_path === "string" ? args.file_path : typeof args.path === "string" ? args.path : void 0;
			const command = typeof args.command === "string" ? args.command : void 0;
			const exit = /\n\[exit code: (\d+)\]\s*$/.exec(output);
			const failed = result?.isError || exit && Number(exit[1]) !== 0;
			const diffs = activityDiffs(row);
			const label = titleFor(lang)[row.call.data.name] ?? row.call.data.name;
			const summary = path ?? (typeof args.description === "string" ? args.description : command) ?? (typeof args.pattern === "string" ? args.pattern : label);
			const status = failed ? tr(lang, "失败", "Failed") : !row.result ? done ? tr(lang, "结果未记录", "No result recorded") : tr(lang, "执行中", "Running") : "";
			return /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
				className: "fusion-activity-row",
				"data-fusion-tool": row.call.data.name,
				"data-fusion-call": row.id,
				children: [/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("button", {
					type: "button",
					"aria-expanded": open,
					onClick: () => setOpen(!open),
					className: "fusion-activity-toggle",
					children: [
						/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
							"aria-hidden": true,
							children: open ? "⌄" : "›"
						}),
						/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", { children: label }),
						/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
							className: "fusion-activity-summary",
							children: summary
						}),
						status && /* @__PURE__ */ (0, react_jsx_runtime.jsx)("small", {
							role: "status",
							"data-failed": Boolean(failed),
							children: status
						})
					]
				}), open && /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
					className: "fusion-activity-body",
					children: [path && /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("button", {
						type: "button",
						className: "fusion-activity-file",
						onClick: () => openFile(path),
						children: [
							tr(lang, "打开", "Open"),
							" ",
							path
						]
					}), diffs.length ? /* @__PURE__ */ (0, react_jsx_runtime.jsx)(_deepseek_ai_dsh_client_ui_primitives.DiffBlock, {
						diffs,
						labels: labelsFor(lang),
						maxLines: 16
					}) : (row.call.data.name === "bash" || row.call.data.name === "pwsh") && command ? /* @__PURE__ */ (0, react_jsx_runtime.jsx)(_deepseek_ai_dsh_client_ui_primitives.TerminalBlock, {
						command,
						cwd,
						output,
						running: !row.result && !done,
						exitCode: exit ? Number(exit[1]) : void 0,
						labels: terminalLabelsFor(lang)
					}) : /* @__PURE__ */ (0, react_jsx_runtime.jsx)("pre", { children: output || (row.result ? tr(lang, "已返回，无文本输出。", "Returned without text output.") : row.call.data.arguments) })]
				})]
			});
		}
		const activityStyles = `
		.fusion-activity-row{font-size:13px;line-height:1.5;margin:4px 0;min-width:0;color:var(--dsw-alias-label-secondary)}
		.fusion-activity-toggle{display:flex;align-items:center;gap:8px;width:100%;padding:6px 0;background:none;border:0;color:inherit;text-align:left;cursor:pointer;font:inherit}
		.fusion-activity-toggle:focus-visible,.fusion-activity-file:focus-visible{outline:2px solid var(--dsw-alias-brand-primary);outline-offset:2px}
		.fusion-activity-summary{flex:1;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;color:var(--dsw-alias-label-primary)}
		.fusion-activity-toggle small{white-space:nowrap}.fusion-activity-toggle small[data-failed=true]{color:var(--dsw-alias-state-error-primary)}
		.fusion-activity-body{padding:4px 0 10px;overflow:hidden}.fusion-activity-body pre{white-space:pre-wrap;overflow-wrap:anywhere;max-height:360px;overflow:auto;font-size:12px}
		.fusion-activity-file{font:inherit;border:0;background:none;color:var(--dsw-alias-brand-primary);padding:0 0 6px;cursor:pointer}
		`;
		//#endregion
		//#region src/client/FusionTool.tsx
		const fusionControlTools = [
			"fusion_dispatch",
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
		/** Keep internal coordination out of the normal conversation. Errors remain visible. */
		function FusionTool({ block, sessionId, callId, toolName, cwd, openFile }) {
			const lang = useLang();
			const settled = "kind" in block;
			const tracksActivity = toolName === "fusion_dispatch" || toolName === "fusion_next_delegate_text" || toolName === "fusion_next_explore" || toolName === "fusion_next_delegate" || toolName === "fusion_next_rework";
			const [snapshot, setSnapshot] = (0, react.useState)();
			const key = `${sessionId}:${callId}`;
			(0, react.useEffect)(() => {
				if (!tracksActivity) return;
				let active = true, busy = false, cursor = -1, timer;
				const events = /* @__PURE__ */ new Map();
				let abort;
				const visible = () => document.visibilityState !== "hidden";
				const refresh = async () => {
					if (!active || busy || !visible()) return;
					busy = true;
					abort = new AbortController();
					const deadline = setTimeout(() => abort?.abort(), 1e4);
					let again = true, delay = 2e3;
					try {
						const response = await fetch(`/api/fusion-next?view=activity&sessionId=${encodeURIComponent(sessionId)}&callId=${encodeURIComponent(callId)}&after=${cursor}`, {
							credentials: "same-origin",
							cache: "no-store",
							signal: abort.signal
						});
						if (!response.ok) throw new Error("Activity unavailable");
						const page = await response.json();
						if (!Array.isArray(page.events) || !Number.isSafeInteger(page.cursor) || page.cursor < cursor) throw new Error("Invalid activity page");
						for (const event of page.events) if (event.parentCallId === callId) events.set(event.source.seq, event);
						cursor = page.cursor;
						again = page.more || !page.done || !settled;
						delay = page.more ? 0 : 2e3;
						if (active) setSnapshot({
							key,
							events: [...events.values()].sort((a, b) => a.source.seq - b.source.seq),
							done: page.done
						});
					} catch {
						if (active) setSnapshot((previous) => ({
							key,
							events: previous?.key === key ? previous.events : [],
							done: false,
							failed: true
						}));
					} finally {
						clearTimeout(deadline);
						busy = false;
						if (active && again && visible()) timer = setTimeout(() => {
							refresh();
						}, delay);
					}
				};
				const visibility = () => {
					if (timer) clearTimeout(timer);
					if (document.visibilityState === "hidden") abort?.abort();
					else refresh();
				};
				refresh();
				document.addEventListener("visibilitychange", visibility);
				return () => {
					active = false;
					abort?.abort();
					if (timer) clearTimeout(timer);
					document.removeEventListener("visibilitychange", visibility);
				};
			}, [
				sessionId,
				callId,
				key,
				tracksActivity,
				settled
			]);
			const current = tracksActivity && snapshot?.key === key ? snapshot : void 0;
			const rows = (0, react.useMemo)(() => activityRows(current?.events ?? []), [current?.events]);
			const text = settled ? block.content.flatMap((part) => part.type === "text" ? [part.text] : []).join("\n") : "";
			let problem = settled && block.isError ? text : "";
			if (!problem) try {
				const result = JSON.parse(text);
				if (result.status === "needs-decision") problem = result.reason ?? tr(lang, "任务需要进一步处理。", "The task needs attention.");
			} catch {}
			return /* @__PURE__ */ (0, react_jsx_runtime.jsxs)(react_jsx_runtime.Fragment, { children: [
				rows.length > 0 && /* @__PURE__ */ (0, react_jsx_runtime.jsx)("style", { children: activityStyles }),
				rows.map((row) => /* @__PURE__ */ (0, react_jsx_runtime.jsx)(ActivityCard, {
					row,
					done: current?.done ?? false,
					cwd,
					openFile
				}, row.id)),
				current?.failed && /* @__PURE__ */ (0, react_jsx_runtime.jsx)("p", {
					role: "status",
					children: tr(lang, "执行记录暂时无法加载，正在重试。", "Activity is unavailable; retrying.")
				}),
				problem && /* @__PURE__ */ (0, react_jsx_runtime.jsx)("p", {
					role: "status",
					style: {
						fontSize: 13,
						whiteSpace: "pre-wrap"
					},
					children: problem
				})
			] });
		}
		//#endregion
		//#region src/client/status-polling.ts
		const entries = /* @__PURE__ */ new Map();
		const visible = () => document.visibilityState !== "hidden";
		const running = /* @__PURE__ */ new Set([
			"分析",
			"执行",
			"修改",
			"审查",
			"验证",
			"正在停止"
		]);
		function subscribe(sessionId, listener, expanded) {
			let entry = entries.get(sessionId);
			if (!entry) {
				entry = {
					listeners: /* @__PURE__ */ new Map(),
					busy: false,
					visibility: () => {}
				};
				entries.set(sessionId, entry);
				const own = entry;
				const active = () => entries.get(sessionId) === own && own.listeners.size > 0;
				const publish = (snapshot) => {
					if (!active()) return;
					own.snapshot = snapshot;
					for (const notify of own.listeners.keys()) notify();
				};
				const refresh = async () => {
					if (!active() || own.busy || !visible()) return;
					clearTimeout(own.timer);
					own.busy = true;
					const abort = new AbortController();
					own.abort = abort;
					const deadline = setTimeout(() => {
						if (active() && visible()) publish({
							sessionId,
							failed: true
						});
						abort.abort();
					}, 1e4);
					try {
						const response = await fetch(`/api/fusion-next?view=status&sessionId=${encodeURIComponent(sessionId)}`, {
							credentials: "same-origin",
							cache: "no-store",
							signal: abort.signal
						});
						if (!response.ok) throw new Error("unavailable");
						const status = await response.json();
						if (status.schemaVersion !== 1 || status.sessionId !== sessionId) throw new Error("mismatched status");
						if (!abort.signal.aborted) publish({
							sessionId,
							status,
							failed: false
						});
					} catch {
						if (!abort.signal.aborted) publish({
							sessionId,
							failed: true
						});
					} finally {
						clearTimeout(deadline);
						own.busy = false;
						if (active() && visible()) {
							const fast = [...own.listeners.values()].some((value) => value()) && running.has(own.snapshot?.status?.task?.stage ?? "");
							own.timer = setTimeout(() => {
								refresh();
							}, fast ? 2e3 : 15e3);
						}
					}
				};
				own.visibility = () => {
					clearTimeout(own.timer);
					if (!visible()) own.abort?.abort();
					else refresh();
				};
				document.addEventListener("visibilitychange", own.visibility);
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
		/** One in-flight read per mounted session; collapsed hints still discover new attention states. */
		function useFusionStatus(sessionId, expandedTask, attentionOnly = false) {
			const expandedRef = (0, react.useRef)(expandedTask), attentionRef = (0, react.useRef)(attentionOnly);
			expandedRef.current = expandedTask;
			attentionRef.current = attentionOnly;
			(0, react.useEffect)(() => {
				if (expandedTask) entries.get(sessionId)?.visibility();
			}, [sessionId, expandedTask]);
			return (0, react.useSyncExternalStore)((0, react.useCallback)((listener) => subscribe(sessionId, listener, () => {
				const task = entries.get(sessionId)?.snapshot?.status?.task;
				return expandedRef.current !== void 0 && task?.id === expandedRef.current && (!attentionRef.current || task.attention);
			}), [sessionId]), (0, react.useCallback)(() => entries.get(sessionId)?.snapshot, [sessionId]), () => void 0);
		}
		//#endregion
		//#region src/client/FusionStatus.tsx
		const role = (value) => value === "lead" ? "Lead" : "Sidekick";
		const purposeOf = (lang, value) => ({
			conversation: tr(lang, "任务", "task"),
			compaction: tr(lang, "压缩", "compaction"),
			"cache-keepalive": tr(lang, "保活", "keepalive"),
			"session-title": tr(lang, "标题", "title")
		})[value] ?? value;
		const outcomeOf = (lang, value) => ({
			entered: tr(lang, "请求中", "in progress"),
			stop: tr(lang, "已返回", "returned"),
			"tool-calls": tr(lang, "调用工具", "tool calls"),
			"max-tokens": tr(lang, "输出截断", "output truncated"),
			aborted: tr(lang, "已中断", "aborted"),
			error: tr(lang, "请求失败", "failed"),
			unknown: tr(lang, "结束状态未知", "unknown end")
		})[value] ?? value;
		const toolStateOf = (lang, value) => ({
			"dispatch-started": tr(lang, "执行未收尾", "unfinished"),
			returned: tr(lang, "已返回", "returned"),
			"outcome-unknown": tr(lang, "结果未知", "outcome unknown"),
			inspected: tr(lang, "已人工检查", "inspected")
		})[value] ?? value;
		const countOf = (lang, value) => value.totalRequests === 0 ? "—" : value.reportedRequests === 0 ? tr(lang, "未提供", "not reported") : `${value.knownTokens.toLocaleString()}${value.reportedRequests < value.totalRequests ? tr(lang, `（${value.reportedRequests}/${value.totalRequests} 次有报告）`, ` (${value.reportedRequests}/${value.totalRequests} reported)`) : ""}`;
		/** Activity ledger: usage totals, per-role split, context checks, requests, tools. */
		function FusionTaskActivity({ task }) {
			const lang = useLang();
			const purpose = (value) => purposeOf(lang, value), outcome = (value) => outcomeOf(lang, value);
			const toolState = (value) => toolStateOf(lang, value), count = (value) => countOf(lang, value);
			const { usage } = task;
			const share = (role) => {
				const total = usage.byRole.lead.output.knownTokens + usage.byRole.worker.output.knownTokens;
				return total ? tr(lang, ` · 输出占 ${Math.round(usage.byRole[role].output.knownTokens / total * 100)}%`, ` · ${Math.round(usage.byRole[role].output.knownTokens / total * 100)}% of output`) : "";
			};
			return /* @__PURE__ */ (0, react_jsx_runtime.jsxs)(react_jsx_runtime.Fragment, { children: [
				/* @__PURE__ */ (0, react_jsx_runtime.jsx)("h3", { children: tr(lang, "本轮用量", "Usage this task") }),
				/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("dl", { children: [
					/* @__PURE__ */ (0, react_jsx_runtime.jsx)("dt", { children: tr(lang, "模型请求", "Model requests") }),
					/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("dd", { children: [usage.calls, /* @__PURE__ */ (0, react_jsx_runtime.jsx)("small", { children: tr(lang, `含压缩 ${usage.compactionCalls} 次、保活 ${usage.keepaliveCalls} 次`, `incl. ${usage.compactionCalls} compaction, ${usage.keepaliveCalls} keepalive`) })] }),
					/* @__PURE__ */ (0, react_jsx_runtime.jsx)("dt", { children: tr(lang, "用量报告", "Usage reports") }),
					/* @__PURE__ */ (0, react_jsx_runtime.jsx)("dd", { children: tr(lang, `${usage.finalCalls} 次已定稿 · ${usage.provisionalCalls} 次暂报 · ${usage.unreportedCalls} 次未提供`, `${usage.finalCalls} final · ${usage.provisionalCalls} provisional · ${usage.unreportedCalls} unreported`) }),
					/* @__PURE__ */ (0, react_jsx_runtime.jsx)("dt", { children: tr(lang, "输入 Token", "Input tokens") }),
					/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("dd", { children: [count(usage.input), /* @__PURE__ */ (0, react_jsx_runtime.jsx)("small", { children: tr(lang, "已报告的未缓存输入", "reported uncached input") })] }),
					/* @__PURE__ */ (0, react_jsx_runtime.jsx)("dt", { children: tr(lang, "缓存读取", "Cache read") }),
					/* @__PURE__ */ (0, react_jsx_runtime.jsx)("dd", { children: count(usage.cacheRead) }),
					/* @__PURE__ */ (0, react_jsx_runtime.jsx)("dt", { children: tr(lang, "输出 Token", "Output tokens") }),
					/* @__PURE__ */ (0, react_jsx_runtime.jsx)("dd", { children: count(usage.output) }),
					/* @__PURE__ */ (0, react_jsx_runtime.jsx)("dt", { children: tr(lang, "实际费用", "Actual cost") }),
					/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("dd", { children: [tr(lang, "未知", "unknown"), /* @__PURE__ */ (0, react_jsx_runtime.jsx)("small", { children: tr(lang, "当前账号未提供可靠账单金额", "the account reports no reliable billed amount") })] })
				] }),
				/* @__PURE__ */ (0, react_jsx_runtime.jsx)("h3", { children: tr(lang, "按角色", "By role") }),
				/* @__PURE__ */ (0, react_jsx_runtime.jsx)("dl", { children: ["lead", "worker"].map((role) => /* @__PURE__ */ (0, react_jsx_runtime.jsxs)(react.Fragment, { children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("dt", { children: role === "lead" ? "Lead" : "Sidekick" }), /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("dd", { children: [
					tr(lang, `${usage.byRole[role].calls} 次`, `${usage.byRole[role].calls} requests`),
					" · ",
					tr(lang, "输出", "output"),
					" ",
					count(usage.byRole[role].output),
					/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("small", { children: [
						tr(lang, "输入", "input"),
						" ",
						count(usage.byRole[role].input),
						" · ",
						tr(lang, "缓存读取", "cache read"),
						" ",
						count(usage.byRole[role].cacheRead),
						share(role)
					] })
				] })] }, role)) }),
				/* @__PURE__ */ (0, react_jsx_runtime.jsx)("small", { children: tr(lang, "Token 数包含暂报数据；缺失字段不计为 0。请求数来自 DSH，供应商内部重试次数未知。", "Token counts include provisional data; missing fields are not counted as 0. Request counts come from DSH; provider-internal retries are unknown.") }),
				/* @__PURE__ */ (0, react_jsx_runtime.jsx)("h3", { children: tr(lang, "最近上下文检查", "Recent context checks") }),
				task.contexts.length ? /* @__PURE__ */ (0, react_jsx_runtime.jsx)("ul", { children: task.contexts.map((context) => /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("li", { children: [
					role(context.role),
					" · ",
					purpose(context.purpose),
					" · ",
					context.admitted ? tr(lang, "可发送", "admitted") : tr(lang, "超出预算", "over budget"),
					/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("small", { children: [
						context.inputTokens.toLocaleString(),
						" / ",
						context.budget.toLocaleString(),
						" Token · ",
						context.quality === "exact" ? tr(lang, "精确计数", "exact") : tr(lang, "估算", "estimated")
					] })
				] }, context.role)) }) : /* @__PURE__ */ (0, react_jsx_runtime.jsx)("small", { children: tr(lang, "尚无上下文检查记录。", "No context checks yet.") }),
				/* @__PURE__ */ (0, react_jsx_runtime.jsx)("h3", { children: tr(lang, "最近模型请求", "Recent model requests") }),
				task.requests.length ? /* @__PURE__ */ (0, react_jsx_runtime.jsx)("ul", { children: task.requests.map((request) => /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("li", { children: [
					role(request.role),
					" · ",
					purpose(request.purpose),
					" · ",
					outcome(request.outcome),
					/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("small", { children: [
						request.model,
						" · ",
						request.provider,
						" · ",
						request.authority === "final" ? tr(lang, "用量已定稿", "usage final") : request.authority === "provisional" ? tr(lang, "用量暂报", "usage provisional") : tr(lang, "用量未提供", "usage not reported")
					] })
				] }, request.id)) }) : /* @__PURE__ */ (0, react_jsx_runtime.jsx)("small", { children: tr(lang, "尚未发出模型请求。", "No model requests yet.") }),
				/* @__PURE__ */ (0, react_jsx_runtime.jsx)("h3", { children: tr(lang, "最近命令与写入", "Recent commands and writes") }),
				task.tools.length ? /* @__PURE__ */ (0, react_jsx_runtime.jsx)("ul", { children: task.tools.map((tool) => /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("li", { children: [
					role(tool.role),
					" · ",
					tool.name,
					" · ",
					tool.failed ? tr(lang, "返回错误", "error") : toolState(tool.state)
				] }, tool.id)) }) : /* @__PURE__ */ (0, react_jsx_runtime.jsx)("small", { children: tr(lang, "尚无工具执行记录。", "No tool runs yet.") }),
				/* @__PURE__ */ (0, react_jsx_runtime.jsx)("small", { children: tr(lang, "显示最近 12 次请求、8 项命令或写入操作；用量汇总覆盖本轮全部请求。读取操作仍可在会话中查看。", "Shows the last 12 requests and 8 commands or writes; usage totals cover all requests of this task. Reads remain visible in the conversation.") })
			] });
		}
		//#endregion
		//#region src/client/FusionConsole.tsx
		const routeLabel = (route) => route ? `${route.model}` : void 0;
		const styles$1 = `
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
		.fusion-console p{margin:4px 0 12px}.fusion-console h3{font-size:12px;margin:0 0 8px;font-weight:600;color:var(--dsw-alias-label-secondary);letter-spacing:.01em}
		.fusion-console .fusion-card{margin:14px 0;padding:14px 16px;border:1px solid var(--dsw-alias-border-l2);border-radius:12px;background:var(--dsw-alias-bg-layer-1)}
		.fusion-console .fusion-card h3{margin:14px 0 6px}
		.fusion-console .fusion-card>h3:first-child{margin-top:0}
		.fusion-console dl{margin:0;display:grid;grid-template-columns:minmax(72px,auto) minmax(0,1fr);gap:6px 14px}
		.fusion-console dt{color:var(--dsw-alias-label-secondary)}.fusion-console dd{margin:0;min-width:0}
		.fusion-console ul{list-style:none;margin:0;padding:0}.fusion-console li{padding:8px 0;border-bottom:1px solid var(--dsw-alias-border-l2)}
		.fusion-console small{display:block;color:var(--dsw-alias-label-secondary);font-size:12px;margin-top:2px}
		.fusion-console .fusion-stage{display:inline-flex;align-items:center;gap:8px;font-size:13px;font-weight:600;margin:0 0 6px;padding:4px 12px;border-radius:999px;background:var(--dsw-alias-bg-layer-1);border:1px solid var(--dsw-alias-border-l2)}
		.fusion-console .fusion-stage::before{content:'';width:7px;height:7px;border-radius:50%;background:var(--dsw-alias-brand-primary)}
		.fusion-console .fusion-stage[data-attention=true]{color:var(--dsw-alias-state-error-primary);border-color:var(--dsw-alias-state-error-primary)}
		.fusion-console .fusion-stage[data-attention=true]::before{background:var(--dsw-alias-state-error-primary)}
		`;
		/**
		* Per-session console in the conversation View row: pair summary plus the
		* merged task ledger (current task tab + requests/usage tab). The composer
		* executor picker remains the control surface; this view reads.
		*/
		function FusionConsole({ sessionId }) {
			const lang = useLang();
			const [pair, setPair] = (0, react.useState)();
			const [pairFailed, setPairFailed] = (0, react.useState)(false);
			const snapshot = useFusionStatus(sessionId ?? "", void 0);
			(0, react.useEffect)(() => {
				if (!sessionId) {
					setPair(void 0);
					return;
				}
				const abort = new AbortController();
				const load = () => {
					fetch(`/api/fusion-next?view=session-pair&sessionId=${encodeURIComponent(sessionId)}`, {
						credentials: "same-origin",
						cache: "no-store",
						signal: abort.signal
					}).then(async (response) => {
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
			return /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("section", {
				className: "fusion-console",
				"aria-label": tr(lang, "Fusion Next 会话面板", "Fusion Next session console"),
				"data-ud-check": "fusion-console",
				children: [
					/* @__PURE__ */ (0, react_jsx_runtime.jsx)("style", { children: styles$1 }),
					/* @__PURE__ */ (0, react_jsx_runtime.jsx)("h2", { children: "Fusion Next" }),
					pair?.worker ? /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
						className: "fusion-pair",
						children: [
							/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", { children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("b", { children: tr(lang, "规划", "Planner") }), /* @__PURE__ */ (0, react_jsx_runtime.jsx)("small", { children: routeLabel(pair.lead) ?? tr(lang, "跟随会话模型", "follows the session model") })] }),
							/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", { children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("b", { children: tr(lang, "执行", "Executor") }), /* @__PURE__ */ (0, react_jsx_runtime.jsx)("small", { children: routeLabel(pair.worker) })] }),
							/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", { children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("b", { children: tr(lang, "状态", "State") }), /* @__PURE__ */ (0, react_jsx_runtime.jsx)("small", { children: pair.selected ? stage ?? tr(lang, "进行中", "active") : tr(lang, "已配置，发送消息后开始", "paired; starts on the next message") })] })
						]
					}) : /* @__PURE__ */ (0, react_jsx_runtime.jsx)("p", {
						className: "fusion-console-note",
						children: pairFailed ? tr(lang, "暂时无法读取 Fusion 状态，稍后自动重试。", "Fusion status is unavailable right now; it retries automatically.") : tr(lang, "本会话未启用 Fusion Next：在输入框旁的「执行」选择器挑一个执行模型即可开启双模型协作。", "Fusion Next is off in this session: pick an executor beside the model selector to start two-model collaboration.")
					}),
					task && /* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", {
						className: "fusion-card",
						children: /* @__PURE__ */ (0, react_jsx_runtime.jsx)(FusionTaskActivity, { task })
					}),
					pair?.worker && !task && /* @__PURE__ */ (0, react_jsx_runtime.jsx)("p", {
						className: "fusion-console-note",
						role: "status",
						children: tr(lang, "尚无进行中的任务。发送消息后这里会显示任务阶段与用量。", "No task yet. Task stage and usage appear here after you send a message.")
					})
				]
			});
		}
		//#endregion
		//#region src/client/FusionHistory.tsx
		const takeoverReason = (lang, reason) => ({
			"checks-still-failing": tr(lang, "返工后检查仍失败", "checks still failing after rework"),
			"worker-step-limit": tr(lang, "Sidekick 步数用尽", "Sidekick step limit"),
			"worker-stalled": tr(lang, "Sidekick 反复停滞", "Sidekick stalled repeatedly")
		})[reason] ?? reason;
		const tokens$1 = (lang, field, calls) => !calls ? "—" : !field.reported ? tr(lang, "未提供", "not reported") : `${field.known.toLocaleString()}${field.reported < calls ? tr(lang, `（${field.reported}/${calls} 次有报告）`, ` (${field.reported}/${calls} reported)`) : ""}`;
		const purpose = (lang, value) => ({
			conversation: tr(lang, "任务", "task"),
			compaction: tr(lang, "压缩", "compaction"),
			"cache-keepalive": tr(lang, "保活", "keepalive"),
			"session-title": tr(lang, "标题", "title")
		})[value] ?? value;
		function FusionHistory() {
			const lang = useLang();
			const [page, setPage] = (0, react.useState)();
			const [cursor, setCursor] = (0, react.useState)("");
			const [error, setError] = (0, react.useState)("");
			const [refresh, setRefresh] = (0, react.useState)(0);
			const [loading, setLoading] = (0, react.useState)(false);
			(0, react.useEffect)(() => {
				const abort = new AbortController();
				setLoading(true);
				setError("");
				fetch(`/api/fusion-next?view=history&cursor=${encodeURIComponent(cursor)}`, {
					credentials: "same-origin",
					cache: "no-store",
					signal: abort.signal
				}).then(async (response) => {
					if (!response.ok) throw new Error(tr(lang, "历史记录暂时无法读取", "History is unavailable right now"));
					return response.json();
				}).then(setPage).catch((error) => {
					if (!abort.signal.aborted) setError(String(error));
				}).finally(() => {
					if (!abort.signal.aborted) setLoading(false);
				});
				return () => abort.abort();
			}, [
				cursor,
				refresh,
				lang
			]);
			return /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("section", {
				className: "fusion-history",
				"aria-label": tr(lang, "Fusion Next 历史与统计", "Fusion Next history and statistics"),
				"data-ud-check": "fusion-history",
				children: [
					/* @__PURE__ */ (0, react_jsx_runtime.jsx)("h2", { children: tr(lang, "历史与统计", "History and statistics") }),
					/* @__PURE__ */ (0, react_jsx_runtime.jsx)("p", { children: tr(lang, "按实际模型请求汇总，包含任务、压缩、保活及已有标题请求。未报告的用量不算作 0；金额与节省率尚无可靠数据。", "Totals of actual model requests: tasks, compaction, keepalive and title requests. Unreported usage is not counted as 0; no reliable billed amount or saving rate is available.") }),
					/* @__PURE__ */ (0, react_jsx_runtime.jsx)("button", {
						disabled: loading,
						onClick: () => setRefresh((value) => value + 1),
						children: tr(lang, "刷新记录", "Refresh")
					}),
					error && /* @__PURE__ */ (0, react_jsx_runtime.jsx)("p", {
						role: "alert",
						children: error
					}),
					loading && /* @__PURE__ */ (0, react_jsx_runtime.jsx)("p", {
						role: "status",
						children: tr(lang, "正在读取记录…", "Loading…")
					}),
					page && /* @__PURE__ */ (0, react_jsx_runtime.jsxs)(react_jsx_runtime.Fragment, { children: [
						/* @__PURE__ */ (0, react_jsx_runtime.jsx)("p", { children: tr(lang, `${page.totalTasks} 项任务 · ${page.totals.calls} 次原生请求 · ${page.totals.final} 次用量定稿 · ${page.totals.provisional} 次暂报 · ${page.totals.unreported} 次未提供`, `${page.totalTasks} tasks · ${page.totals.calls} native requests · ${page.totals.final} final usage · ${page.totals.provisional} provisional · ${page.totals.unreported} unreported`) }),
						/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("p", { children: [
							tr(lang, "未缓存输入", "Uncached input"),
							" ",
							tokens$1(lang, page.totals.input, page.totals.calls),
							" · ",
							tr(lang, "缓存读取", "cache read"),
							" ",
							tokens$1(lang, page.totals.cacheRead, page.totals.calls),
							" · ",
							tr(lang, "输出", "output"),
							" ",
							tokens$1(lang, page.totals.output, page.totals.calls),
							" Token"
						] }),
						/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("p", { children: [
							tr(lang, `Lead 接手改代码 ${page.takeovers?.total ?? 0} 次（${page.takeovers?.tasks ?? 0} 项任务）`, `Lead takeovers: ${page.takeovers?.total ?? 0} (${page.takeovers?.tasks ?? 0} tasks)`),
							page.takeovers?.total ? `: ${Object.entries(page.takeovers.reasons).map(([reason, count]) => `${takeoverReason(lang, reason)} ${count}`).join(", ")}` : "",
							tr(lang, "。只有 Sidekick 确实完成不了时，程序才会解锁接手。", ". The Host unlocks a takeover only when the Sidekick demonstrably cannot finish.")
						] }),
						/* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", {
							style: { overflowX: "auto" },
							tabIndex: 0,
							"aria-label": tr(lang, "按实际模型统计", "By actual model"),
							children: /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("table", { children: [
								/* @__PURE__ */ (0, react_jsx_runtime.jsx)("caption", { children: tr(lang, "按角色、实际模型和请求用途", "By role, actual model and purpose") }),
								/* @__PURE__ */ (0, react_jsx_runtime.jsx)("thead", { children: /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("tr", { children: [
									/* @__PURE__ */ (0, react_jsx_runtime.jsx)("th", {
										scope: "col",
										children: tr(lang, "角色 / 模型", "Role / model")
									}),
									/* @__PURE__ */ (0, react_jsx_runtime.jsx)("th", {
										scope: "col",
										children: tr(lang, "用途", "Purpose")
									}),
									/* @__PURE__ */ (0, react_jsx_runtime.jsx)("th", {
										scope: "col",
										children: tr(lang, "请求", "Requests")
									}),
									/* @__PURE__ */ (0, react_jsx_runtime.jsx)("th", {
										scope: "col",
										children: tr(lang, "输出 Token", "Output tokens")
									})
								] }) }),
								/* @__PURE__ */ (0, react_jsx_runtime.jsx)("tbody", { children: page.groups.map((group) => /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("tr", { children: [
									/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("th", {
										scope: "row",
										children: [
											group.role === "lead" ? "Lead" : "Sidekick",
											" · ",
											group.model,
											/* @__PURE__ */ (0, react_jsx_runtime.jsx)("small", { children: group.provider })
										]
									}),
									/* @__PURE__ */ (0, react_jsx_runtime.jsx)("td", { children: purpose(lang, group.purpose) }),
									/* @__PURE__ */ (0, react_jsx_runtime.jsx)("td", { children: group.calls }),
									/* @__PURE__ */ (0, react_jsx_runtime.jsx)("td", { children: tokens$1(lang, group.output, group.calls) })
								] }, JSON.stringify([
									group.role,
									group.provider,
									group.model,
									group.purpose
								]))) })
							] })
						}),
						/* @__PURE__ */ (0, react_jsx_runtime.jsx)("h3", { children: tr(lang, "任务记录", "Tasks") }),
						!page.tasks.length && /* @__PURE__ */ (0, react_jsx_runtime.jsx)("p", { children: tr(lang, "还没有 Fusion 任务。", "No Fusion tasks yet.") }),
						/* @__PURE__ */ (0, react_jsx_runtime.jsx)("ol", { children: page.tasks.map((task) => /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("li", { children: [
							/* @__PURE__ */ (0, react_jsx_runtime.jsx)("strong", { children: task.title }),
							/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("small", { children: [
								new Date(task.createdAt).toLocaleString(),
								" · ",
								task.mode === "completed" ? tr(lang, "已结束", "finished") : task.phase,
								" · ",
								tr(lang, `${task.usage.calls} 次请求`, `${task.usage.calls} requests`),
								task.takeovers ? tr(lang, ` · Lead 接手 ${task.takeovers} 次`, ` · ${task.takeovers} Lead takeovers`) : ""
							] }),
							/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("details", { children: [
								/* @__PURE__ */ (0, react_jsx_runtime.jsx)("summary", { children: tr(lang, "记录详情", "Details") }),
								/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("p", { children: [
									tr(lang, "任务", "Task"),
									": ",
									task.id
								] }),
								/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("p", { children: [
									tr(lang, "会话", "Session"),
									": ",
									task.sessionId
								] }),
								/* @__PURE__ */ (0, react_jsx_runtime.jsx)("p", { children: tr(lang, `验证状态：${task.verification}。历史运行状态不代表当前仍在执行。`, `Verification: ${task.verification}. A recorded state does not mean it is still running.`) }),
								/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("p", { children: [
									tr(lang, "输入", "Input"),
									" ",
									tokens$1(lang, task.usage.input, task.usage.calls),
									" · ",
									tr(lang, "缓存读取", "cache read"),
									" ",
									tokens$1(lang, task.usage.cacheRead, task.usage.calls),
									" · ",
									tr(lang, "输出", "output"),
									" ",
									tokens$1(lang, task.usage.output, task.usage.calls),
									" Token"
								] })
							] })
						] }, task.id)) }),
						/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
							className: "fusion-actions",
							children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("button", {
								disabled: loading || !cursor,
								onClick: () => setCursor(""),
								children: tr(lang, "最新记录", "Newest")
							}), /* @__PURE__ */ (0, react_jsx_runtime.jsx)("button", {
								disabled: loading || !page.nextCursor,
								onClick: () => setCursor(page.nextCursor),
								children: tr(lang, "更早记录", "Older")
							})]
						}),
						/* @__PURE__ */ (0, react_jsx_runtime.jsx)("p", { children: tr(lang, `更新于 ${new Date(page.observedAt).toLocaleString()}。供应商内部重试次数未知。`, `Updated ${new Date(page.observedAt).toLocaleString()}. Provider-internal retries are unknown.`) })
					] })
				]
			});
		}
		//#endregion
		//#region src/client/FusionCache.tsx
		const tokens = (value) => value >= 1e6 ? `${(value / 1e6).toFixed(1)}M` : value >= 1e3 ? `${Math.round(value / 1e3)}k` : String(value);
		const minutes = (seconds) => seconds % 60 ? `${(seconds / 60).toFixed(1)} min` : `${seconds / 60} min`;
		const modeName = (lang, mode) => ({
			auto: tr(lang, "自动", "Auto"),
			on: tr(lang, "开启", "On"),
			off: tr(lang, "关闭", "Off")
		})[mode];
		function modeSource(lang, row) {
			switch (row.modeSource) {
				case "user": return tr(lang, "你的设置", "your setting");
				case "pair": return tr(lang, "旧版组合设置", "older pair setting");
				case "role": return tr(lang, "Sidekick 默认关闭（它很少长时间等待）", "Sidekick default off (it rarely waits long)");
				case "route": return `${row.defaults.route.label}: ${lang === "zh" ? row.defaults.route.reason.zh : row.defaults.route.reason.en}`;
				case "family": return tr(lang, `${row.defaults.family.label} 官方默认`, `${row.defaults.family.label} documented default`);
				default: return tr(lang, "通用默认", "generic default");
			}
		}
		function intervalSource(lang, row) {
			if (row.intervalSource === "user") return tr(lang, "你的设置", "your setting");
			if (row.intervalSource === "learned") return tr(lang, "自动学习：保活多次未命中，已缩短", "learned: pings kept missing, shortened");
			return tr(lang, "默认", "default");
		}
		function ModelCard({ row, onSaved }) {
			const lang = useLang();
			const [interval, setInterval] = (0, react.useState)(String(row.setting.intervalSeconds ? row.setting.intervalSeconds / 60 : ""));
			const [busy, setBusy] = (0, react.useState)(false), [error, setError] = (0, react.useState)();
			const save = async (body) => {
				setBusy(true);
				setError(void 0);
				try {
					const response = await fetch("/api/fusion-next", {
						method: "POST",
						credentials: "same-origin",
						headers: { "content-type": "application/json" },
						body: JSON.stringify({
							action: "cache-setting",
							provider: row.provider,
							model: row.model,
							...body
						})
					});
					const result = await response.json();
					if (!response.ok) throw new Error(result.error ?? tr(lang, "保存失败", "Save failed"));
					onSaved();
				} catch (reason) {
					setError(reason instanceof Error ? reason.message : String(reason));
				} finally {
					setBusy(false);
				}
			};
			const t = row.totals;
			const family = row.defaults.family;
			return /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
				className: "fusion-cache-model",
				children: [
					/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("strong", { children: [row.model, /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("small", { children: [row.provider, row.role ? ` · ${row.role === "lead" ? "Lead" : "Sidekick"}` : ""] })] }),
					/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("p", { children: [
						tr(lang, "现在", "Now"),
						": ",
						/* @__PURE__ */ (0, react_jsx_runtime.jsx)("b", { children: modeName(lang, row.mode) }),
						row.mode !== "off" && /* @__PURE__ */ (0, react_jsx_runtime.jsxs)(react_jsx_runtime.Fragment, { children: [
							tr(lang, "，每 ", ", every "),
							/* @__PURE__ */ (0, react_jsx_runtime.jsx)("b", { children: minutes(row.intervalSeconds) }),
							tr(lang, " 续一次", "")
						] }),
						/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("small", { children: [
							tr(lang, "开关来源", "Mode"),
							": ",
							modeSource(lang, row),
							" · ",
							tr(lang, "间隔来源", "Interval"),
							": ",
							intervalSource(lang, row)
						] })
					] }),
					family && /* @__PURE__ */ (0, react_jsx_runtime.jsx)("p", { children: /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("small", { children: [
						tr(lang, "官方文档", "Documented"),
						": ",
						lang === "zh" ? family.lifetime.zh : family.lifetime.en,
						"；",
						tr(lang, "缓存价约为全价", "cached price ≈"),
						" ",
						family.discount,
						" · ",
						/* @__PURE__ */ (0, react_jsx_runtime.jsx)("a", {
							href: family.docs,
							target: "_blank",
							rel: "noreferrer",
							children: tr(lang, "来源", "source")
						})
					] }) }),
					/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
						className: "fusion-cache-controls",
						children: [
							/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("label", { children: [tr(lang, "保活", "Keepalive"), /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("select", {
								"aria-label": `${row.model} keepalive`,
								disabled: busy,
								value: row.setting.mode ?? "",
								onChange: (event) => {
									save({
										mode: event.target.value || null,
										intervalSeconds: row.setting.intervalSeconds ?? null
									});
								},
								children: [
									/* @__PURE__ */ (0, react_jsx_runtime.jsx)("option", {
										value: "",
										children: tr(lang, `默认（${modeName(lang, row.defaults.mode)}）`, `Default (${modeName(lang, row.defaults.mode)})`)
									}),
									/* @__PURE__ */ (0, react_jsx_runtime.jsx)("option", {
										value: "auto",
										children: tr(lang, "自动：该模型返回过缓存命中后才开启", "Auto: only after this model reports cache hits")
									}),
									/* @__PURE__ */ (0, react_jsx_runtime.jsx)("option", {
										value: "on",
										children: tr(lang, "开启", "On")
									}),
									/* @__PURE__ */ (0, react_jsx_runtime.jsx)("option", {
										value: "off",
										children: tr(lang, "关闭（按请求次数计费的套餐选这个）", "Off (choose for plans billed per request)")
									})
								]
							})] }),
							/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("label", { children: [tr(lang, "间隔（分钟）", "Interval (min)"), /* @__PURE__ */ (0, react_jsx_runtime.jsx)("input", {
								type: "number",
								min: "1",
								max: "59",
								step: "0.5",
								disabled: busy,
								value: interval,
								placeholder: String(+(row.intervalSeconds / 60).toFixed(2)),
								onChange: (event) => setInterval(event.target.value),
								onBlur: () => {
									if (interval !== String(row.setting.intervalSeconds ? row.setting.intervalSeconds / 60 : "")) save({
										mode: row.setting.mode ?? null,
										intervalSeconds: interval ? Math.round(Number(interval) * 60) : null
									});
								}
							})] }),
							/* @__PURE__ */ (0, react_jsx_runtime.jsx)("button", {
								type: "button",
								disabled: busy || !row.setting.mode && !row.setting.intervalSeconds,
								onClick: () => {
									setInterval("");
									save({ reset: true });
								},
								children: tr(lang, "恢复默认", "Reset")
							})
						]
					}),
					row.suggestion && /* @__PURE__ */ (0, react_jsx_runtime.jsx)("p", {
						role: "status",
						children: tr(lang, `观察到等待 ${minutes(row.suggestion)} 以上缓存仍然命中，可以把间隔放宽到 ${minutes(row.suggestion)}（不会自动修改）。`, `Cache still hit after waits over ${minutes(row.suggestion)}; you can lengthen the interval to ${minutes(row.suggestion)} (not changed automatically).`)
					}),
					t ? /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("p", { children: [
						tr(lang, "效果", "Effect"),
						": ",
						tr(lang, `等待后命中 ${t.waitHits}/${t.waits} 次`, `hit after ${t.waitHits}/${t.waits} waits`),
						t.waits ? ` (${Math.round(100 * t.waitHits / t.waits)}%)` : "",
						"；",
						tr(lang, ` 保活 ${t.pings} 次（${t.pingHits} 次命中，读取 ${tokens(t.pingTokens)} token，多为缓存价${t.pingOutputTokens != null ? `，输出 ${tokens(t.pingOutputTokens)} token` : ""}）；`, ` ${t.pings} pings (${t.pingHits} hit, ${tokens(t.pingTokens)} tokens read, mostly at cache price${t.pingOutputTokens != null ? `, ${tokens(t.pingOutputTokens)} output` : ""}); `),
						tr(lang, ` 等待后仍从缓存读取 ${tokens(t.keptWarmTokens)} token，按全价重发 ${tokens(t.resentTokens)} token。`, ` after waits ${tokens(t.keptWarmTokens)} tokens served from cache, ${tokens(t.resentTokens)} resent at full price.`),
						t.pings >= 5 && t.pingHits / t.pings < .5 && /* @__PURE__ */ (0, react_jsx_runtime.jsx)("b", { children: tr(lang, " 保活大多没命中，建议关闭或缩短间隔。", " Most pings missed: turn it off or shorten the interval.") })
					] }) : /* @__PURE__ */ (0, react_jsx_runtime.jsx)("p", { children: tr(lang, "还没有数据：Lead 等待 Sidekick 之后才会产生记录。", "No data yet: records appear after the Lead waits for the Sidekick.") }),
					!!row.recent.length && /* @__PURE__ */ (0, react_jsx_runtime.jsx)("p", { children: /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("small", { children: [
						tr(lang, "最近", "Recent"),
						": ",
						row.recent.map((item, i) => /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("span", { children: [
							item.ping ? "↻" : "",
							minutes(item.gapSeconds),
							item.hit ? " ✓" : " ✗",
							i < row.recent.length - 1 ? " · " : ""
						] }, i))
					] }) }),
					error && /* @__PURE__ */ (0, react_jsx_runtime.jsx)("p", {
						role: "alert",
						children: error
					})
				]
			});
		}
		/** Per-model cache keepalive: what applies and why, the documented default, and what was observed. */
		function FusionCache({ refresh }) {
			const lang = useLang();
			const [rows, setRows] = (0, react.useState)(), [checked, setChecked] = (0, react.useState)(), [error, setError] = (0, react.useState)();
			const [reload, setReload] = (0, react.useState)(0);
			(0, react.useEffect)(() => {
				const abort = new AbortController();
				fetch("/api/fusion-next?view=cache", {
					credentials: "same-origin",
					cache: "no-store",
					signal: abort.signal
				}).then(async (response) => {
					if (!response.ok) throw new Error(tr(lang, "无法读取缓存设置", "Cannot read cache settings"));
					return response.json();
				}).then((value) => {
					setRows(value.models);
					setChecked(value.checked);
				}).catch((reason) => {
					if (!abort.signal.aborted) setError(String(reason));
				});
				return () => abort.abort();
			}, [
				refresh,
				reload,
				lang
			]);
			return /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("section", {
				className: "fusion-cache",
				"aria-label": tr(lang, "缓存保活", "Cache keepalive"),
				children: [
					/* @__PURE__ */ (0, react_jsx_runtime.jsx)("h3", { children: tr(lang, "缓存保活", "Cache keepalive") }),
					/* @__PURE__ */ (0, react_jsx_runtime.jsx)("p", { children: tr(lang, "Lead 等 Sidekick 干活时可能要等几分钟，模型的输入缓存过期后，下一次请求会按全价重读整段对话。保活在等待期间定时把 Lead 上一次的请求原样再发一遍，末尾只加一句“Reply OK”，模型只回一个 OK，缓存就不会过期。默认值来自各家官方文档，每个模型都可以单独调整。", "While the Lead waits for the Sidekick, the model's prompt cache can expire and the next request re-reads the whole conversation at full price. Keepalive resends the Lead's previous request at intervals with only “Reply OK” appended; the model answers OK and the cache stays warm. Defaults come from each provider's documentation; every model can be adjusted.") }),
					checked && /* @__PURE__ */ (0, react_jsx_runtime.jsx)("p", { children: /* @__PURE__ */ (0, react_jsx_runtime.jsx)("small", { children: tr(lang, `官方默认值核对日期：${checked}。`, `Documented defaults checked on ${checked}.`) }) }),
					error && /* @__PURE__ */ (0, react_jsx_runtime.jsx)("p", {
						role: "alert",
						children: error
					}),
					rows?.map((row) => /* @__PURE__ */ (0, react_jsx_runtime.jsx)(ModelCard, {
						row,
						onSaved: () => setReload((value) => value + 1)
					}, `${row.provider}/${row.model}/${row.setting.mode ?? ""}/${row.setting.intervalSeconds ?? ""}`))
				]
			});
		}
		//#endregion
		//#region src/client/FusionPanel.tsx
		const styles = `
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
		.fusion-panel .fusion-stale-note{color:var(--dsw-alias-label-secondary);font-size:12px;margin-top:14px}
		.fusion-panel .fusion-formations{display:grid;gap:12px}
		.fusion-panel .fusion-formation{display:grid;grid-template-columns:minmax(140px,1.4fr) repeat(4,minmax(110px,1fr));gap:0;border:1px solid var(--dsw-alias-border-l2);border-radius:12px;background:var(--dsw-alias-bg-layer-1);overflow:hidden}
		.fusion-panel .fusion-formation>div{padding:10px 16px;min-width:0}
		.fusion-panel .fusion-formation>div+div{border-left:1px solid var(--dsw-alias-border-l2)}
		.fusion-panel .fusion-formation b{font-weight:600;font-size:12px;color:var(--dsw-alias-label-secondary)}
		.fusion-panel .fusion-formation small{display:block;font-size:13px;color:var(--dsw-alias-label-primary);margin-top:3px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
		.fusion-panel .fusion-formation small.fusion-formation-sub,.fusion-panel .fusion-formation small.fusion-formation-id{color:var(--dsw-alias-label-secondary);font-size:11px}
		.fusion-panel .fusion-formation[data-attention=true]{border-color:var(--dsw-alias-state-error-primary)}
		.fusion-panel .fusion-formation[data-attention=true]>div:nth-child(4) small{color:var(--dsw-alias-state-error-primary)}
		@media(max-width:720px){.fusion-panel .fusion-formation{grid-template-columns:repeat(2,minmax(0,1fr))}.fusion-panel .fusion-formation>div+div{border-left:0;border-top:1px solid var(--dsw-alias-border-l2)}.fusion-panel .fusion-formation>div:nth-child(-n+2){border-top:0}}
		.fusion-panel .fusion-running{display:flex;flex-wrap:wrap;gap:8px;margin:0 0 20px}
		.fusion-panel .fusion-chip{display:inline-flex;align-items:center;gap:8px;padding:6px 12px;border:1px solid var(--dsw-alias-border-l2);border-radius:999px;background:var(--dsw-alias-bg-layer-1);font-size:12px;line-height:1.3}
		.fusion-panel .fusion-chip b{font-weight:600;max-width:220px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
		.fusion-panel .fusion-chip[data-attention=true]{border-color:var(--dsw-alias-state-error-primary);color:var(--dsw-alias-state-error-primary)}
		.fusion-panel .fusion-chip .fusion-dot{width:7px;height:7px;border-radius:50%;background:var(--dsw-alias-brand-primary);flex:none}
		.fusion-panel .fusion-chip[data-stage=完成] .fusion-dot{background:var(--dsw-alias-state-success-primary,#3a5)}
		.fusion-panel .fusion-chip[data-stage=待命] .fusion-dot{background:var(--dsw-alias-label-secondary);opacity:.5}
		.fusion-panel .fusion-tabs{display:flex;gap:2px;margin:0 0 20px;border-bottom:1px solid var(--dsw-alias-border-l2)}
		.fusion-panel .fusion-tabs button{font:inherit;font-size:13px;color:var(--dsw-alias-label-secondary);background:none;border:0;border-bottom:2px solid transparent;padding:7px 14px;cursor:pointer;border-radius:0;transition:color .12s}
		.fusion-panel .fusion-tabs button:hover{color:var(--dsw-alias-label-primary)}
		.fusion-panel .fusion-tabs button[aria-selected=true]{color:var(--dsw-alias-label-primary);border-bottom-color:var(--dsw-alias-brand-primary);font-weight:600}
		`;
		const FINISHED = /* @__PURE__ */ new Set(["完成"]);
		/** Last-activity timestamps inside a task view; a task idle this long is stale, not running. */
		const STALE_MS = 864e5;
		const lastActivity = (task) => {
			if (!task) return 0;
			const stamps = [
				task.requests?.at(-1)?.startedAt,
				task.contexts?.at(-1)?.checkedAt,
				task.tools?.at(-1)?.startedAt
			].map((stamp) => stamp ? Date.parse(stamp) : 0).filter((stamp) => Number.isFinite(stamp));
			return stamps.length ? Math.max(...stamps) : 0;
		};
		const stageOf = (lang, task) => task ? lang === "en" ? task.stageEn ?? task.stage : task.stage : tr(lang, "待命", "idle");
		/** Sidebar rail glyph: two linked nodes, the planner-executor pair. */
		function FusionNextIcon() {
			return /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("svg", {
				width: "18",
				height: "18",
				viewBox: "0 0 18 18",
				fill: "none",
				"aria-hidden": "true",
				children: [
					/* @__PURE__ */ (0, react_jsx_runtime.jsx)("circle", {
						cx: "5.5",
						cy: "5.5",
						r: "3",
						stroke: "currentColor",
						strokeWidth: "1.4"
					}),
					/* @__PURE__ */ (0, react_jsx_runtime.jsx)("circle", {
						cx: "12.5",
						cy: "12.5",
						r: "3",
						stroke: "currentColor",
						strokeWidth: "1.4"
					}),
					/* @__PURE__ */ (0, react_jsx_runtime.jsx)("path", {
						d: "M7.8 7.8 10.2 10.2",
						stroke: "currentColor",
						strokeWidth: "1.4",
						strokeLinecap: "round"
					})
				]
			});
		}
		/**
		* Global console behind the sidebar icon. A persistent strip lists every
		* session running a fusion pair (session label + stage); tabs below cover the
		* live session table, run history, and the cache-keepalive ledger.
		*/
		function FusionPanel() {
			const lang = useLang();
			const [tab, setTab] = (0, react.useState)("running");
			const [sessions, setSessions] = (0, react.useState)([]);
			const [loaded, setLoaded] = (0, react.useState)(false);
			(0, react.useEffect)(() => {
				const abort = new AbortController();
				const load = () => {
					fetch("/api/fusion-next?view=running", {
						credentials: "same-origin",
						cache: "no-store",
						signal: abort.signal
					}).then(async (response) => {
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
			const cutoff = Date.now() - STALE_MS;
			const fresh = sessions.filter((session) => session.task && !FINISHED.has(session.task.stage) && lastActivity(session.task) >= cutoff);
			const staleCount = sessions.filter((session) => session.task && !FINISHED.has(session.task.stage) && lastActivity(session.task) < cutoff).length;
			const running = fresh.slice().sort((a, b) => lastActivity(b.task) - lastActivity(a.task));
			const labelOf = (session) => session.title ?? session.sessionId.replace(/^session-/, "").split("-")[0];
			return /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("main", {
				className: "fusion-panel",
				"aria-label": tr(lang, "Fusion Next 控制台", "Fusion Next console"),
				"data-ud-check": "fusion-panel",
				children: [
					/* @__PURE__ */ (0, react_jsx_runtime.jsx)("style", { children: styles }),
					/* @__PURE__ */ (0, react_jsx_runtime.jsx)("h1", { children: "Fusion Next" }),
					/* @__PURE__ */ (0, react_jsx_runtime.jsx)("p", { children: tr(lang, "每个会话一支「规划 + 执行」双人组：规划负责拆解、审查与接管，执行负责实际改动。这里汇总所有会话的运行记录与用量。", "Each session runs a planner–executor pair: the planner decomposes, reviews and takes over; the executor makes the changes. This page aggregates runs and usage across sessions.") }),
					/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
						className: "fusion-tabs",
						role: "tablist",
						children: [
							/* @__PURE__ */ (0, react_jsx_runtime.jsx)("button", {
								role: "tab",
								"aria-selected": tab === "running",
								onClick: () => setTab("running"),
								children: tr(lang, `运行中${running.length ? `（${running.length}）` : ""}`, `Running${running.length ? ` (${running.length})` : ""}`)
							}),
							/* @__PURE__ */ (0, react_jsx_runtime.jsx)("button", {
								role: "tab",
								"aria-selected": tab === "history",
								onClick: () => setTab("history"),
								children: tr(lang, "历史与统计", "History & stats")
							}),
							/* @__PURE__ */ (0, react_jsx_runtime.jsx)("button", {
								role: "tab",
								"aria-selected": tab === "cache",
								onClick: () => setTab("cache"),
								children: tr(lang, "缓存保活", "Cache keepalive")
							})
						]
					}),
					tab === "running" && /* @__PURE__ */ (0, react_jsx_runtime.jsxs)(react_jsx_runtime.Fragment, { children: [
						running.length === 0 && /* @__PURE__ */ (0, react_jsx_runtime.jsx)("p", {
							className: "fusion-empty",
							children: loaded ? tr(lang, "当前没有运行中的 Fusion 任务。在某个会话输入框旁的「执行」选择器挑一个执行模型即可开始。", "No fusion tasks are running. Pick an executor beside a session's model selector to start one.") : tr(lang, "正在读取…", "Loading…")
						}),
						running.length > 0 && /* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", {
							className: "fusion-formations",
							children: running.map((session) => /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
								className: "fusion-formation",
								"data-attention": session.task?.attention ?? false,
								children: [
									/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", { children: [
										/* @__PURE__ */ (0, react_jsx_runtime.jsx)("b", { children: tr(lang, "会话", "Session") }),
										/* @__PURE__ */ (0, react_jsx_runtime.jsx)("small", { children: labelOf(session) }),
										/* @__PURE__ */ (0, react_jsx_runtime.jsx)("small", {
											className: "fusion-formation-id",
											children: session.sessionId
										})
									] }),
									/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", { children: [
										/* @__PURE__ */ (0, react_jsx_runtime.jsx)("b", { children: tr(lang, "规划", "Planner") }),
										/* @__PURE__ */ (0, react_jsx_runtime.jsx)("small", { children: session.lead.model }),
										/* @__PURE__ */ (0, react_jsx_runtime.jsx)("small", {
											className: "fusion-formation-sub",
											children: session.lead.provider
										})
									] }),
									/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", { children: [
										/* @__PURE__ */ (0, react_jsx_runtime.jsx)("b", { children: tr(lang, "执行", "Executor") }),
										/* @__PURE__ */ (0, react_jsx_runtime.jsx)("small", { children: session.worker.model }),
										/* @__PURE__ */ (0, react_jsx_runtime.jsx)("small", {
											className: "fusion-formation-sub",
											children: session.worker.provider
										})
									] }),
									/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", { children: [
										/* @__PURE__ */ (0, react_jsx_runtime.jsx)("b", { children: tr(lang, "当前任务", "Current task") }),
										/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("small", { children: [session.task?.attention ? "⚠ " : "", stageOf(lang, session.task)] }),
										/* @__PURE__ */ (0, react_jsx_runtime.jsx)("small", {
											className: "fusion-formation-sub",
											children: lang === "en" && session.task?.detailEn !== void 0 ? session.task.detailEn : session.task?.detail ?? ""
										})
									] }),
									/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", { children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("b", { children: tr(lang, "请求", "Requests") }), /* @__PURE__ */ (0, react_jsx_runtime.jsx)("small", { children: session.task?.usage?.calls ?? "—" })] })
								]
							}, session.sessionId))
						}),
						staleCount > 0 && /* @__PURE__ */ (0, react_jsx_runtime.jsx)("p", {
							className: "fusion-stale-note",
							children: tr(lang, `另有 ${staleCount} 个会话带着超过一天没动的任务 —— 多半是已中断的旧任务，不计入运行中。`, `${staleCount} more session(s) hold tasks idle for over a day — likely interrupted old tasks, not counted as running.`)
						})
					] }),
					tab === "history" && /* @__PURE__ */ (0, react_jsx_runtime.jsx)(FusionHistory, {}),
					tab === "cache" && /* @__PURE__ */ (0, react_jsx_runtime.jsx)(FusionCache, { refresh: 0 })
				]
			});
		}
		//#endregion
		//#region src/client/index.ts
		const name = "fusion-next/client";
		const inject = ["slots"];
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
					return {
						sessionId,
						directory: directory.store,
						load: () => {
							directory.load().catch(() => void 0);
						}
					};
				};
				scope.slots.inject("conversation.input.right", () => scope.slots.register({
					name: "conversation.input.right",
					id: "fusion-next-executor",
					order: 5,
					inject: directoryInject
				}, FusionPairPicker));
				scope.slots.inject("conversation.input.right", () => scope.slots.register({
					name: "conversation.input.right",
					id: "fusion-next-usage",
					order: 6,
					inject: directoryInject
				}, FusionUsageBadge));
				scope.slots.inject("conversation.input.dock", () => scope.slots.register({
					name: "conversation.input.dock",
					id: "fusion-next-configuration",
					order: 20,
					inject: directoryInject
				}, FusionHint));
			});
		}
		//#endregion
		exports.apply = apply;
		exports.inject = inject;
		exports.name = name;

		return module.exports;
	}
});

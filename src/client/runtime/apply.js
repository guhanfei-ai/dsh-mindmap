// Generated source fragment. Edit this file, then run npm run build:client.
		/**
		 * settings describe 应答的双代信封解析（023）：dsh ≤0.1.1 的远端把
		 * 描述符聚合在 result.value.namespaces[]；0.1.2-rc.1 起直接返回描述符
		 * 数组（每项 {ns, schema, value, …}，字段两代同名）。数组优先、
		 * namespaces 兜底，两代通吃。
		 */
		function settingsNamespacesOf(res) {
			// connection 旧代理包一层 result.value；新版远端直接返回描述符数组。
			const value = res?.ok === true
				? res.value
				: Array.isArray(res) || Array.isArray(res?.value)
				? (Array.isArray(res) ? res : res.value)
				: res?.result?.value;
			if (Array.isArray(value)) return value;
			const list = value?.namespaces;
			return Array.isArray(list) ? list : [];
		}

		function apply(ctx) {
			const face = {};

			// 026 生长动画 CSS：无论 standalone 还是 sidebar 模式都需要（节点渐显
			// 与布局无关）。纳入 ctx.effect 清理——HMR / 插件禁用后 <head> 不残留。
			if (typeof ctx.effect === "function") {
				ctx.effect(() => {
					if (typeof document === "undefined") return;
					const animStyle = document.createElement("style");
					animStyle.setAttribute("data-dsh-mindmap", "growth-anim");
					animStyle.textContent = [
						"@keyframes dsh-mm-node-in{from{opacity:0;transform:translateX(-10px)}to{opacity:1;transform:none}}",
						".dsh-mm-reveal{opacity:0;animation:dsh-mm-node-in 320ms ease-out both}",
						"@keyframes dsh-mm-fade-in{from{opacity:0}to{opacity:1}}",
						".dsh-mm-edge-reveal{opacity:0;animation:dsh-mm-fade-in 320ms ease-out both}",
						"@media (prefers-reduced-motion: reduce){.dsh-mm-reveal,.dsh-mm-edge-reveal{animation:none;opacity:1}}",
					].join("");
					document.head.appendChild(animStyle);
					return () => { animStyle.remove(); };
				});
			} else if (typeof document !== "undefined") {
				// ctx.effect 不可用（旧运行时 / 测试桩）：直接注入，无清理。
				const animStyle = document.createElement("style");
				animStyle.setAttribute("data-dsh-mindmap", "growth-anim");
				animStyle.textContent = [
					"@keyframes dsh-mm-node-in{from{opacity:0;transform:translateX(-10px)}to{opacity:1;transform:none}}",
					".dsh-mm-reveal{opacity:0;animation:dsh-mm-node-in 320ms ease-out both}",
					"@keyframes dsh-mm-fade-in{from{opacity:0}to{opacity:1}}",
					".dsh-mm-edge-reveal{opacity:0;animation:dsh-mm-fade-in 320ms ease-out both}",
					"@media (prefers-reduced-motion: reduce){.dsh-mm-reveal,.dsh-mm-edge-reveal{animation:none;opacity:1}}",
				].join("");
				document.head.appendChild(animStyle);
			}

		// 026+028+029 betterSidebar 生命周期统一收口：三种状态（启动时已存在、
		// 运行中后到达、不存在/已卸载）都走同一条 ctx.inject 路径。ctx.inject 的
		// 语义：服务已存在时回调立即执行；后到达时等到达后执行；服务消失时
		// inject 返回的 disposer 自动执行。把 registerTab + sidebarBus.set 放在
		// inject 回调里，disposer 绑定到 Better Sidebar 依赖 fiber——只卸载
		// Better Sidebar、不卸载 dsh-mindmap 时，disposer 照常执行，sidebarBus
		// 归零，layout-push effect 自动恢复 standalone 布局。
		if (typeof ctx.inject === "function") {
			try {
				ctx.inject(["betterSidebar"], (ctx2) => {
					const svc = ctx2 && ctx2.betterSidebar;
					if (!svc || typeof svc.registerTab !== "function") return;
					// 029 注册 Tab 并设 sidebarBus。disposer 清 bus + 注销 Tab——
					// 不用 ctx.effect 包裹，disposer 直接由 ctx.inject 的依赖
					// 生命周期管理（Better Sidebar fiber 卸载时触发）。
					const dispose = svc.registerTab({
						id: "dsh-mindmap:mindmap",
						title: () => "思维脑图",
						icon: (size) => (0, react_jsx_runtime.jsx)("svg", {
							width: size, height: size, viewBox: "0 0 14 14",
							fill: "none", stroke: "currentColor", strokeWidth: 1.4,
							strokeLinecap: "round", strokeLinejoin: "round",
							children: [
								(0, react_jsx_runtime.jsx)("circle", { cx: 2.5, cy: 7, r: 1.7 }),
								(0, react_jsx_runtime.jsx)("circle", { cx: 11.5, cy: 3.5, r: 1.7 }),
								(0, react_jsx_runtime.jsx)("circle", { cx: 11.5, cy: 10.5, r: 1.7 }),
								(0, react_jsx_runtime.jsx)("path", { d: "M4.1 6.2 L9.9 4.2" }),
								(0, react_jsx_runtime.jsx)("path", { d: "M4.1 7.8 L9.9 9.8" }),
							],
						}),
						order: 100,
						single: true,
						component: MindmapSidebarTab,
					});
					sidebarBus.set(svc);
					// 返回 disposer：Better Sidebar 依赖消失时执行。
					return () => {
						sidebarBus.set(null);
						dispose();
					};
				});
			} catch {
				// ctx.inject 不支持或服务名未注册：standalone 模式。
			}
		}

		// 026+028 layout-push CSS 可逆 effect：持续监听 sidebarBus——standalone
		// 模式（bus===null）时注入 #root 推挤规则，sidebar 模式（bus!==null）
		// 时移除。模式切换时自动翻转，不需要一次性删除。纳入 ctx.effect 清理。
		if (typeof ctx.effect === "function") {
			ctx.effect(() => {
				if (typeof document === "undefined") return;
				let layoutStyle = null;
				function ensureLayoutPush() {
					if (typeof document === "undefined") return;
					if (sidebarBus.get()) {
						// sidebar 模式：不推 #root（Better Sidebar 管自己的布局）。
						if (layoutStyle) { layoutStyle.remove(); layoutStyle = null; }
					} else {
						// standalone 模式：注入推挤规则（仅一份）。
						if (!layoutStyle) {
							layoutStyle = document.createElement("style");
							layoutStyle.setAttribute("data-dsh-mindmap", "layout-push");
							layoutStyle.textContent = [
								"#root{",
								"margin-right:calc(var(--dsh-mindmap-width,0px) + var(--dsh-sidebar-width,0px))!important;",
								"width:calc(100% - var(--dsh-mindmap-width,0px) - var(--dsh-sidebar-width,0px))!important;",
								"transition:margin-right var(--ds-transition-duration-slow) var(--ds-ease-in-out),width var(--ds-transition-duration-slow) var(--ds-ease-in-out);",
								"}",
							].join("");
							document.head.appendChild(layoutStyle);
						}
					}
				}
				ensureLayoutPush();
				const unsub = sidebarBus.subscribe(ensureLayoutPush);
				return () => {
					unsub();
					if (layoutStyle) { layoutStyle.remove(); layoutStyle = null; }
				};
			});
		} else if (typeof document !== "undefined" && !sidebarBus.get()) {
			// ctx.effect 不可用：直接注入（015 原始行为），standalone 模式。
			const style = document.createElement("style");
			style.setAttribute("data-dsh-mindmap", "layout-push");
			style.textContent = [
				"#root{",
				"margin-right:calc(var(--dsh-mindmap-width,0px) + var(--dsh-sidebar-width,0px))!important;",
				"width:calc(100% - var(--dsh-mindmap-width,0px) - var(--dsh-sidebar-width,0px))!important;",
				"transition:margin-right var(--ds-transition-duration-slow) var(--ds-ease-in-out),width var(--ds-transition-duration-slow) var(--ds-ease-in-out);",
				"}",
			].join("");
			document.head.appendChild(style);
		}

			// 013 目录树 tab：host 自建只读路由 /mindmap/api/tree（dsh-better-sidebar
			// 同款机制——官方 host.listDirectory 在 native picker 环境必挂，见 013）。
			// 客户端只读目录，仍无任何写文件通道。
			face.listTree = async (sessionId, path) => {
				const response = await fetch("/mindmap/api/tree", {
					method: "POST",
					headers: { "content-type": "application/json" },
					body: JSON.stringify(typeof path === "string" && path ? { sessionId, path } : { sessionId }),
				});
				const parsed = await response.json().catch(() => null);
				if (!response.ok || parsed === null || parsed.ok !== true || !parsed.value) {
					throw new Error(parsed?.error?.message ?? `HTTP ${response.status}`);
				}
				return parsed.value;
			};

			// 015 设置面板：connection/remote 在客户端插件启动后才可能就绪，不能在
			// apply 时捕获一次 undefined；每次读写前重新查取，服务晚到也能恢复。
			// 未声明 inject 的服务只能整名走 ctx.get 可选查取。带点号的服务
			// （remote.settings）同样是独立服务名：先取 remote 再读 .settings 会
			// 被守卫拒绝（cannot get property "remote.settings" without inject），
			// 故一律传全名，并对任何守卫异常降级为「服务不可用」。
			function serviceOf(name) {
				if (typeof ctx.get !== "function") return null;
				try {
					return ctx.get(name) ?? null;
				} catch {
					return null;
				}
			}
			function isSettingsApi(value) {
				try {
					return Boolean(value) && typeof value.describe === "function" && typeof value.update === "function";
				} catch {
					return false;
				}
			}
			function settingsApiOf() {
				const remote = serviceOf("remote.settings");
				if (isSettingsApi(remote)) return { kind: "remote", settings: remote };
				try {
					const settings = serviceOf("connection")?.api?.settings;
					if (isSettingsApi(settings)) return { kind: "connection", settings };
				} catch {
					// 守卫拒绝或连接形态异常：与服务缺失同样降级处理。
				}
				return null;
			}
			face.readSettings = async () => {
				const api = settingsApiOf();
				if (!api) return null;
				const res = api.kind === "remote" ? await api.settings.describe() : await api.settings.describe({});
				const namespaces = settingsNamespacesOf(res);
				const ns = namespaces.find((n) => n?.ns === "mindmap");
				return ns?.value ?? null;
			};
			face.updateSettings = async (patch) => {
				const api = settingsApiOf();
				if (!api) {
					throw new Error("settings service unavailable");
				}
				if (api.kind === "remote" || api.settings.update.length !== 1) {
					await api.settings.update("mindmap", patch, undefined);
				} else {
					await api.settings.update({ ns: "mindmap", patch });
				}
			};

			// 015 设置面板：settings.section（list 槽、root scope）——设置页左栏
			// 新增「思维脑图」导航项（better-sidebar 同款入口；dsh-grafana 的
			// settings.plugin.item 卡片是另一条路，未采用）。
			ctx.slots.inject("settings.section", () => ctx.slots.register({
				name: "settings.section",
				id: "dsh-mindmap",
				order: 100,
				label: "思维脑图",
				inject: () => ({ mindmapFace: face }),
			}, SettingsPanel));

			// 014 overlay 形态（作者拍板，见 docs/014）：面板宿主层（position:fixed）
			// 与 M 按钮一起渲染在 conversation.session.header.actions 槽位里——
			// better-sidebar 同款「fixed 宿主层自举」思路（它的宿主层挂在
			// conversation.chat.turnTail）；session scope 全套 props 直给，无需跨槽。
			// details 槽已归还官方（原生「工具详情」栏恢复）；shell.overlay 方案
			// 实测未渲染，已弃用（见 docs/014 排障）。026：MindmapSlot 内部按
			// sidebarBus 自动切换 sidebar Tab 模式 / standalone 面板模式。
			ctx.slots.inject("conversation.session.header.actions", () => ctx.slots.register({
				name: "conversation.session.header.actions",
				id: "dsh-mindmap",
				order: 100,
				inject: () => ({ mindmapFace: face }),
			}, MindmapSlot));
		}

		exports.apply = apply;
		exports.inject = inject;
		exports.internals = Object.freeze({
			parseMarkdownToTree,
			reduceDocuments,
			mergeDocuments,
			autoOpenTarget,
			openingEventKeys,
			nodesFingerprint,
			matchDocError,
			errorEventKeys,
			resultTextOfBlocks,
			stemOf,
			buildExportSvg,
			measureExportBox,
			exportCanvasSize,
			createIdFactory,
			collectTreeIds,
			planGrowthReveal,
			relPathWithin,
			visibleTreeRows,
			// 025 草稿保护：宿主草稿读取面的能力探测（供测试）。
			readDraftText,
			draftBlocksAutoSend,
			// 025 子树折叠：视图态纯函数 + 节点行组件（供测试）。
			toggleCollapsed,
			countDescendants,
			pruneCollapsed,
			TreeRow,
			// 019 皮肤层与血肉层纯函数（供测试）。
			resolveToken,
			resolveNodeStyle,
			exportPalette,
			hasInlineFormat,
			isTableSeparator,
			parseTableRow,
			nodeFullText,
			renderInline,
			// 链接点击：供测试验证开窗成功才拦默认行为（宿主拦截时退回原生导航）。
			openLink,
			stripInlineForExport,
			wrapExportText,
			COLOR_THEMES,
			TOKEN_REGISTRY,
			clampZoom,
			stepZoom,
			fitZoom,
			focusZoom,
			// 021 画布平移手势判定（供测试）。
			PAN,
			shouldStartPan,
			panScroll,
			isTextEntry,
			isActivatable,
			TOOL_NAMES,
			OPENING_OPS,
			// 023 双代兼容纯函数（供测试）：会话内容节点 / settings 信封。
			conversationNodesOf,
			settingsNamespacesOf,
			// 021 画布组件：仅供测试驱动平移手势（不参与运行时契约）。
			MindmapCanvas,
			// 026 better-sidebar 共存：服务总线 + 会话数据桥 + Tab 壳（供测试）。
			sidebarBus,
			sessionStore,
			MindmapSidebarTab,
			// 027 内嵌头部视觉对齐：壳无关工作区组件 + 样式表（供测试验证 variant 分支）。
			MindmapWorkspace,
			S,
			// 029 会话清理组件测试：MindmapSlot 直接调用（供测试验证 store 清理）。
			MindmapSlot,
		});

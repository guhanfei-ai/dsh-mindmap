// Generated source fragment. Edit this file, then run npm run build:client.
		/**
		 * settings describe 应答的双代信封解析（023）：dsh ≤0.1.1 的远端把
		 * 描述符聚合在 result.value.namespaces[]；0.1.2-rc.1 起直接返回描述符
		 * 数组（每项 {ns, schema, value, …}，字段两代同名）。数组优先、
		 * namespaces 兜底，两代通吃。
		 */
		function settingsNamespacesOf(res) {
			const value = res?.result?.value;
			if (Array.isArray(value)) return value;
			const list = value?.namespaces;
			return Array.isArray(list) ? list : [];
		}

		function apply(ctx) {
			const face = {};

			// 014「布局让位」CSS（better-sidebar 同款机制）：面板打开时给 #root 挂
			// margin-right + 宽度挤压，把聊天区推到左边、面板占右侧腾出的空间，
			// 互不遮挡。015 修复级联冲突：它家（dsh-better-sidebar）同样注入
			// #root 规则，后注入者胜导致我们的推挤被压掉——我们的规则加
			// !important 且把双方变量相加（它开面板时聊天同样让位），无论注入
			// 顺序如何都稳定生效。若它家未来也用 !important，需再评估（见 docs/014）。
			if (typeof document !== "undefined") {
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

			// 018 生长动画：新增/变化节点错峰渐显（节点盒 = 淡入 + 左移浮现，
			// 连线 = 淡入；延迟由内联 animationDelay 提供）。fill mode both 保证
			// 延迟期间保持隐藏；动画只挂新节点，旧节点不受影响。尊重系统减弱动效。
			if (typeof document !== "undefined") {
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

			// 015 设置面板：settings namespace（dsh-grafana 同款读写面）。
			// connection 走 ctx.get 可选查取（动态 ctx 契约）；缺失时设置面板降级提示。
			const connection = ctx.get("connection");
			const settingsApi = connection && typeof connection.api === "object" ? connection.api : null;
			face.readSettings = async () => {
				if (!settingsApi || typeof settingsApi.settings?.describe !== "function") return null;
				const res = await settingsApi.settings.describe({});
				const namespaces = settingsNamespacesOf(res);
				const ns = namespaces.find((n) => n?.ns === "mindmap");
				return ns?.value ?? null;
			};
			face.updateSettings = async (patch) => {
				if (!settingsApi || typeof settingsApi.settings?.update !== "function") {
					throw new Error("settings service unavailable");
				}
				await settingsApi.settings.update({ ns: "mindmap", patch });
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
			// 实测未渲染，已弃用（见 docs/014 排障）。
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
			createIdFactory,
			collectTreeIds,
			planGrowthReveal,
			relPathWithin,
			visibleTreeRows,
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
		});




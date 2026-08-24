// Generated source fragment. Edit this file, then run npm run build:client.
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
				const namespaces = res?.result?.value?.namespaces ?? [];
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
			resultTextOfBlocks,
			stemOf,
			buildExportSvg,
			createIdFactory,
			relPathWithin,
			visibleTreeRows,
			colorThemeTokens,
			clampZoom,
			stepZoom,
			fitZoom,
			focusZoom,
			TOOL_NAMES,
			OPENING_OPS,
		});




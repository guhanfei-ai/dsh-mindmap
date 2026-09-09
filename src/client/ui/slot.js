// Generated source fragment. Edit this file, then run npm run build:client.
		/**
		 * 会话内容节点的双代快照选择（023）：dsh ≤0.1.1 的 useSession 快照带
		 * 平铺 nodes；0.1.2-rc.1 起 SessionSnapshot 拆成纯控制状态，会话内容
		 * 迁入 useChat 的 ChatSnapshot.legacy.nodes（官方兼容面，ToolResultNode
		 * 字段同名）。legacy 优先、旧 nodes 兜底，两代通吃。
		 */
		function conversationNodesOf(s) {
			if (!s) return EMPTY_NODES;
			const legacy = s.legacy;
			if (legacy && Array.isArray(legacy.nodes)) return legacy.nodes;
			return Array.isArray(s.nodes) ? s.nodes : EMPTY_NODES;
		}

		/**
		 * 「思维脑图」槽位组件（014 + 026 双模式）：同一槽位渲染 M 按钮。
		 * 026 起，betterSidebar 服务可用时（sidebarBus 检测）走原生 Tab 模式——
		 * M 按钮调 openTab 聚焦 Tab，不渲染独立 fixed 面板；会话数据写入
		 * sessionStore 供 MindmapSidebarTab 读取。服务不可用时维持头部按钮 +
		 * 独立悬浮面板（MindmapDetailsPanel）。
		 * session scope 的 useSession/sessionId/inputActions 直给，经 props 传给
		 * MindmapDetailsPanel（无桥、无 useSyncExternalStore——shell.overlay 跨槽
		 * 方案实测未渲染，弃用后顺手把桥也删了）。023：内容钩子改为
		 * useChat（0.1.2-rc.1+）优先、useSession（≤0.1.1）兜底。
		 */
		function MindmapSlot(props) {
			const { useSession, useChat, sessionId, inputActions, mindmapFace } = props;
			const nodesHook = useChat ?? useSession;
			const nodes = nodesHook ? nodesHook(conversationNodesOf) : EMPTY_NODES;
			// 016 可靠性加固：结构指纹作第二 selector。store 原地改数组（引用
			// 不变）时，nodes prop 不换、memo 命中缓存、auto-open effect 永不
			// 重跑——「AI 打开了脑图但面板不展开」的根因。指纹是原始值字符串，
			// 值比较天然绕过引用相等短路；内容钩子不可用时回退空串。
			const nodesVersion = nodesHook ? nodesHook((s) => nodesFingerprint(conversationNodesOf(s))) : "";

			// 026 sidebar 模式检测：betterSidebar 服务可用时走原生 Tab，否则走独立面板。
			const sidebar = react.useSyncExternalStore(sidebarBus.subscribe, sidebarBus.get);
			const sidebarMode = sidebar !== null;

		// 026 会话数据桥：sidebar 模式下把头部槽位捕获的数据写入 sessionStore，
		// 供 MindmapSidebarTab 组件读取（Tab 组件不接收 header 槽位 props）。
		// standalone 模式不写——数据直接经 props 传给 MindmapDetailsPanel。
		// 028 生命周期清理：会话切换时删旧 sessionId 的快照，组件卸载时删
		// 当前 sessionId 的快照——模块级 Map 不残留旧会话的 nodes/inputActions。
		react.useEffect(() => {
			if (!sidebarMode || !sessionId) return;
			sessionStore.set(sessionId, { nodes, nodesVersion, inputActions, mindmapFace });
		}, [sidebarMode, sessionId, nodes, nodesVersion, inputActions, mindmapFace]);
		// 028 会话切换 / 退出 sidebar 模式时清理旧快照。
		const lastSessionRef = react.useRef(null);
		react.useEffect(() => {
			if (!sidebarMode) {
				// 退出 sidebar 模式：清理上次的快照。
				if (lastSessionRef.current) {
					sessionStore.delete(lastSessionRef.current);
					lastSessionRef.current = null;
				}
				return;
			}
			// 会话切换：清理旧 sessionId 的快照。
			if (lastSessionRef.current && lastSessionRef.current !== sessionId) {
				sessionStore.delete(lastSessionRef.current);
			}
			lastSessionRef.current = sessionId;
		}, [sidebarMode, sessionId]);
		// 028 组件卸载时清理当前 sessionId 的快照。
		react.useEffect(() => {
			return () => {
				if (lastSessionRef.current) {
					sessionStore.delete(lastSessionRef.current);
					lastSessionRef.current = null;
				}
			};
		}, []);

			// 026 sidebar auto-open 兜底：BS 可能卸载不可见的 Tab 组件，此时
			// MindmapWorkspace 的 auto-open effect 不跑。MindmapSlot 始终在头部
			// 挂载，在这里检测新的 create/open 结果并调 openTab 把 Tab 拉起。
			// 首次进入 sidebar 模式时只记基线（不弹历史文档），之后只响应新事件。
			const sidebarDocs = react.useMemo(() => reduceDocuments(nodes), [nodes, nodesVersion]);
			const sidebarSeen = react.useRef(null);
			const sidebarInitedRef = react.useRef(false);
			react.useEffect(() => {
				if (!sidebarMode || !sessionId) {
					sidebarInitedRef.current = false;
					return;
				}
				if (!sidebarInitedRef.current) {
					sidebarInitedRef.current = true;
					sidebarSeen.current = openingEventKeys(sidebarDocs);
					return;
				}
				const target = autoOpenTarget(sidebarDocs, sidebarSeen.current);
				sidebarSeen.current = openingEventKeys(sidebarDocs);
				if (target) {
					try { sidebar.openTab({ type: "dsh-mindmap:mindmap" }, { sessionId }); } catch { /* BS 已卸载或方法缺失 */ }
				}
			}, [sidebarDocs, sidebarMode, sessionId, sidebar]);

			const [open, setOpen] = react.useState(false);

			// M 按钮的 SVG 图标（两种模式共用）。
			const mButtonIcon = (0, react_jsx_runtime.jsx)("svg", {
				width: 14,
				height: 14,
				viewBox: "0 0 14 14",
				fill: "none",
				stroke: "currentColor",
				strokeWidth: 1.4,
				strokeLinecap: "round",
				strokeLinejoin: "round",
				"aria-hidden": "true",
				style: { opacity: 0.7, flex: "none" },
				children: [
					(0, react_jsx_runtime.jsx)("circle", { cx: 2.5, cy: 7, r: 1.7 }),
					(0, react_jsx_runtime.jsx)("circle", { cx: 11.5, cy: 3.5, r: 1.7 }),
					(0, react_jsx_runtime.jsx)("circle", { cx: 11.5, cy: 10.5, r: 1.7 }),
					(0, react_jsx_runtime.jsx)("path", { d: "M4.1 6.2 L9.9 4.2" }),
					(0, react_jsx_runtime.jsx)("path", { d: "M4.1 7.8 L9.9 9.8" }),
				],
			});

			if (sidebarMode) {
				// sidebar 模式：M 按钮调 openTab 聚焦 Better Sidebar Tab，不渲染独立面板。
				return (0, react_jsx_runtime.jsx)(react.Fragment, { children: (0, react_jsx_runtime.jsxs)("button", {
					type: "button",
					title: "脑图面板：展开 / 收起",
					style: S.mButton,
					onClick: () => {
						try { sidebar.openTab({ type: "dsh-mindmap:mindmap" }, { sessionId }); } catch { /* BS 已卸载或方法缺失 */ }
					},
					children: [mButtonIcon, "思维脑图"],
				}) });
			}

			// standalone 模式：M 按钮 + 独立 fixed 面板。
			return (0, react_jsx_runtime.jsxs)(react.Fragment, { children: [
				(0, react_jsx_runtime.jsxs)("button", {
					type: "button",
					title: "脑图面板：展开 / 收起",
					style: S.mButton,
					onClick: () => setOpen((v) => !v),
					children: [mButtonIcon, "思维脑图"],
				}),
				(0, react_jsx_runtime.jsx)(MindmapDetailsPanel, {
					open,
					sessionId,
					inputActions,
					nodes,
					nodesVersion,
					mindmapFace,
					onOpen: () => setOpen(true),
					onClose: () => setOpen(false),
				}),
			] });
		}

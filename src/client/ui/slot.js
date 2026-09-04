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
		 * 「思维脑图」槽位组件（014）：同一槽位渲染 M 按钮 + 悬浮面板宿主层。
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
			const [open, setOpen] = react.useState(false);
			return (0, react_jsx_runtime.jsxs)(react.Fragment, { children: [
				(0, react_jsx_runtime.jsxs)("button", {
					type: "button",
					title: "脑图面板：展开 / 收起",
					style: S.mButton,
					onClick: () => setOpen((v) => !v),
					children: [
						(0, react_jsx_runtime.jsx)("svg", {
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
						}),
						"思维脑图",
					],
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

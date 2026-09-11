// Generated source fragment. Edit this file, then run npm run build:client.
		/**
		 * Better Sidebar Tab 壳（026）：Better Sidebar 服务可用时，apply() 注册
		 * 此组件为单实例 Tab（id = dsh-mindmap:mindmap）。它从 sessionStore 读取
		 * 头部槽位（MindmapSlot）捕获的 nodes/nodesVersion/inputActions/mindmapFace，
		 * 传给壳无关的 MindmapWorkspace 渲染。
		 *
		 * TabComponentProps（由 Better Sidebar 传入）：{ ctx, scope, tab, visible, ... }
		 * visible = false 时组件仍挂载（BS 性能门控），MindmapWorkspace 的 hooks
		 * 照常跑——auto-open 能在 Tab 不可见时调 onAutoOpen → openTab 把它拉起。
		 *
		 * 如果 BS 卸载了不可见的 Tab 组件，MindmapSlot 的 sidebar 模式 auto-open
		 * 兜底调 openTab；Tab 重新挂载后 MindmapWorkspace 的 seen=null 首挂载语义
		 * 恢复最近一次打开的脑图。
		 */
		function MindmapSidebarTab(props) {
			const { ctx, scope, visible } = props;
			const sessionId = scope && scope.sessionId;

			// 从 sessionStore 读头部槽位写入的会话数据（按 sessionId 隔离）。
			// useCallback 保证 subscribe/getSnapshot 仅在 sessionId 变化时重建，
			// 避免每帧重订阅。
			const subscribe = react.useCallback(
				(fn) => sessionStore.subscribe(sessionId, fn),
				[sessionId],
			);
			const getSnapshot = react.useCallback(
				() => sessionStore.get(sessionId),
				[sessionId],
			);
			const data = react.useSyncExternalStore(subscribe, getSnapshot);

		// auto-open 回调：新的 mindmap_create/open 到达时聚焦本 Tab。
		// 031：经 openMindmapTab helper 附惰性 url，让 BS 自动展开右栏面板。
		const onAutoOpen = react.useCallback(() => {
			openMindmapTab(ctx && ctx.betterSidebar, scope);
		}, [ctx, scope]);

			if (!data) {
				// MindmapSlot 尚未写入数据（Tab 先于会话激活打开）。
				return (0, react_jsx_runtime.jsx)("div", { style: S.loadingWrap, children:
					(0, react_jsx_runtime.jsx)("p", { style: SIDEBAR_STYLES.loadingText, children: "等待会话数据…" })
				});
			}

			return (0, react_jsx_runtime.jsx)(MindmapWorkspace, {
				sessionId,
				nodes: data.nodes,
				nodesVersion: data.nodesVersion,
				inputActions: data.inputActions,
				mindmapFace: data.mindmapFace,
				visible,
				onAutoOpen,
				onClose: undefined,
				headerHeight: null,
				variant: "sidebar",
			});
		}

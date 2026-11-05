// Generated source fragment. Edit this file, then run npm run build:client.
		//#region better-sidebar 共存：服务总线 + 会话数据桥
		// sidebarBus：betterSidebar 服务引用的可观察容器。apply() 检测到服务时
		// set(svc)，MindmapSlot 用 useSyncExternalStore 订阅，决定渲染独立面板
		// 还是只渲染 M 按钮（面板交给 Better Sidebar Tab）。服务不可用时 get()
		// 返回 null——独立面板照常工作，无需安装额外依赖。
		const sidebarBus = (() => {
			let service = null;
			const listeners = new Set();
			return {
				get: () => service,
				set(svc) {
					service = svc || null;
					for (const fn of listeners) fn();
				},
				subscribe(fn) {
					listeners.add(fn);
					return () => { listeners.delete(fn); };
				},
			};
		})();

		// sessionStore：按 sessionId 隔离的数据桥。MindmapSlot 始终在头部槽位里
		// 调用 useChat/useSession/useInput 获取文档和最新输入快照读取器，写入
		// 对应 sessionId 的快照；MindmapSidebarTab 组件用 useSyncExternalStore
		// 订阅自己 sessionId 的快照，拿到数据后渲染 MindmapWorkspace。
		// 028 生命周期清理：MindmapSlot 在会话切换（sessionId 变化）和组件卸载
		// 时删除对应 sessionId 的快照——模块级 Map 不残留旧会话的
		// nodes/inputActions/文档缓存。退出 sidebar 模式（Better Sidebar 卸载）时也清理。
		const sessionStore = (() => {
			const sessions = new Map();
			const listeners = new Map();
			function notify(sessionId) {
				const set = listeners.get(sessionId);
				if (set) for (const fn of set) fn();
			}
			return {
				get(sessionId) {
					return sessions.get(sessionId) || null;
				},
				set(sessionId, data) {
					sessions.set(sessionId, data);
					notify(sessionId);
				},
				delete(sessionId) {
					sessions.delete(sessionId);
					notify(sessionId);
				},
				subscribe(sessionId, fn) {
					let set = listeners.get(sessionId);
					if (!set) { set = new Set(); listeners.set(sessionId, set); }
					set.add(fn);
					return () => {
						set.delete(fn);
						if (set.size === 0) listeners.delete(sessionId);
					};
				},
			};
		})();
		//#endregion

	//#region issue #4 焦点同步防振荡记忆
	// 焦点同步的防重与硬上限必须活过组件重挂载：BS 会卸载不可见的 Tab、
	// 同会话可能开两个窗口，每个面板实例各持一份组件 state（focusSentRef）
	// 会互相纠正，产生「打开 A→打开 B→打开 A」的自发消息振荡（issue #4）。
	// 因此防重记忆放模块级、按 sessionId 隔离：
	// - pairs：已自动发送过的「显示文档 \0 AI 焦点」组合——同一组合不重发
	//   （防重按事件组合，不按单一 path；焦点真变了才算新事件）；
	// - total：本会话自动发送总量，达到 FOCUS_SYNC_SESSION_CAP 后静默停止，
	//   由面板一次性提示（notified 标记，跨挂载不重复提示）。
	// 会话数超限时淘汰最旧条目，防长驻页面无限增长；clear() 供测试隔离。
	const FOCUS_SYNC_SESSION_CAP = 5;
	const FOCUS_SYNC_MAX_SESSIONS = 16;
	const focusGuard = (() => {
		const sessions = new Map();
		const pairKey = (activePath, focusPath) => `${activePath}\u0000${focusPath}`;
		function stateOf(sessionId) {
			let state = sessions.get(sessionId);
			if (!state) {
				state = { pairs: new Set(), total: 0, notified: false };
				sessions.set(sessionId, state);
				if (sessions.size > FOCUS_SYNC_MAX_SESSIONS) {
					sessions.delete(sessions.keys().next().value);
				}
			}
			return state;
		}
		return {
			// 该「显示文档 vs AI 焦点」组合是否还允许自动发送。
			maySend(sessionId, activePath, focusPath) {
				const state = sessions.get(sessionId);
				if (!state) return true;
				if (state.total >= FOCUS_SYNC_SESSION_CAP) return false;
				return !state.pairs.has(pairKey(activePath, focusPath));
			},
			// 记一次已发送（成对记忆 + 总量计数）。
			record(sessionId, activePath, focusPath) {
				const state = stateOf(sessionId);
				state.pairs.add(pairKey(activePath, focusPath));
				state.total += 1;
			},
			// 是否需要向用户提示一次「已超上限静默停止」。
			shouldNotify(sessionId) {
				const state = sessions.get(sessionId);
				return Boolean(state && state.total >= FOCUS_SYNC_SESSION_CAP && !state.notified);
			},
			markNotified(sessionId) {
				const state = sessions.get(sessionId);
				if (state) state.notified = true;
			},
			clear() {
				sessions.clear();
			},
		};
	})();
	//#endregion

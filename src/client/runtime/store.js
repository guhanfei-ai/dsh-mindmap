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
		// 调用 useChat/useSession 钩子获取 nodes/nodesVersion/inputActions，写入
		// 对应 sessionId 的快照；MindmapSidebarTab 组件用 useSyncExternalStore
		// 订阅自己 sessionId 的快照，拿到数据后渲染 MindmapWorkspace。
		// 028 生命周期清理：MindmapSlot 在会话切换（sessionId 变化）和组件卸载
		// 时删除对应 sessionId 的快照——模块级 Map 不残留旧会话的
		// nodes/inputActions。退出 sidebar 模式（Better Sidebar 卸载）时也清理。
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

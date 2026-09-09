// Generated source fragment. Edit this file, then run npm run build:client.
		/**
		 * 独立 fixed 壳（026 拆分）：仅 Better Sidebar 未安装或服务不可用时使用。
		 * 管理壳特有几何——右缘贴边悬浮、左缘拖拽调宽（localStorage 持久化）、
		 * 头部高度对齐聊天区、layout-push CSS 变量（--dsh-mindmap-width）。
		 * 壳内始终挂载 MindmapWorkspace（visible=open）：收起时 display:none 隐藏，
		 * 但 hooks 照常跑——auto-open effect 能在面板关着时调 onAutoOpen 把它拉起。
		 */
		function MindmapDetailsPanel(props) {
			const { mindmapFace, open, sessionId, inputActions, nodes, nodesVersion, onOpen, onClose } = props;
			// 014 overlay 宽度：localStorage 持久化，拖拽钳制 [280, 视口 80%]。
			// 窗口尺寸变化时持续钳制——只在挂载时压一次的话，窗口先放大→拖宽
			// 面板→再缩小会让面板保持旧像素宽，聊天区被挤没。
			const WIDTH_KEY = "dsh-mindmap.overlay-width";
			const [panelWidth, setPanelWidth] = react.useState(() => {
				try {
					const saved = Number(localStorage.getItem(WIDTH_KEY));
					if (Number.isFinite(saved) && saved >= 280) return Math.min(saved, Math.round(window.innerWidth * 0.8));
				} catch {
					// localStorage 不可用：走默认
				}
				return Math.round(window.innerWidth * 0.42);
			});
			react.useEffect(() => {
				const clamp = () => {
					setPanelWidth((prev) => {
						const max = Math.round(window.innerWidth * 0.8);
						return prev > max ? max : prev;
					});
				};
				clamp();
				window.addEventListener("resize", clamp);
				return () => window.removeEventListener("resize", clamp);
			}, []);
			// 015 设置面板：没有本地拖拽记忆时，用 settings 里的默认宽度。
			react.useEffect(() => {
				let hasLocal = false;
				try {
					hasLocal = localStorage.getItem(WIDTH_KEY) !== null;
				} catch {
					// 忽略
				}
				if (hasLocal) return;
				if (!mindmapFace || typeof mindmapFace.readSettings !== "function") return;
				mindmapFace.readSettings().then((v) => {
					const pct = v && typeof v.defaultPanelWidth === "number" ? Math.min(80, Math.max(20, v.defaultPanelWidth)) : 42;
					const px = Math.round(window.innerWidth * pct / 100);
					setPanelWidth((prev) => (Math.abs(prev - px) < 2 ? prev : px));
				}).catch(() => {
					// 读设置失败：保持 42% 默认
				});
			}, [mindmapFace]);

			const dragStateRef = react.useRef(null);
			function startResize(e) {
				e.preventDefault();
				dragStateRef.current = { startX: e.clientX, startWidth: panelWidth, latestWidth: panelWidth };
				const onMove = (ev) => {
					if (!dragStateRef.current) return;
					const max = Math.round(window.innerWidth * 0.8);
					const next = Math.min(max, Math.max(280, dragStateRef.current.startWidth + (dragStateRef.current.startX - ev.clientX)));
					dragStateRef.current.latestWidth = next;
					setPanelWidth(next);
				};
				const onUp = () => {
					try {
						localStorage.setItem(WIDTH_KEY, String(dragStateRef.current ? dragStateRef.current.latestWidth : panelWidth));
					} catch {
						// localStorage 不可用：忽略
					}
					dragStateRef.current = null;
					window.removeEventListener("mousemove", onMove);
					window.removeEventListener("mouseup", onUp);
				};
				window.addEventListener("mousemove", onMove);
				window.addEventListener("mouseup", onUp);
			}

			// 007~010 头线对齐（overlay 版回归）：面板头部高度动态跟随聊天区头部，
			// 让两者的底部分隔线像素对齐。面板贴视口顶（fixed 宿主层），故
			// 头部高度 = 聊天头部 rect.bottom - 1 - 面板顶（面板顶 ≈ 视口顶）。
			// 主选 wSkVaW_header；结构链回退；合法性钳制 [40,200]；失败回退 74（75-1）。
			const panelRootRef = react.useRef(null);
			const FALLBACK_HEADER_HEIGHT = 74;
			const [headerHeight, setHeaderHeight] = react.useState(FALLBACK_HEADER_HEIGHT);
			react.useLayoutEffect(() => {
				const HEADER_MIN = 40;
				const HEADER_MAX = 200;
				const tryPaths = [
					() => document.querySelector('[class*="wSkVaW_header"]'),
					() => {
						const frame = document.querySelector("[data-dsh-frame]");
						if (!frame) return null;
						const center = frame.querySelector('[data-pane="conversation"]');
						return center ? center.firstElementChild : null;
					},
				];
				const measure = () => {
					for (const path of tryPaths) {
						const el = path();
						if (!el) continue;
						const rect = el.getBoundingClientRect();
						const panelTop = panelRootRef.current
							? panelRootRef.current.getBoundingClientRect().top
							: rect.top;
						const h = rect.bottom - 1 - panelTop;
						if (h >= HEADER_MIN && h <= HEADER_MAX) {
							setHeaderHeight(Math.round(h * 10) / 10);
							return;
						}
					}
					setHeaderHeight(FALLBACK_HEADER_HEIGHT);
				};
				measure();
				const target = tryPaths[0]() || tryPaths[1]();
				let observer = null;
				if (target && typeof ResizeObserver !== "undefined") {
					observer = new ResizeObserver(measure);
					observer.observe(target);
				}
				window.addEventListener("resize", measure);
				return () => {
					if (observer) observer.disconnect();
					window.removeEventListener("resize", measure);
				};
			}, []);

			// 014 布局让位：面板打开/拖宽时把宽度写进 CSS 变量，挤窄 #root 推走
			// 聊天区（better-sidebar 同款）；关闭/卸载时移除变量恢复全宽。
			// 仅独立壳模式启用——BS Tab 模式不渲染本组件，不写此变量。
			react.useLayoutEffect(() => {
				if (typeof document === "undefined") return;
				if (open) {
					document.documentElement.style.setProperty("--dsh-mindmap-width", `${panelWidth}px`);
				} else {
					document.documentElement.style.removeProperty("--dsh-mindmap-width");
				}
				return () => {
					document.documentElement.style.removeProperty("--dsh-mindmap-width");
				};
			}, [open, panelWidth]);

			// 始终挂载 MindmapWorkspace：收起时用 display:none 隐藏外壳，
			// 但组件实例保留——hooks（auto-open / 焦点同步 / 目录树）照常跑。
			// 切换 open 时 MindmapWorkspace 在 children 数组里的位置不变（index 1），
			// React 保持实例不卸载，state 不丢失。
			const workspace = (0, react_jsx_runtime.jsx)(MindmapWorkspace, {
				sessionId,
				nodes,
				nodesVersion,
				inputActions,
				mindmapFace,
				visible: open,
				onAutoOpen: onOpen,
				onClose,
				headerHeight,
				variant: "standalone",
			});
			return (0, react_jsx_runtime.jsx)("div", { style: open ? S.panelHost : { display: "none" }, children: (0, react_jsx_runtime.jsxs)("div", { ref: panelRootRef, style: open ? { ...S.overlayRoot, width: panelWidth } : { display: "none" }, children: [
				open ? (0, react_jsx_runtime.jsx)("div", { style: S.overlayHandle, onMouseDown: startResize }) : null,
				workspace,
			] }) });
		}

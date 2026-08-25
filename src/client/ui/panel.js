// Generated source fragment. Edit this file, then run npm run build:client.
		function MindmapDetailsPanel(props) {
			// 014：面板与 M 按钮同槽位（conversation.session.header.actions），
			// 会话能力（sessionId/inputActions/nodes）与开合回调全部由 MindmapSlot
			// 经 props 直给（无桥、无 useSyncExternalStore）。
			const { mindmapFace, open, sessionId, inputActions, nodes, nodesVersion, onOpen, onClose } = props;
			// 016：nodesVersion（结构指纹）作副依赖——nodes 引用不变但内容已变
			// （新工具结果原地落地）时强制重算；docs 新引用带动 merged →
			// auto-open effect 重跑（对已消费事件幂等 no-op），面板必达展开。
			const docs = react.useMemo(() => reduceDocuments(nodes), [nodes, nodesVersion]);
			// 013：本地加载占位文档（左键点 .md 秒建 tab、内容为空），与快照文档
			// 合并显示；快照优先（AI 结果覆盖占位）。
			const [localDocs, setLocalDocs] = react.useState({});
			const merged = react.useMemo(() => mergeDocuments(docs, localDocs), [docs, localDocs]);
			// 016 加载态恢复（S2/S3 成因）：openMindmap 点击时刻记录错误事件键
			// 基线——只有其后新出现的错误才归因到该次打开（matchDocError 的
			// sinceKeys）；重试时基线随新占位重建（当前错误已含其中，不重复弹）。
			const localErrorBaseRef = react.useRef(null);
			// 016 看门狗：本地占位约 30s 无结果 → 超时态（提示 + 重试）。
			// AI 没调工具（S3）或任何未知成因卡住时的兜底恢复路径。
			const OPEN_TIMEOUT_MS = 30000;
			const [openTimedOut, setOpenTimedOut] = react.useState(false);
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

			// 015 节点主题：面板每次打开、或设置总线 bump（设置页保存）时重读
			// settings——面板常驻不卸载，光靠 open 变化会漏掉「开着面板改设置」。
			const settingsStamp = react.useSyncExternalStore(settingsBus.subscribe, settingsBus.get);
			const [theme, setTheme] = react.useState({ lineStyle: "elbow", cardStyle: "rounded", colorTheme: "ocean", growthAnimation: true });
			react.useEffect(() => {
				if (!open) return;
				if (!mindmapFace || typeof mindmapFace.readSettings !== "function") return;
				mindmapFace.readSettings().then((v) => {
					if (!v) return;
					setTheme({
						lineStyle: v.lineStyle === "curve" ? "curve" : "elbow",
						cardStyle: v.cardStyle === "square" ? "square" : "rounded",
						colorTheme: COLOR_THEMES[v.colorTheme] ? v.colorTheme : "ocean",
						// 018 生长动画开关：旧设置/读不到都默认开（!== false 语义）。
						growthAnimation: v.growthAnimation !== false,
					});
				}).catch(() => {
					// 读设置失败：保持当前主题
				});
			}, [open, settingsStamp, mindmapFace]);
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
			// 013 目录树 tab：常驻第一个 tab（TREE_TAB 哨兵，永不与绝对路径撞名）。
			const TREE_TAB = "__tree__";
			// 013 作者拍板「单脑图模式」：面板只有「目录」与「脑图」两个 tab，
			// 打开新脑图替换掉旧的（覆盖 001 决策 3 的多标签形态，记录见 013）。
			const [view, setView] = react.useState("tree");
			const [currentPath, setCurrentPath] = react.useState(null);
			const [hiddenPath, setHiddenPath] = react.useState(null);
			const [exporting, setExporting] = react.useState(false);
			const [exportError, setExportError] = react.useState("");
			const [filledHint, setFilledHint] = react.useState("");
			// fsTree：nodes = {path → 节点}, expanded = {path → true}, loading = {path → true}。
			const [fsTree, setFsTree] = react.useState({ nodes: {}, expanded: {}, loading: {}, cwd: null, error: null });
			// 013 右键菜单：{x, y, kind: "root"|"dir", rel}；null = 关闭。
			const [treeMenu, setTreeMenu] = react.useState(null);
			// tab 右键菜单：{x, y, path}（path === TREE_TAB 时是「刷新目录树」）。
			const [tabMenu, setTabMenu] = react.useState(null);
			// 悬停高亮键：树行用 entry.path / node.path，tab 用 TREE_TAB / 文档路径。
			const [hoverKey, setHoverKey] = react.useState(null);

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

			// 单脑图模式：可见脑图 = 用户当前点选（且未被关闭）的快照/本地文档，
			// 否则跟随最新工具结果；隐藏过的路径不自动回弹（重新点树里文件才恢复）。
			const lastPath = merged.order.length > 0 ? merged.order[merged.order.length - 1] : null;
			const shown = currentPath && currentPath !== hiddenPath && merged.byPath[currentPath]
				? currentPath
				: (lastPath && lastPath !== hiddenPath ? lastPath : null);
			const active = view === "mindmap" && shown ? shown : TREE_TAB;
			const doc = active !== TREE_TAB && merged.byPath[active] ? merged.byPath[active] : null;
			const tree = react.useMemo(
				() => (doc ? parseMarkdownToTree(doc.content, doc.rootTitle) : null),
				[doc && doc.content, doc && doc.rootTitle],
			);

			// 018 生长动画调度：新树与上一版（同 path）的稳定 id 集做 diff，只对新增/
			// 变化节点出渐显计划（planGrowthReveal 广度优先错峰、总时长 ≤ 2s）；播完定时清空，
			// 节点转静态渲染——之后切 tab/重挂载不重播；连续更新时 cleanup 清旧定时器、
			// 新计划直接替换，不堆积。跨文档/首屏（prev path 不同或无旧集）= 全量生长。
			const prevIdsRef = react.useRef({ path: null, ids: null });
			const [reveal, setReveal] = react.useState(null);
			react.useEffect(() => {
				const path = doc ? doc.path : null;
				const prev = prevIdsRef.current;
				const prevIds = prev.path === path ? prev.ids : null;
				prevIdsRef.current = { path, ids: tree ? collectTreeIds(tree) : null };
				if (!tree || !theme.growthAnimation) {
					setReveal(null);
					return;
				}
				const plan = planGrowthReveal(tree, prevIds);
				setReveal(plan);
				if (!plan) return;
				const timer = setTimeout(() => setReveal(null), plan.totalMs + 50);
				return () => clearTimeout(timer);
			}, [tree, doc && doc.path, theme.growthAnimation]);

			// 016 看门狗：当前显示本地占位（等待 AI 打开结果）时计时；doc 被快照
			// 结果覆盖 / 切走 / 重开（openMindmap 重建占位 → 新 doc 引用）时自动
			// 重置。超时转超时态，渲染重试入口。
			react.useEffect(() => {
				if (!doc || doc.op !== "local") {
					setOpenTimedOut(false);
					return;
				}
				setOpenTimedOut(false);
				const id = setTimeout(() => setOpenTimedOut(true), OPEN_TIMEOUT_MS);
				return () => clearTimeout(id);
			}, [doc]);

			// 016：当前加载占位的归因错误（精确/小写路径匹配优先，点击时刻基线
			// 之后新出现的 latestError 兜底——host 抛错结果常无路径可归因）。
			const docError = doc && doc.op === "local" && localErrorBaseRef.current
				? matchDocError(merged, doc.path, localErrorBaseRef.current)
				: null;

			// AI 自动打开：create/open 代表用户明确的「创建 / 打开 / 查看」意图。
			// 无论面板当前是否收起，都展开并切到这次意图对应的文档；首次挂载的
			// 历史快照也照常显示最近一次打开的脑图，避免出现「AI 说已打开但面板没了」。
			const seen = react.useRef(null);
			react.useEffect(() => {
				const targetPath = autoOpenTarget(merged, seen.current);
				seen.current = openingEventKeys(merged);
				if (targetPath) {
					onOpen();
					setHiddenPath(null);
					setCurrentPath(targetPath);
					setView("mindmap");
				}
			}, [merged]);

			// 013「所见即所编」焦点同步：AI 焦点 = 快照里最新工具结果的文档路径；
			// 脑图视图激活且其文档 ≠ 焦点时，自动填「用 mindmap_open 打开 <它>」
			// 并发送，让 AI 跟上用户眼睛看的那颗脑图。
			const focusPath = docs.order.length > 0 ? docs.order[docs.order.length - 1] : null;
			const focusSentRef = react.useRef(null);
			react.useEffect(() => {
				if (!open) return; // 面板收起时不自动发消息（014 overlay 形态守卫）
				if (!sessionId) return;
				if (!active || active === TREE_TAB) return;
				if (!docs.byPath[active]) return; // 本地占位：它的 open 请求已在途
				if (focusPath === active) return;
				if (focusSentRef.current === active) return; // 已发过，等 AI 结果追平
				if (!inputActions || typeof inputActions.setDraft !== "function") return;
				const rel = fsTree.cwd ? relPathWithin(fsTree.cwd, active, stemOf(active)) : active;
				try {
					inputActions.setDraft(`用 mindmap_open 打开 ${rel}`);
					if (typeof inputActions.submit === "function") inputActions.submit();
					focusSentRef.current = active;
				} catch {
					// 发送失败：下次 active/focus 变化会再试；也可手动在聊天里说。
				}
			}, [active, focusPath, fsTree.cwd, docs, open]);

			async function onExport() {
				if (!tree || !doc || exporting) return;
				setExporting(true);
				setExportError("");
				try {
					await exportPng(tree, doc.rootTitle);
				} catch (error) {
					setExportError(String(error?.message ?? error));
				} finally {
					setExporting(false);
				}
			}

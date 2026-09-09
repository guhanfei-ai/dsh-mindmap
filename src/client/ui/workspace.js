// Generated source fragment. Edit this file, then run npm run build:client.
		/**
		 * 壳无关的脑图工作区（026 拆分）：从 MindmapDetailsPanel 提取的全部
		 * 共享状态与逻辑——文档合并、目录树、视图切换、导出、自动展开、焦点
		 * 同步、生长动画、加载态。不含任何壳特有几何（fixed 定位、宽度拖拽、
		 * layout-push CSS、头部高度对齐），这些由外层壳（独立 fixed 壳 /
		 * Better Sidebar Tab 壳）提供。
		 *
		 * visible：内容是否对用户可见（独立壳 = open；BS Tab = visible）。
		 * 不可见时仍挂载——hooks 照常跑，auto-open 能在面板/Tab 收起时触发
		 * onAutoOpen 把它拉起。onAutoOpen 在独立壳里 = setOpen(true)，在
		 * BS Tab 里 = openTab(...)。onClose 仅独立壳提供（BS Tab 自带关闭）。
		 * headerHeight：独立壳传入的对齐高度（null = BS Tab 模式，头部自适应）。
		 */
		function MindmapWorkspace(props) {
			const { mindmapFace, visible, sessionId, inputActions, nodes, nodesVersion, onAutoOpen, onClose, headerHeight, variant } = props;
			// 只调整工作区界面；脑图节点与导出继续使用自己的字体层级。
			const S = workspaceStyles(variant);
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

			// 015 节点主题：面板每次可见、或设置总线 bump（设置页保存）时重读
			// settings——面板常驻不卸载，光靠 visible 变化会漏掉「开着面板改设置」。
			const settingsStamp = react.useSyncExternalStore(settingsBus.subscribe, settingsBus.get);
			const [theme, setTheme] = react.useState({ lineStyle: "elbow", cardStyle: "rounded", colorTheme: "ocean", growthAnimation: true });
			react.useEffect(() => {
				if (!visible) return;
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
			}, [visible, settingsStamp, mindmapFace]);

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
			// 会话切换时递增，使旧请求的异步回包不能写入新会话的目录树。
			const treeGenerationRef = react.useRef(0);
			// 013 右键菜单：{x, y, kind: "root"|"dir", rel}；null = 关闭。
			const [treeMenu, setTreeMenu] = react.useState(null);
			// tab 右键菜单：{x, y, path}（path === TREE_TAB 时是「刷新目录树」）。
			const [tabMenu, setTabMenu] = react.useState(null);
			// 悬停高亮键：树行用 entry.path / node.path，tab 用 TREE_TAB / 文档路径。
			const [hoverKey, setHoverKey] = react.useState(null);

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
			// 无论面板/Tab 当前是否可见，都拉起并切到这次意图对应的文档；首次挂载的
			// 历史快照也照常显示最近一次打开的脑图，避免出现「AI 说已打开但面板没了」。
			const seen = react.useRef(null);
			react.useEffect(() => {
				const targetPath = autoOpenTarget(merged, seen.current);
				seen.current = openingEventKeys(merged);
				if (targetPath) {
					onAutoOpen();
					setHiddenPath(null);
					setCurrentPath(targetPath);
					setView("mindmap");
				}
			}, [merged]);

			// 013「所见即所编」焦点同步：AI 焦点 = 快照里最新工具结果的文档路径；
			// 脑图视图激活且其文档 ≠ 焦点时，仅在草稿为空时自动发送，让 AI
			// 跟上用户眼睛看的那颗脑图，又不覆盖用户正在编辑的消息。
			const focusPath = docs.order.length > 0 ? docs.order[docs.order.length - 1] : null;
			const focusSentRef = react.useRef(null);
			// 所有这些状态都属于会话，不得让 A 会话的在途打开/目录结果遗留到 B。
			react.useEffect(() => {
				setLocalDocs({});
				setCurrentPath(null);
				setHiddenPath(null);
				setView("tree");
				setOpenTimedOut(false);
				setTreeMenu(null);
				setTabMenu(null);
				setFilledHint("");
				localErrorBaseRef.current = null;
				focusSentRef.current = null;
				prevIdsRef.current = { path: null, ids: null };
			}, [sessionId]);
			react.useEffect(() => {
				if (!visible) return; // 面板/Tab 不可见时不自动发消息
				if (!sessionId) return;
				if (!active || active === TREE_TAB) return;
				if (!docs.byPath[active]) return; // 本地占位：它的 open 请求已在途
				if (focusPath === active) return;
				if (focusSentRef.current === active) return; // 已发过，等 AI 结果追平
				const rel = fsTree.cwd ? relPathWithin(fsTree.cwd, active, stemOf(active)) : active;
				if (submitChatCommand(`用 mindmap_open 打开 ${rel}`)) {
					focusSentRef.current = active;
				}
			}, [active, focusPath, fsTree.cwd, docs, visible]);

			async function onExport() {
				if (!tree || !doc || exporting) return;
				setExporting(true);
				setExportError("");
				try {
					await exportPng(tree, doc.rootTitle, theme && theme.colorTheme);
				} catch (error) {
					setExportError(String(error?.message ?? error));
				} finally {
					setExporting(false);
				}
			}

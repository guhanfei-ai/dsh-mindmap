// Generated source fragment. Edit this file, then run npm run build:client.
		function MindmapDetailsPanel(props) {
			// 014：面板与 M 按钮同槽位（conversation.session.header.actions），
			// 会话能力（sessionId/inputActions/nodes）与开合回调全部由 MindmapSlot
			// 经 props 直给（无桥、无 useSyncExternalStore）。
			const { mindmapFace, open, sessionId, inputActions, nodes, onOpen, onClose } = props;
			const docs = react.useMemo(() => reduceDocuments(nodes), [nodes]);
			// 013：本地加载占位文档（左键点 .md 秒建 tab、内容为空），与快照文档
			// 合并显示；快照优先（AI 结果覆盖占位）。
			const [localDocs, setLocalDocs] = react.useState({});
			const merged = react.useMemo(() => mergeDocuments(docs, localDocs), [docs, localDocs]);
			// 014 overlay 宽度：localStorage 持久化，拖拽钳制 [280, 视口 80%]。
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
				if (panelWidth > Math.round(window.innerWidth * 0.8)) {
					setPanelWidth(Math.round(window.innerWidth * 0.8));
				}
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
			const [theme, setTheme] = react.useState({ lineStyle: "elbow", cardStyle: "rounded", colorTheme: "ocean" });
			react.useEffect(() => {
				if (!open) return;
				if (!mindmapFace || typeof mindmapFace.readSettings !== "function") return;
				mindmapFace.readSettings().then((v) => {
					if (!v) return;
					setTheme({
						lineStyle: v.lineStyle === "curve" ? "curve" : "elbow",
						cardStyle: v.cardStyle === "square" ? "square" : "rounded",
						colorTheme: COLOR_THEMES[v.colorTheme] ? v.colorTheme : "ocean",
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

			//#region 013 目录树 tab：懒加载树 + 把指令填进聊天输入框
			// 主路径 = inputActions.setDraft（官方公共面，整串替换草稿）；
			// 无则降级剪贴板复制 + 面板内提示。
			function fillDraft(text) {
				try {
					if (inputActions && typeof inputActions.setDraft === "function") {
						inputActions.setDraft(text);
						setFilledHint("指令已填入聊天输入框");
						return;
					}
				} catch {
					// 落剪贴板降级
				}
				if (typeof navigator !== "undefined" && navigator.clipboard && typeof navigator.clipboard.writeText === "function") {
					navigator.clipboard.writeText(text).catch(() => {});
					setFilledHint("已复制指令到剪贴板，请粘贴到聊天输入框");
					return;
				}
				setFilledHint(text);
			}

			/** 关闭脑图视图：✕ 后回到只有「目录」的状态；快照结果不自动弹回。 */
			function closeMindmap(path) {
				setHiddenPath(path);
				setCurrentPath(null);
				setView("tree");
				setLocalDocs((prev) => {
					const next = { ...prev };
					delete next[path];
					return next;
				});
			}

			// 左键点 .md（013 作者定稿）：① tab 秒建（本地占位，不显示内容，body
			// 显示加载动效）；② 同时填「用 mindmap_open 打开 <rel>」并 submit 让 AI
			// 就位——AI 工具结果到达后同 path 覆盖占位，节点才渲染；随后用户接着
			// 说即可继续编辑（002 数据流不变：内容只来自 AI 工具结果）。
			function openMindmap(entry) {
				const text = `用 mindmap_open 打开 ${relPathWithin(fsTree.cwd, entry.path, entry.name)}`;
				// ① 本地占位：脑图 tab 立即切过去、内容为空（op:"local" 触发加载态）；
				// 新打开的脑图替换旧的那颗（单脑图模式）。
				setHiddenPath(null);
				setCurrentPath(entry.path);
				setView("mindmap");
				setLocalDocs((prev) => ({
					...prev,
					[entry.path]: {
						path: entry.path,
						rootTitle: stemOf(entry.name),
						content: "",
						op: "local",
						callId: null,
						renamedFrom: null,
					},
				}));
				// ② AI 就位：填指令并直接提交（失败降级剪贴板）。
				let sent = false;
				if (inputActions && typeof inputActions.setDraft === "function") {
					try {
						inputActions.setDraft(text);
						if (typeof inputActions.submit === "function") {
							inputActions.submit();
							sent = true;
						}
					} catch {
						// 落剪贴板降级
					}
				}
				if (sent) {
					// 标记已发，避免焦点同步 effect 对同一路径重复发送。
					focusSentRef.current = entry.path;
					setFilledHint(`已让 AI 打开「${entry.name}」，在聊天里继续说就能继续编辑`);
					return;
				}
				if (typeof navigator !== "undefined" && navigator.clipboard && typeof navigator.clipboard.writeText === "function") {
					navigator.clipboard.writeText(text).catch(() => {});
					setFilledHint("已复制指令到剪贴板，请粘贴到聊天输入框");
					return;
				}
				setFilledHint(text);
			}

			// 拉取一层目录（path 缺省 = 会话 cwd 根）。host 路由 /mindmap/api/tree
			// 只读；返回 {path, cwd, entries:[{name,path,isDir,hidden}], truncated}。
			async function loadTree(path) {
				const key = path === undefined || path === null ? "" : path;
				setFsTree((prev) => ({ ...prev, loading: { ...prev.loading, [key]: true }, error: null }));
				try {
					if (!mindmapFace || typeof mindmapFace.listTree !== "function") throw new Error("目录树能力不可用");
					const listing = await mindmapFace.listTree(sessionId, typeof path === "string" && path ? path : undefined);
					setFsTree((prev) => {
						const nodes = { ...prev.nodes };
						nodes[listing.path] = {
							path: listing.path,
							name: String(listing.path).split(/[\\/]/).pop() || listing.path,
							parentPath: path === undefined || path === null ? null : path,
							entries: listing.entries ?? [],
							truncated: listing.truncated === true,
						};
						return {
							...prev,
							nodes,
							cwd: typeof listing.cwd === "string" && listing.cwd ? listing.cwd : (prev.cwd ?? listing.path),
							// 根默认自动展开（一打开就看到第一层）；刷新不会收掉已展开的子目录。
							expanded: path === undefined || path === null
								? { ...prev.expanded, [listing.path]: true }
								: prev.expanded,
							loading: { ...prev.loading, [key]: false },
						};
					});
				} catch (error) {
					setFsTree((prev) => ({ ...prev, loading: { ...prev.loading, [key]: false }, error: String(error?.message ?? error) }));
				}
			}

			async function toggleDir(entry) {
				if (fsTree.expanded[entry.path]) {
					setFsTree((prev) => {
						const expanded = { ...prev.expanded };
						delete expanded[entry.path];
						return { ...prev, expanded };
					});
					return;
				}
				if (!fsTree.nodes[entry.path]) await loadTree(entry.path);
				setFsTree((prev) => ({ ...prev, expanded: { ...prev.expanded, [entry.path]: true } }));
			}

			/** 目录节点（含根）展开/折叠；根总在本地节点表里。 */
			function togglePath(path) {
				if (fsTree.expanded[path]) {
					setFsTree((prev) => {
						const expanded = { ...prev.expanded };
						delete expanded[path];
						return { ...prev, expanded };
					});
					return;
				}
				setFsTree((prev) => ({ ...prev, expanded: { ...prev.expanded, [path]: true } }));
			}

			// 首次挂载：拉根目录（会话 cwd）。
			react.useEffect(() => {
				if (!sessionId) return;
				setFsTree({ nodes: {}, expanded: {}, loading: {}, cwd: null, error: null });
				loadTree(undefined);
			}, [sessionId]);

			const treeRows = react.useMemo(
				() => visibleTreeRows(fsTree.nodes, fsTree.expanded),
				[fsTree.nodes, fsTree.expanded],
			);

			function renderTreeRow(row) {
				if (row.kind === "dir") {
					const node = row.node;
					const isRoot = node.parentPath === null;
					const expandedNow = Boolean(fsTree.expanded[node.path]);
					const hovered = hoverKey === node.path;
					// 缩进从根行 0 起，每层 +16；树容器已左移到 tab 左缘。
					const depthPad = row.depth * 16;
					return (0, react_jsx_runtime.jsxs)("div", {
						key: node.path,
						style: { ...S.treeRow, ...S.treeRowClickable, paddingLeft: depthPad, ...(isRoot ? S.treeRootRow : {}), ...(hovered ? S.treeRowHover : {}) },
						title: node.path,
						onClick: () => togglePath(node.path),
						onMouseEnter: () => setHoverKey(node.path),
						onMouseLeave: () => setHoverKey((k) => (k === node.path ? null : k)),
						onContextMenu: (e) => {
							e.preventDefault();
							e.stopPropagation();
							setTreeMenu({
								x: e.clientX,
								y: e.clientY,
								kind: isRoot ? "root" : "dir",
								rel: isRoot ? "" : relPathWithin(fsTree.cwd, node.path, node.name),
							});
						},
						children: [
							(0, react_jsx_runtime.jsx)("span", { style: S.treeCaret, children: expandedNow ? "▾" : "▸" }),
							(0, react_jsx_runtime.jsx)("span", {
								style: { flex: "0 1 auto", overflow: "hidden", textOverflow: "ellipsis", minWidth: 0 },
								children: expandedNow ? `📂 ${node.name}` : `📁 ${node.name}`,
							}),
							node.truncated ? (0, react_jsx_runtime.jsx)("span", { style: S.treeCaret, children: "…" }) : null,
							// 根行行内右侧的「刷新」（013：不占独立一行）。
							isRoot ? (0, react_jsx_runtime.jsx)("span", { style: S.spacer }) : null,
							isRoot ? (0, react_jsx_runtime.jsx)("button", {
								type: "button",
								style: hoverKey === `refresh:${node.path}` ? { ...S.treeRefresh, ...S.treeRefreshHover } : S.treeRefresh,
								disabled: Boolean(fsTree.loading[""]),
								onClick: (e) => {
									// 阻断冒泡，避免触发根行的折叠 toggle。
									e.stopPropagation();
									loadTree(undefined);
								},
								onMouseEnter: () => setHoverKey(`refresh:${node.path}`),
								onMouseLeave: () => setHoverKey((k) => (k === `refresh:${node.path}` ? null : k)),
								children: Boolean(fsTree.loading[""]) ? "读取中…" : "刷新",
							}) : null,
						],
					});
				}
				const entry = row.entry;
				const depthPad = row.depth * 16;
				const isMd = /\.md$/i.test(entry.name);
				const expandedNow = entry.isDir && Boolean(fsTree.expanded[entry.path]);
				const hovered = hoverKey === entry.path;
				const style = {
					...S.treeRow,
					paddingLeft: depthPad,
					...(entry.isDir || isMd ? S.treeRowClickable : {}),
					...(isMd ? S.treeRowMd : entry.isDir ? {} : S.treeRowOther),
					...(entry.hidden ? { opacity: 0.6 } : {}),
					...(hovered ? S.treeRowHover : {}),
				};
				if (entry.isDir) {
					return (0, react_jsx_runtime.jsxs)("div", {
						key: entry.path,
						style,
						title: entry.path,
						onClick: () => toggleDir(entry),
						onMouseEnter: () => setHoverKey(entry.path),
						onMouseLeave: () => setHoverKey((k) => (k === entry.path ? null : k)),
						onContextMenu: (e) => {
							e.preventDefault();
							e.stopPropagation();
							setTreeMenu({
								x: e.clientX,
								y: e.clientY,
								kind: "dir",
								rel: relPathWithin(fsTree.cwd, entry.path, entry.name),
							});
						},
						children: [
							(0, react_jsx_runtime.jsx)("span", { style: S.treeCaret, children: expandedNow ? "▾" : "▸" }),
							(0, react_jsx_runtime.jsx)("span", { style: { overflow: "hidden", textOverflow: "ellipsis", minWidth: 0 }, children: expandedNow ? `📂 ${entry.name}` : `📁 ${entry.name}` }),
						],
					});
				}
				return (0, react_jsx_runtime.jsxs)("div", {
					key: entry.path,
					style,
					title: isMd ? `打开脑图：${entry.path}` : entry.path,
					onClick: isMd ? () => openMindmap(entry) : undefined,
					onMouseEnter: () => setHoverKey(entry.path),
					onMouseLeave: () => setHoverKey((k) => (k === entry.path ? null : k)),
					// 右键：.md 不弹菜单（左键即打开）；非 .md 只拦掉默认菜单。
					onContextMenu: (e) => {
						e.preventDefault();
						e.stopPropagation();
					},
					children: [
						isMd
							? (0, react_jsx_runtime.jsx)("span", { style: S.mdBadge, children: "M" })
							: (0, react_jsx_runtime.jsx)("span", { style: S.fileDot, children: (0, react_jsx_runtime.jsx)("span", { style: S.fileDotCore }) }),
						(0, react_jsx_runtime.jsx)("span", { style: { overflow: "hidden", textOverflow: "ellipsis", minWidth: 0 }, children: entry.name }),
					],
				});
			}

			// 右键菜单（树/tab）：点其它地方/失焦/改窗口即关闭。
			react.useEffect(() => {
				if (!treeMenu && !tabMenu) return;
				const close = () => {
					setTreeMenu(null);
					setTabMenu(null);
				};
				window.addEventListener("click", close);
				window.addEventListener("blur", close);
				window.addEventListener("resize", close);
				return () => {
					window.removeEventListener("click", close);
					window.removeEventListener("blur", close);
					window.removeEventListener("resize", close);
				};
			}, [treeMenu, tabMenu]);

			function renderLoading() {
				return (0, react_jsx_runtime.jsxs)("div", { style: S.loadingWrap, children: [
					(0, react_jsx_runtime.jsxs)("svg", { width: 22, height: 22, viewBox: "0 0 22 22", children: [
						(0, react_jsx_runtime.jsx)("circle", { cx: 11, cy: 11, r: 8, fill: "none", stroke: "var(--dsw-alias-border-l2)", strokeWidth: 2 }),
						(0, react_jsx_runtime.jsx)("circle", {
							cx: 11,
							cy: 11,
							r: 8,
							fill: "none",
							stroke: "var(--dsw-alias-state-business-primary)",
							strokeWidth: 2,
							strokeLinecap: "round",
							strokeDasharray: "12 38",
							children: (0, react_jsx_runtime.jsx)("animateTransform", {
								attributeName: "transform",
								type: "rotate",
								from: "0 11 11",
								to: "360 11 11",
								dur: "0.9s",
								repeatCount: "indefinite",
							}),
						}),
					] }),
					(0, react_jsx_runtime.jsx)("p", { style: S.loadingText, children: "AI 正在打开脑图…" }),
					(0, react_jsx_runtime.jsx)("p", { style: S.emptyHint, children: "若长时间未打开，可直接在聊天里说「打开 <文件名>」" }),
				] });
			}

			function renderTree() {
				const rootLoading = Boolean(fsTree.loading[""]);
				return (0, react_jsx_runtime.jsxs)("div", {
					style: S.treeWrap,
					// 空白处右键 = 在根目录新建（人类操作习惯，013）。
					onContextMenu: (e) => {
						e.preventDefault();
						setTreeMenu({ x: e.clientX, y: e.clientY, kind: "root", rel: "" });
					},
					children: [
						filledHint ? (0, react_jsx_runtime.jsx)("p", { style: S.emptyHint, children: filledHint }) : null,
						fsTree.error ? (0, react_jsx_runtime.jsxs)("p", { style: S.treeError, children: [
							`目录树读取失败：${fsTree.error} `,
							(0, react_jsx_runtime.jsx)("button", {
								type: "button",
								style: S.treeRefresh,
								onClick: () => loadTree(undefined),
								children: "刷新",
							}),
						] }) : null,
						treeRows.length === 0
							? (0, react_jsx_runtime.jsxs)("p", { style: S.empty, children: [
								rootLoading ? "正在读取工作目录…" : "目录树为空。右键空白处新建脑图，或直接对 AI 说「打开一个脑图」。",
								!rootLoading ? (0, react_jsx_runtime.jsx)("button", {
									type: "button",
									style: S.treeRefresh,
									onClick: () => loadTree(undefined),
									children: "刷新",
								}) : null,
							] })
							: (0, react_jsx_runtime.jsx)("div", { style: S.treeList, children: treeRows.map((row) => renderTreeRow(row)) }),
						treeMenu ? (0, react_jsx_runtime.jsxs)("div", {
							style: { ...S.treeMenu, left: treeMenu.x, top: treeMenu.y },
							onContextMenu: (e) => e.preventDefault(),
							children: [
								(0, react_jsx_runtime.jsx)("button", {
									type: "button",
									style: S.treeMenuItem,
									onClick: () => {
										setTreeMenu(null);
										fillDraft(treeMenu.kind === "dir"
											? `我想在 ${treeMenu.rel} 目录里创建一个 Markdown 脑图`
											: "我想创建一个脑图");
									},
									children: treeMenu.kind === "dir" ? "在此目录新建 Markdown 脑图" : "新建 Markdown 脑图",
								}),
							],
						}) : null,
					] });
			}
			//#endregion

			// 014 布局让位：面板打开/拖宽时把宽度写进 CSS 变量，挤窄 #root 推走
			// 聊天区（better-sidebar 同款）；关闭/卸载时移除变量恢复全宽。
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

			if (!open) return null;
			// 014 overlay 外壳：fixed 宿主层（点击穿透）套右缘贴边全高悬浮面板，
			// 左缘拖拽调宽（[280, 视口 80%]，localStorage 持久化）；遮盖聊天区是
			// 该形态的已知代价（作者拍板，见 docs/014）。宿主层挂在 header 槽位里，
			// better-sidebar 同款「fixed 自举」思路。
			return (0, react_jsx_runtime.jsx)("div", { style: S.panelHost, children: (0, react_jsx_runtime.jsxs)("div", { ref: panelRootRef, style: { ...S.overlayRoot, width: panelWidth }, children: [
				(0, react_jsx_runtime.jsx)("div", { style: S.overlayHandle, onMouseDown: startResize }),
				(0, react_jsx_runtime.jsxs)("div", { style: { ...S.header, height: `${headerHeight - 1}px` }, children: [
					(0, react_jsx_runtime.jsxs)("div", { style: S.headerTop, children: [
						(0, react_jsx_runtime.jsx)("span", { style: S.spacer }),
						(0, react_jsx_runtime.jsx)("button", {
							type: "button",
							style: S.action,
							disabled: !tree || exporting || (doc && doc.op === "local"),
							onClick: onExport,
							children: exporting ? "导出中…" : "导出图片",
						}),
						exportError ? (0, react_jsx_runtime.jsx)("span", { style: { color: "var(--dsw-alias-label-error)", fontSize: "12px" } , children: exportError }) : null,
						(0, react_jsx_runtime.jsx)("button", {
							type: "button",
							style: S.action,
							title: "收起脑图面板",
							onClick: () => onClose(),
							children: "✕",
						}),
					] }),
					(0, react_jsx_runtime.jsxs)("div", { style: S.tabRow, children: [
						(0, react_jsx_runtime.jsx)("button", {
							type: "button",
							style: active === TREE_TAB ? { ...S.tab, ...S.tabActive } : (hoverKey === TREE_TAB ? { ...S.tab, ...S.tabHover } : S.tab),
							title: fsTree.cwd ?? "工作目录",
							onClick: () => setView("tree"),
							onMouseEnter: () => setHoverKey(TREE_TAB),
							onMouseLeave: () => setHoverKey((k) => (k === TREE_TAB ? null : k)),
							onContextMenu: (e) => {
								e.preventDefault();
								e.stopPropagation();
								setTabMenu({ x: e.clientX, y: e.clientY, path: TREE_TAB });
							},
							children: "目录",
						}, TREE_TAB),
						shown ? (0, react_jsx_runtime.jsxs)("span", {
							key: shown,
							style: { ...S.tabWrap, ...(active !== TREE_TAB ? S.tabActive : {}), ...(active === TREE_TAB && hoverKey === shown ? S.tabHover : {}) },
							onMouseEnter: () => setHoverKey(shown),
							onMouseLeave: () => setHoverKey((k) => (k === shown ? null : k)),
							onContextMenu: (e) => {
								e.preventDefault();
								e.stopPropagation();
								setTabMenu({ x: e.clientX, y: e.clientY, path: shown });
							},
							children: [
								(0, react_jsx_runtime.jsx)("button", {
									type: "button",
									style: S.tabTitle,
									title: shown,
									onClick: () => setView("mindmap"),
									children: merged.byPath[shown].rootTitle,
								}),
								(0, react_jsx_runtime.jsx)("button", {
									type: "button",
									style: S.tabClose,
									title: "关闭脑图",
									onClick: () => closeMindmap(shown),
									children: "✕",
								}),
							],
						}, shown) : null,
					] }),
				] }),
				// 016：脑图视图走 MindmapCanvas（自带滚动 + 居中 + 右上角缩放控制条），
				// 不再套 S.body（避免嵌套滚动容器与双重 padding）；目录/加载/空态保持原样。
				active === TREE_TAB || (doc && doc.op === "local") || !tree
					? (0, react_jsx_runtime.jsx)("div", { style: S.body, children: active === TREE_TAB
						? renderTree()
						: (doc && doc.op === "local")
							? renderLoading()
							: renderTree() })
					: (0, react_jsx_runtime.jsx)(MindmapCanvas, { node: tree, theme, fitKey: doc && doc.path }),
				tabMenu ? (0, react_jsx_runtime.jsxs)("div", {
					style: { ...S.treeMenu, left: tabMenu.x, top: tabMenu.y },
					onContextMenu: (e) => e.preventDefault(),
					children: [
						(0, react_jsx_runtime.jsx)("button", {
							type: "button",
							style: S.treeMenuItem,
							onClick: () => {
								setTabMenu(null);
								if (tabMenu.path === TREE_TAB) loadTree(undefined);
								else closeMindmap(tabMenu.path);
							},
							children: tabMenu.path === TREE_TAB ? "刷新目录树" : "关闭脑图",
						}),
					],
				}) : null,
			] }) });
		}
		//#endregion



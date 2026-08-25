// Generated source fragment. Edit this file, then run npm run build:client.
		function MindmapSlot(props) {
			const { useSession, sessionId, inputActions, mindmapFace } = props;
			const nodes = useSession ? useSession((s) => (s && s.nodes) || EMPTY_NODES) : EMPTY_NODES;
			// 016 可靠性加固：结构指纹作第二 selector。store 原地改数组（引用
			// 不变）时，nodes prop 不换、memo 命中缓存、auto-open effect 永不
			// 重跑——「AI 打开了脑图但面板不展开」的根因。指纹是原始值字符串，
			// 值比较天然绕过引用相等短路；useSession 不可用时回退空串。
			const nodesVersion = useSession ? useSession((s) => nodesFingerprint((s && s.nodes) || EMPTY_NODES)) : "";
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

		function NodeBox(props) {
			const { node, theme } = props;
			// 015 节点主题：卡片圆角（圆角/直角）+ 颜色主题令牌（根盒/标题用主题色）。
			const tokens = colorThemeTokens(theme && theme.colorTheme);
			const radius = theme && theme.cardStyle === "square" ? 0 : 10;
			const style = node.kind === "root"
				? { ...S.box, ...S.rootBox, borderRadius: radius, borderColor: tokens.rootBorder, background: tokens.rootBg }
				: node.kind === "heading"
					? { ...S.box, ...S.headingBox, borderRadius: radius, color: tokens.heading }
					: node.kind === "placeholder"
						? { ...S.placeholderBox, borderRadius: radius }
						: node.kind === "code"
							? { ...S.box, ...S.codeBox, borderRadius: radius }
							: { ...S.box, borderRadius: radius };
			const title = node.data?.description
				? `${node.topic}\n\n${node.data.description}`
				: node.data?.code
					? `${node.topic}\n\n${node.data.code}`
					: node.topic;
			return (0, react_jsx_runtime.jsx)("div", { style, title, children: node.kind === "placeholder" ? "待填写" : node.topic });
		}

		/** 左→右递归树：节点盒 + 右侧子节点列 + 连线层（015 支持折线/曲线两种线型）。 */
		function TreeRow(props) {
			const { node, theme, onNodeContextMenu } = props;
			const rowRef = react.useRef(null);
			const boxWrapRef = react.useRef(null);
			const childRefs = react.useRef([]);
			// 016：一次测量 = 连线 + 行本地尺寸，单键防抖。坐标全部换算到行
			// 「本地空间」（视觉像素 ÷ 缩放因子，由隐形探针实测），SVG 用
			// viewBox 把用户空间钉在本地空间——CSS zoom 新旧实现都精确对齐，
			// 且 SVG 盒子恒等于行的视觉尺寸（绝不撑出滚动区）。
			const [layout, setLayout] = react.useState({ edges: [], w: 0, h: 0 });
			const prevKeyRef = react.useRef("");
			// 缩放探针：本地 10×10（小于最小节点盒，永不溢出行），visibility
			// 隐藏。getBoundingClientRect 返回 10×zoom → 实测缩放因子。
			const probeRef = react.useRef(null);

			// 测量父盒右缘与各子节点包裹块的几何位置，画连线
			// （折线 = M x1 y1 H midX V y2 H x2；曲线 = 贝塞尔水平切出）；
			// 序列化比对防 setState 循环。
			react.useLayoutEffect(() => {
				const rowEl = rowRef.current;
				const boxEl = boxWrapRef.current;
				const probeEl = probeRef.current;
				if (!rowEl || !boxEl || !probeEl) return;
				const curve = theme && theme.lineStyle === "curve";
				const measure = () => {
					// 探针实测缩放因子（视觉/本地）——与 DOM 当前状态同步，
					// 对 CSS zoom 的新旧实现（渲染期缩放 / used 值缩放）都成立。
					const scale = probeEl.getBoundingClientRect().width / 10 || 1;
					const rowRect = rowEl.getBoundingClientRect();
					const boxRect = boxEl.getBoundingClientRect();
					const next = [];
					for (const ref of childRefs.current) {
						if (!ref) continue;
						const c = ref.getBoundingClientRect();
						// 视觉像素 → 行本地坐标（SVG 用户空间 = 本地空间）。
						const x1 = (boxRect.right - rowRect.left) / scale;
						const y1 = (boxRect.top - rowRect.top + boxRect.height / 2) / scale;
						const x2 = (c.left - rowRect.left) / scale;
						const y2 = (c.top - rowRect.top + c.height / 2) / scale;
						const midX = (x1 + x2) / 2;
						next.push(curve
							? `M ${x1} ${y1} C ${midX} ${y1}, ${midX} ${y2}, ${x2} ${y2}`
							: `M ${x1} ${y1} H ${midX} V ${y2} H ${x2}`);
					}
					const w = rowRect.width / scale;
					const h = rowRect.height / scale;
					const key = `${w.toFixed(2)}x${h.toFixed(2)}|${next.join("|")}`;
					if (prevKeyRef.current === key) return;
					prevKeyRef.current = key;
					setLayout({ edges: next, w, h });
				};
				measure();
				let observer = null;
				if (typeof ResizeObserver !== "undefined") {
					observer = new ResizeObserver(measure);
					observer.observe(rowEl);
					observer.observe(boxEl);
				}
				window.addEventListener("resize", measure);
				return () => {
					if (observer) observer.disconnect();
					window.removeEventListener("resize", measure);
				};
			});

			// 016 点击聚焦标记：row = 该节点的整棵子树边界（盒+子列），node = 节点盒本身；
				// 画布层用事件委托 closest 定位（递归树不逐层传回调）。
				return (0, react_jsx_runtime.jsxs)("div", { ref: rowRef, "data-mindmap-row": "", style: { ...S.row, position: "relative" }, children: [
				// 缩放探针（本地 10×10，隐形，点击穿透）。
				(0, react_jsx_runtime.jsx)("div", { ref: probeRef, style: { position: "absolute", top: 0, left: 0, width: 10, height: 10, visibility: "hidden", pointerEvents: "none" } }),
				layout.edges.length > 0 && layout.w > 0 && layout.h > 0
					? (0, react_jsx_runtime.jsx)("svg", {
						// width/height = 本地尺寸 → 视觉 = 本地×zoom，恒等于行尺寸；
						// viewBox 把用户空间钉在本地空间，路径坐标（本地）精确落位。
						width: layout.w,
						height: layout.h,
						viewBox: `0 0 ${layout.w} ${layout.h}`,
						preserveAspectRatio: "none",
						style: S.edgeLayer,
						children: layout.edges.map((d, i) => (0, react_jsx_runtime.jsx)("path", {
							key: i,
							d,
							stroke: "var(--dsw-alias-border-l2)",
							strokeWidth: 1.5,
							fill: "none",
							// 016：CSS zoom 缩放下 strokeWidth 会被一并缩放，缩小后线变
							// 亚像素、模糊看不清；vectorEffect=non-scaling-stroke 让线宽
							// 保持不变（任何缩放下都是 1.5px 视觉宽度）。
							vectorEffect: "non-scaling-stroke",
						}, i)),
					})
					: null,
				(0, react_jsx_runtime.jsx)("div", {
					ref: boxWrapRef,
					"data-mindmap-node": "",
					style: { flex: "0 0 auto", cursor: "pointer" },
					// 017 节点右键：弹「复制/导出为图片」菜单；stopPropagation 免触
					// 画布空白拦截（空白处只拦默认菜单、不弹自己的）。
					onContextMenu: onNodeContextMenu ? (e) => {
						e.preventDefault();
						e.stopPropagation();
						onNodeContextMenu(e, node);
					} : undefined,
					children: (0, react_jsx_runtime.jsx)(NodeBox, { node, theme }),
				}),
				node.children && node.children.length > 0
					? (0, react_jsx_runtime.jsx)("div", { style: S.childrenColumn, children: node.children.map((child, idx) => (0, react_jsx_runtime.jsx)("div", {
						key: child.id,
						ref: (el) => {
							childRefs.current[idx] = el;
						},
						children: (0, react_jsx_runtime.jsx)(TreeRow, { node: child, theme, onNodeContextMenu }),
					}, child.id)) })
					: null,
				] });
				}

				//#region 016 脑图画布：居中呈现 + 缩放控制（右上角）
				// 缩放契约：范围 [0.25, 3]，每级 ×1.2；适配计算四周留 48px 余量
				//（16px 视觉内距 + 经典滚动条占位，避免「适配→滚动条出现→视口变
				// 窄→再适配」的抖动循环）。
				const ZOOM = { min: 0.25, max: 3, step: 1.2, padding: 48, focusMax: 1 };

				/** 缩放夹取：非有限值/≤0 回退 1，否则夹到 [min, max]。 */
				function clampZoom(value) {
				if (!Number.isFinite(value) || value <= 0) return 1;
				return Math.min(ZOOM.max, Math.max(ZOOM.min, value));
				}

				/** 步进缩放：direction>0 放大（×step），否则缩小（÷step），结果夹取。 */
				function stepZoom(value, direction) {
				const base = clampZoom(value);
				return clampZoom(direction > 0 ? base * ZOOM.step : base / ZOOM.step);
				}

				/** 适配比例：min((view-padding)/tree, 1) 再夹取——小图不放大、巨图夹下限；零/非法尺寸返回 1。 */
				function fitZoom(treeW, treeH, viewW, viewH) {
					if (!(treeW > 0) || !(treeH > 0) || !(viewW > 0) || !(viewH > 0)) return 1;
					return clampZoom(Math.min((viewW - ZOOM.padding) / treeW, (viewH - ZOOM.padding) / treeH, 1));
				}

				/**
				 * 子树聚焦比例：适配整棵子树（区别于全局适配，允许放大到 focusMax），
				 * 叶子/小子树不会怼脸、巨子树夹下限；零/非法尺寸返回 1。
				 */
				function focusZoom(treeW, treeH, viewW, viewH) {
					if (!(treeW > 0) || !(treeH > 0) || !(viewW > 0) || !(viewH > 0)) return 1;
					return clampZoom(Math.min((viewW - ZOOM.padding) / treeW, (viewH - ZOOM.padding) / treeH, ZOOM.focusMax));
				}

				/**
				* 脑图画布：滚动区（canvasScroll）+ 居中层（canvasCenter，100%/max-content
				* 双下限）+ 缩放内容（margin:auto + CSS zoom）。zoom 用 CSS zoom 而非
				* transform:scale——它影响布局，滚动范围随缩放自动正确；TreeRow 连线是
				* getBoundingClientRect 相对测量，父子同因子缩放，几何保持一致。
				* 打开（fitKey=文档路径）时自动测量并应用适配比例；用户未手动缩放前
				* ResizeObserver 持续再适配（AI 编辑改树尺寸、面板拖宽）；手动缩放后以
				* 用户为准，点「适配」或切换文档恢复自动。缩放时记录视口中心并按比例
				* 修正 scroll，视图不跳变（内容回到视口内时浏览器会自动钳制回 0）。
				*/
				function MindmapCanvas(props) {
							const { node, theme, fitKey } = props;
							const scrollRef = react.useRef(null);
							const contentRef = react.useRef(null);
							const zoomRef = react.useRef(1);
							const userZoomedRef = react.useRef(false);
							const anchorRef = react.useRef(null);
							// 016：上次适配时的脑图自然尺寸（getBoundingClientRect / 当前 zoom）。
							// ResizeObserver 回调里对比当前自然尺寸，差异 ≤ 2px 视为「滚动条抖动」
							// 引发的同树再测，跳过避免「适配→横向滚动条出现→视口变窄→再适配」
							// 的 33%/34%/30% 不停跳变。
							const lastNaturalRef = react.useRef(null);
						// 016 点击聚焦：记录待定位的节点盒元素。zoom 生效后的 [zoom]
						// layout effect 里量新布局，把节点滚到「水平 25% / 垂直居中」。
						const focusRef = react.useRef(null);
						// 016 已提交 zoom：DOM 真正渲染到的缩放值（[zoom] layout effect
						// 里同步）。zoomRef 可能领先于渲染提交（setState 异步），测量
						// 一律除以 committed——否则「新 zoom ÷ 旧尺寸」得到错误自然
						// 尺寸，适配值来回跳、停不下来（跳闪根源）。
						const committedZoomRef = react.useRef(1);
						// 016 熔断器：观察器触发的适配时间戳。1.5s 内第 5 次 → 判定
						// 反馈循环，自动停手（保险丝，任何未知循环都最多闪几下）。
						const fitStampRef = react.useRef([]);
							const [zoom, setZoomState] = react.useState(1);
							const [hover, setHover] = react.useState(null);
							// 017 节点右键菜单：{x, y, node}；null = 关闭。busy = "copy" |
							// "export" 表示对应动作进行中（两项都禁用），error 展示失败原因。
							const [nodeMenu, setNodeMenu] = react.useState(null);
							const [nodeMenuBusy, setNodeMenuBusy] = react.useState(null);
							const [nodeMenuError, setNodeMenuError] = react.useState("");
							const nodeMenuRef = react.useRef(null);

							// 测量并适配：自然尺寸 = getBoundingClientRect ÷ 已提交 zoom（与
							// DOM 实际状态严格同步，无竞态）。值不变不动 state（bail-out），
							// 值变化才重置滚动到原点让树回到居中；同步记录自然尺寸供防抖。
							function applyFit() {
								const scroller = scrollRef.current;
								const content = contentRef.current;
								if (!scroller || !content) return;
								const rect = content.getBoundingClientRect();
								if (!(rect.width > 0) || !(rect.height > 0)) return;
								const committed = committedZoomRef.current;
								const naturalW = rect.width / committed;
								const naturalH = rect.height / committed;
								lastNaturalRef.current = { w: naturalW, h: naturalH };
								const fit = fitZoom(naturalW, naturalH, scroller.clientWidth, scroller.clientHeight);
								zoomRef.current = fit;
								if (fit !== committed) {
									scroller.scrollLeft = 0;
									scroller.scrollTop = 0;
									setZoomState(fit);
								}
							}

							// 挂载 / 文档切换：清除「用户已手动缩放」标记与熔断计数，
							// 布局稳定后（rAF）适配一次。
							react.useLayoutEffect(() => {
								userZoomedRef.current = false;
								lastNaturalRef.current = null;
								fitStampRef.current = [];
								const id = requestAnimationFrame(applyFit);
								return () => cancelAnimationFrame(id);
							}, [fitKey]);

							// 内容 / 画布尺寸变化（AI 编辑、面板拖宽）→ 未手动缩放则再适配。
							// 区分触发源：仅内容变化（多为 zoom 引发的重排）时对比自然尺寸
							// （÷ 已提交 zoom），差异 ≤ 2px 视为「滚动条抖动/亚像素重测」跳过；
							// 画布变化（拖宽、滚动条出现）正常再适配。熔断器兜底：1.5s 内
							// 第 5 次观察器适配 → 判定循环，自动停手（点适配/切文档可恢复）。
							react.useEffect(() => {
								const scroller = scrollRef.current;
								const content = contentRef.current;
								if (!scroller || !content || typeof ResizeObserver === "undefined") return;
								const observer = new ResizeObserver((entries) => {
									if (userZoomedRef.current) return;
									const scrollerChanged = entries.some((e) => e.target === scroller);
									if (!scrollerChanged) {
										const last = lastNaturalRef.current;
										if (last) {
											const rect = content.getBoundingClientRect();
											const w = rect.width / committedZoomRef.current;
											const h = rect.height / committedZoomRef.current;
											if (Math.abs(w - last.w) <= 2 && Math.abs(h - last.h) <= 2) return;
										}
									}
									const now = Date.now();
									const stamps = fitStampRef.current = fitStampRef.current.filter((t) => now - t < 1500);
									if (stamps.length >= 5) {
										userZoomedRef.current = true;
										return;
									}
									stamps.push(now);
									applyFit();
								});
								observer.observe(content);
								observer.observe(scroller);
								return () => observer.disconnect();
							}, []);

				function setZoom(next, anchorViewport) {
					const value = clampZoom(next);
					anchorRef.current = anchorViewport && scrollRef.current
						? { prevZoom: zoomRef.current, scrollLeft: scrollRef.current.scrollLeft, scrollTop: scrollRef.current.scrollTop }
						: null;
					zoomRef.current = value;
					setZoomState(value);
				}

				// 用户缩放后保持视口中心稳定：内容坐标按 new/old 比例缩放，scroll 同步修正。
				// fit 路径 anchorRef 为 null，不锚定。
				react.useLayoutEffect(() => {
					// DOM 已提交到该 zoom，测量换算基准同步（applyFit 依赖）。
					committedZoomRef.current = zoom;
					if (focusRef.current) {
						positionFocus();
						return;
					}
					const scroller = scrollRef.current;
					const anchor = anchorRef.current;
					if (!scroller || !anchor) return;
					anchorRef.current = null;
					const ratio = anchor.prevZoom > 0 ? zoom / anchor.prevZoom : 1;
					if (!(ratio > 0) || ratio === 1) return;
					scroller.scrollLeft = (anchor.scrollLeft + scroller.clientWidth / 2) * ratio - scroller.clientWidth / 2;
					scroller.scrollTop = (anchor.scrollTop + scroller.clientHeight / 2) * ratio - scroller.clientHeight / 2;
				}, [zoom]);

				function zoomIn() {
					userZoomedRef.current = true;
					setZoom(stepZoom(zoomRef.current, 1), true);
				}

				function zoomOut() {
					userZoomedRef.current = true;
					setZoom(stepZoom(zoomRef.current, -1), true);
				}

				function refit() {
					userZoomedRef.current = false;
					fitStampRef.current = [];
					applyFit();
				}

				// 016 点击节点聚焦：节点滚到「垂直居中、水平约 25%」（树向右生长，
				// 左侧锚点让子级铺满右侧视野），缩放比例取 focusZoom（整棵子树适配、
				// 上限 focusMax）。事件委托：closest 找节点盒与所在子树 row，无需给
				// 递归 TreeRow 传回调。聚焦视为用户手动缩放（停自动再适配）。
				function onCanvasClick(e) {
					const target = e.target;
					if (!target || typeof target.closest !== "function") return;
					const boxEl = target.closest("[data-mindmap-node]");
					if (!boxEl || !boxEl.isConnected) return;
					const rowEl = boxEl.closest("[data-mindmap-row]");
					if (!rowEl) return;
					const scroller = scrollRef.current;
					if (!scroller) return;
					const current = zoomRef.current;
					const rowRect = rowEl.getBoundingClientRect();
					const focus = focusZoom(rowRect.width / current, rowRect.height / current, scroller.clientWidth, scroller.clientHeight);
					userZoomedRef.current = true;
					focusRef.current = { boxEl };
					if (focus !== current) {
						anchorRef.current = null;
						zoomRef.current = focus;
						setZoomState(focus);
					} else {
						positionFocus();
					}
				}

				// 聚焦定位：DOM 更新后量节点盒当前位置，滚动增量 = 当前位置 − 期望位置
				//（scroll 增量与视口位移 1:1，浏览器自动钳制滚动范围；比例不变时同步调用）。
				function positionFocus() {
					const focus = focusRef.current;
					focusRef.current = null;
					const scroller = scrollRef.current;
					if (!scroller || !focus || !focus.boxEl || !focus.boxEl.isConnected) return;
					const boxRect = focus.boxEl.getBoundingClientRect();
					const scrollerRect = scroller.getBoundingClientRect();
					const curX = boxRect.left + boxRect.width / 2 - scrollerRect.left;
					const curY = boxRect.top + boxRect.height / 2 - scrollerRect.top;
					scroller.scrollLeft += curX - scroller.clientWidth * 0.25;
					scroller.scrollTop += curY - scroller.clientHeight / 2;
				}

				// 017 右键菜单开合：点其它地方/失焦/改窗口即关闭（目录树菜单同款）；
				// 点菜单内部（复制/导出按钮）不关——菜单里要展示「复制中…」与失败
				// 原因。节点右键经 stopPropagation 不会触发这里的 contextmenu 关闭，
				// 空白处右键则顺带收掉旧菜单。文档内容变化（树重解析、节点对象
				// 失效）也关闭，防导出过期子树。
				react.useEffect(() => {
					if (!nodeMenu) return;
					const close = (e) => {
						if (e && e.type === "click" && nodeMenuRef.current && e.target && nodeMenuRef.current.contains(e.target)) return;
						setNodeMenu(null);
					};
					window.addEventListener("click", close);
					window.addEventListener("blur", close);
					window.addEventListener("resize", close);
					window.addEventListener("contextmenu", close);
					return () => {
						window.removeEventListener("click", close);
						window.removeEventListener("blur", close);
						window.removeEventListener("resize", close);
						window.removeEventListener("contextmenu", close);
					};
				}, [nodeMenu]);
				react.useEffect(() => {
					setNodeMenu(null);
				}, [node]);

				// 017 右键节点：记录菜单锚点与目标子树（清掉上次的忙碌/错误态）。
				function onNodeContextMenu(e, target) {
					setNodeMenuBusy(null);
					setNodeMenuError("");
					setNodeMenu({ x: e.clientX, y: e.clientY, node: target });
				}

				// 017 菜单动作：copy = PNG 写系统剪贴板（可粘贴到聊天/文档）；
				// export = PNG 下载为文件。范围 = 该节点及其全部子孙
				//（buildExportSvg 以任意节点为根重排布局，根样式随深度判定）。
				async function onNodeMenuAction(mode) {
					const target = nodeMenu && nodeMenu.node;
					if (!target || nodeMenuBusy) return;
					setNodeMenuBusy(mode);
					setNodeMenuError("");
					try {
						if (mode === "copy") await copyPng(target);
						else await exportPng(target, target.topic);
						setNodeMenu(null);
					} catch (error) {
						setNodeMenuError(String(error?.message ?? error));
					} finally {
						setNodeMenuBusy(null);
					}
				}

				// 边界反馈：到达上下限时对应按钮置灰（fit 值与边界精确相等时也命中）。
				const atMin = zoom <= ZOOM.min;
				const atMax = zoom >= ZOOM.max;
				const zoomBtnStyle = (key, disabled) => (disabled
					? { ...S.zoomBtn, ...S.zoomBtnDisabled }
					: (hover === key ? { ...S.zoomBtn, ...S.zoomBtnHover } : S.zoomBtn));

				return (0, react_jsx_runtime.jsxs)("div", {
					style: S.canvasWrap,
					// 017 空白处/缩放条右键只拦浏览器默认菜单（节点右键已 stopPropagation）。
					onContextMenu: (e) => e.preventDefault(),
					children: [
					(0, react_jsx_runtime.jsx)("div", { ref: scrollRef, style: S.canvasScroll, onClick: onCanvasClick, children:
						(0, react_jsx_runtime.jsx)("div", { style: S.canvasCenter, children:
							(0, react_jsx_runtime.jsx)("div", { ref: contentRef, style: { margin: "auto", zoom }, children:
								(0, react_jsx_runtime.jsx)(TreeRow, { node, theme, onNodeContextMenu })
							})
						})
					}),
					(0, react_jsx_runtime.jsxs)("div", { style: S.zoomBar, children: [
						(0, react_jsx_runtime.jsx)("button", {
							type: "button",
							title: "缩小",
							style: zoomBtnStyle("out", atMin),
							disabled: atMin,
							onClick: zoomOut,
							onMouseEnter: () => setHover("out"),
							onMouseLeave: () => setHover((h) => (h === "out" ? null : h)),
							children: "−",
						}),
						(0, react_jsx_runtime.jsx)("span", { style: S.zoomLabel, children: `${Math.round(zoom * 100)}%` }),
						(0, react_jsx_runtime.jsx)("button", {
							type: "button",
							title: "放大",
							style: zoomBtnStyle("in", atMax),
							disabled: atMax,
							onClick: zoomIn,
							onMouseEnter: () => setHover("in"),
							onMouseLeave: () => setHover((h) => (h === "in" ? null : h)),
							children: "+",
						}),
						(0, react_jsx_runtime.jsx)("button", {
							type: "button",
							title: "适配画布（重新计算合适比例）",
							style: hover === "fit" ? { ...S.zoomFitBtn, ...S.zoomBtnHover } : S.zoomFitBtn,
							onClick: refit,
							onMouseEnter: () => setHover("fit"),
							onMouseLeave: () => setHover((h) => (h === "fit" ? null : h)),
							children: "适配",
						}),
					] }),
					// 017 节点右键菜单：标题行（节点主题）+ 复制/导出两动作 + 错误行。
					// 复用目录树菜单容器样式（fixed 定位，left/top = 视口坐标）。
					nodeMenu ? (0, react_jsx_runtime.jsxs)("div", {
						ref: nodeMenuRef,
						style: { ...S.treeMenu, left: nodeMenu.x, top: nodeMenu.y },
						onContextMenu: (e) => e.preventDefault(),
						children: [
							(0, react_jsx_runtime.jsx)("div", {
								style: S.nodeMenuHeader,
								title: nodeMenu.node.topic || "待填写",
								children: truncateForExport(nodeMenu.node.topic, 18) || "待填写",
							}),
							(0, react_jsx_runtime.jsx)("button", {
								type: "button",
								style: nodeMenuBusy ? { ...S.treeMenuItem, ...S.treeMenuItemDisabled } : S.treeMenuItem,
								disabled: Boolean(nodeMenuBusy),
								title: "把该节点及其全部子孙渲染为 PNG 并复制到剪贴板",
								onClick: () => onNodeMenuAction("copy"),
								children: nodeMenuBusy === "copy" ? "复制中…" : "复制为图片",
							}),
							(0, react_jsx_runtime.jsx)("button", {
								type: "button",
								style: nodeMenuBusy ? { ...S.treeMenuItem, ...S.treeMenuItemDisabled } : S.treeMenuItem,
								disabled: Boolean(nodeMenuBusy),
								title: "把该节点及其全部子孙渲染为 PNG 并下载为文件",
								onClick: () => onNodeMenuAction("export"),
								children: nodeMenuBusy === "export" ? "导出中…" : "导出为图片",
							}),
							nodeMenuError ? (0, react_jsx_runtime.jsx)("p", { style: S.nodeMenuError, children: nodeMenuError }) : null,
						],
					}) : null,
				] });
				}
				//#endregion




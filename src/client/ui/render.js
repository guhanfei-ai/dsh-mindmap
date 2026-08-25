// Generated source fragment. Edit this file, then run npm run build:client.
		function NodeBox(props) {
			const { node, theme, revealDelay } = props;
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
			// 018 生长动画：动画挂在内层节点盒（外层被连线测量，不能带 transform）。
			if (revealDelay !== undefined) style.animationDelay = `${revealDelay}ms`;
			const title = node.data?.description
				? `${node.topic}\n\n${node.data.description}`
				: node.data?.code
					? `${node.topic}\n\n${node.data.code}`
					: node.topic;
			return (0, react_jsx_runtime.jsx)("div", {
				style,
				title,
				className: revealDelay !== undefined ? "dsh-mm-reveal" : undefined,
				children: node.kind === "placeholder" ? "待填写" : node.topic,
			});
		}

		/** 左→右递归树：节点盒 + 右侧子节点列 + 连线层（015 支持折线/曲线两种线型）。 */
		function TreeRow(props) {
			const { node, theme, onNodeContextMenu, reveal } = props;
			// 018 生长动画：本节点渐显延迟（新节点盒）与本行连线渐显延迟（有新子节点）。
			const revealDelay = reveal && reveal.nodes ? reveal.nodes.get(node.id) : undefined;
			const edgeRevealDelay = reveal && reveal.edges ? reveal.edges.get(node.id) : undefined;
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
						style: edgeRevealDelay !== undefined ? { ...S.edgeLayer, animationDelay: `${edgeRevealDelay}ms` } : S.edgeLayer,
						// 018：新子节点出现时连线同步浮现（延迟 = 最早新子节点的错峰）。
						className: edgeRevealDelay !== undefined ? "dsh-mm-edge-reveal" : undefined,
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
					children: (0, react_jsx_runtime.jsx)(NodeBox, { node, theme, revealDelay }),
				}),
				node.children && node.children.length > 0
					? (0, react_jsx_runtime.jsx)("div", { style: S.childrenColumn, children: node.children.map((child, idx) => (0, react_jsx_runtime.jsx)("div", {
						key: child.id,
						ref: (el) => {
							childRefs.current[idx] = el;
						},
						children: (0, react_jsx_runtime.jsx)(TreeRow, { node: child, theme, onNodeContextMenu, reveal }),
					}, child.id)) })
					: null,
				] });
				}

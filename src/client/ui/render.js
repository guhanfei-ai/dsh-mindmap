// Generated source fragment. Edit this file, then run npm run build:client.
		function MindmapSlot(props) {
			const { useSession, sessionId, inputActions, mindmapFace } = props;
			const nodes = useSession ? useSession((s) => (s && s.nodes) || EMPTY_NODES) : EMPTY_NODES;
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
			const { node, theme } = props;
			const rowRef = react.useRef(null);
			const boxWrapRef = react.useRef(null);
			const childRefs = react.useRef([]);
			const [edges, setEdges] = react.useState([]);
			const prevEdgesRef = react.useRef("");

			// 测量父盒右缘与各子节点包裹块的几何位置，画连线
			// （折线 = M x1 y1 H midX V y2 H x2；曲线 = 贝塞尔水平切出）；
			// 序列化比对防 setState 循环。
			react.useLayoutEffect(() => {
				const rowEl = rowRef.current;
				const boxEl = boxWrapRef.current;
				if (!rowEl || !boxEl) return;
				const curve = theme && theme.lineStyle === "curve";
				const measure = () => {
					const rowRect = rowEl.getBoundingClientRect();
					const boxRect = boxEl.getBoundingClientRect();
					const next = [];
					for (const ref of childRefs.current) {
						if (!ref) continue;
						const c = ref.getBoundingClientRect();
						const x1 = boxRect.right - rowRect.left;
						const y1 = boxRect.top - rowRect.top + boxRect.height / 2;
						const x2 = c.left - rowRect.left;
						const y2 = c.top - rowRect.top + c.height / 2;
						const midX = (x1 + x2) / 2;
						next.push(curve
							? `M ${x1} ${y1} C ${midX} ${y1}, ${midX} ${y2}, ${x2} ${y2}`
							: `M ${x1} ${y1} H ${midX} V ${y2} H ${x2}`);
					}
					const key = next.join("|");
					if (prevEdgesRef.current === key) return;
					prevEdgesRef.current = key;
					setEdges(next);
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

			return (0, react_jsx_runtime.jsxs)("div", { ref: rowRef, style: { ...S.row, position: "relative" }, children: [
				edges.length > 0
					? (0, react_jsx_runtime.jsx)("svg", {
						style: S.edgeLayer,
						children: edges.map((d, i) => (0, react_jsx_runtime.jsx)("path", {
							key: i,
							d,
							stroke: "var(--dsw-alias-border-l2)",
							strokeWidth: 1.5,
							fill: "none",
						}, i)),
					})
					: null,
				(0, react_jsx_runtime.jsx)("div", { ref: boxWrapRef, style: { flex: "0 0 auto" }, children: (0, react_jsx_runtime.jsx)(NodeBox, { node, theme }) }),
				node.children && node.children.length > 0
					? (0, react_jsx_runtime.jsx)("div", { style: S.childrenColumn, children: node.children.map((child, idx) => (0, react_jsx_runtime.jsx)("div", {
						key: child.id,
						ref: (el) => {
							childRefs.current[idx] = el;
						},
						children: (0, react_jsx_runtime.jsx)(TreeRow, { node: child, theme }),
					}, child.id)) })
					: null,
			] });
		}




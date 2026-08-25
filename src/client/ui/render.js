// Generated source fragment. Edit this file, then run npm run build:client.
		//#region 019 血肉渲染：行内格式 + 大一统链接 + 表格块（规范源：003）
		// 行内格式统一扫描序：图片/链接 → 行内代码 → 粗体 → 删除线 → 斜体 → 裸链接。
		// 先命中先生效，裸链接放最后，避免吞掉已被 [文字](url) 消费的 URL。
		const INLINE_PATTERN = /(!?\[[^\]]*\]\([^)]*\))|(`[^`]+`)|(\*\*[^*]+\*\*)|(~~[^~]+~~)|(\*[^*\s][^*]*\*)|(https?:\/\/[^\s)]+)/g;

		/** 大一统链接点击：在机器浏览器打开（新标签页），不触发画布聚焦缩放。 */
		function openLink(event, url) {
			event.preventDefault();
			event.stopPropagation();
			try {
				window.open(url, "_blank", "noopener");
			} catch {
				// 宿主环境拦截时退化为浏览器默认行为（不静默吞链接）。
				event.defaultPrevented = false;
			}
		}

		/**
		 * 零依赖行内渲染器：任何块（文本/Markdown/列表/表格单元格）的内容都走这里。
		 * 链接完整呈现、永不缩减（缩减=阉割信息，003 §7）；无预览、无加载态。
		 * 返回 React 子节点数组（无格式时原样返回字符串）。
		 */
		function renderInline(text, keyPrefix) {
			const source = String(text ?? "");
			INLINE_PATTERN.lastIndex = 0;
			const out = [];
			let last = 0;
			let k = 0;
			let m;
			while ((m = INLINE_PATTERN.exec(source)) !== null) {
				if (m.index > last) out.push(source.slice(last, m.index));
				const token = m[0];
				const key = `${keyPrefix || "i"}-${k++}`;
				if (m[1]) {
					// [文字](url) 或 ![alt](url)。图片块暂缓（003 §9）：图语法退化为
					// 指向原图的链接，同时把 alt 与原图地址都完整呈现（不缩减）。
					const parsed = /^(!?)\[([^\]]*)\]\(([^)]*)\)$/.exec(token);
					// 普通链接标签取文字（无文字显地址）；图语法带 alt 时两者都完整呈现。
					const label = parsed[1]
						? (parsed[2] ? `${parsed[2]} (${parsed[3]})` : parsed[3])
						: (parsed[2] || parsed[3]);
					out.push((0, react_jsx_runtime.jsx)("a", {
						key,
						href: parsed[3],
						target: "_blank",
						rel: "noopener noreferrer",
						style: S.inlineLink,
						title: parsed[3],
						onClick: (e) => openLink(e, parsed[3]),
						children: label,
					}, key));
				} else if (m[2]) {
					out.push((0, react_jsx_runtime.jsx)("code", { key, style: S.inlineCode, children: token.slice(1, -1) }, key));
				} else if (m[3]) {
					out.push((0, react_jsx_runtime.jsx)("strong", { key, children: token.slice(2, -2) }, key));
				} else if (m[4]) {
					out.push((0, react_jsx_runtime.jsx)("s", { key, children: token.slice(2, -2) }, key));
				} else if (m[5]) {
					out.push((0, react_jsx_runtime.jsx)("em", { key, children: token.slice(1, -1) }, key));
				} else {
					// 裸链接：完整显示、可点击。
					out.push((0, react_jsx_runtime.jsx)("a", {
						key,
						href: token,
						target: "_blank",
						rel: "noopener noreferrer",
						style: S.inlineLink,
						title: token,
						onClick: (e) => openLink(e, token),
						children: token,
					}, key));
				}
				last = m.index + token.length;
			}
			if (last < source.length) out.push(source.slice(last));
			return out.length > 1 || (out.length === 1 && typeof out[0] !== "string") ? out : source;
		}

		/** 表格块渲染：完整网格（全量行列、单元格内换行、表头加重），单元格不拆。 */
		function renderTableBlock(node) {
			const rows = (node.data && node.data.rows) || [];
			if (rows.length === 0) return renderInline(node.topic, node.id);
			return (0, react_jsx_runtime.jsx)("div", { style: S.tableWrap, children: (0, react_jsx_runtime.jsx)("table", { style: S.tableGrid, children: (0, react_jsx_runtime.jsx)("tbody", { children: rows.map((row, ri) => (0, react_jsx_runtime.jsx)("tr", { children: row.map((cell, ci) => (0, react_jsx_runtime.jsx)(ri === 0 ? "th" : "td", {
				style: ri === 0 ? { ...S.tableCell, ...S.tableHeaderCell } : S.tableCell,
				children: renderInline(cell, `${node.id}-${ri}-${ci}`),
			}, ci)) }, ri)) }) }) });
		}
		//#endregion

		function NodeBox(props) {
			const { node, theme, revealDelay, selectedId, onCodePanel } = props;
			const [hovered, setHovered] = react.useState(false);
			const boxRef = react.useRef(null);
			// 020 长度治理：散文类块（text/md/list/quote）套 6 行截断；clamped = 实测
			// 真的溢出了（scrollHeight>clientHeight），悬停浮层看全文（复用代码浮层）。
			const isProse = node.kind === "text" || node.kind === "md" || node.kind === "list" || node.kind === "quote";
			const [clamped, setClamped] = react.useState(false);
			react.useLayoutEffect(() => {
				const el = boxRef.current;
				if (!el || !isProse) {
					if (clamped) setClamped(false);
					return;
				}
				const overflow = el.scrollHeight > el.clientHeight + 1;
				if (overflow !== clamped) setClamped(overflow);
			}, [node.topic, node.kind]);
			// 019 皮肤层：颜色/圆角/阴影/状态全部由 resolveNodeStyle 纯函数生成。
			const style = {
				...S.box,
				...(isProse ? S.boxClamp : null),
				...resolveNodeStyle(node, {
					colorTheme: theme && theme.colorTheme,
					cardStyle: theme && theme.cardStyle,
					states: { hovered, selected: selectedId === node.id },
				}),
			};
			// 018 生长动画：动画挂在内层节点盒（外层被连线测量，不能带 transform）。
			if (revealDelay !== undefined) style.animationDelay = `${revealDelay}ms`;

			function handleEnter() {
				setHovered(true);
				// 019 代码块 / 020 截断散文块：盒内紧凑，悬停浮起面板看全文（003 §5.3）。
				if ((node.kind === "code" || clamped) && onCodePanel && boxRef.current) {
					onCodePanel({ node, anchor: boxRef.current.getBoundingClientRect() });
				}
			}
			function handleLeave() {
				setHovered(false);
				if ((node.kind === "code" || clamped) && onCodePanel) onCodePanel(null);
			}

			const children = node.kind === "placeholder"
				? "待填写"
				: node.kind === "table"
					? renderTableBlock(node)
					: renderInline(node.topic, node.id);
			// 截断块的全文走浮层，原生 title 气泡会与之重复，故截断时不挂 title。
			const title = node.kind === "code" ? `${node.topic}\n\n（悬停看全文）` : clamped ? undefined : node.topic;
			return (0, react_jsx_runtime.jsx)("div", {
				ref: boxRef,
				style,
				title,
				className: revealDelay !== undefined ? "dsh-mm-reveal" : undefined,
				onMouseEnter: handleEnter,
				onMouseLeave: handleLeave,
				children,
			});
		}

		/** 左→右递归树：节点盒 + 右侧子节点列 + 连线层（015 支持折线/曲线两种线型）。 */
		function TreeRow(props) {
			const { node, theme, onNodeContextMenu, reveal, selectedId, onCodePanel } = props;
			// 018 生长动画：本节点渐显延迟（新节点盒）与本行连线渐显延迟（有新子节点）。
			const revealDelay = reveal && reveal.nodes ? reveal.nodes.get(node.id) : undefined;
			const edgeRevealDelay = reveal && reveal.edges ? reveal.edges.get(node.id) : undefined;
			// 019 连线外观走令牌（皮肤层），不再硬编码。
			const overrides = COLOR_THEMES[theme && theme.colorTheme] || COLOR_THEMES.ocean;
			const connectorColor = resolveToken("connector.color", overrides);
			const connectorWidth = resolveToken("connector.width", overrides);
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
							stroke: connectorColor,
							strokeWidth: connectorWidth,
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
					// 019：节点 id 挂在盒包裹上，画布点击聚焦时据此记选中态。
					"data-mindmap-node-id": node.id,
					style: { flex: "0 0 auto", cursor: "pointer" },
					// 017 节点右键：弹「复制/导出为图片」菜单；stopPropagation 免触
					// 画布空白拦截（空白处只拦默认菜单、不弹自己的）。
					onContextMenu: onNodeContextMenu ? (e) => {
						e.preventDefault();
						e.stopPropagation();
						onNodeContextMenu(e, node);
					} : undefined,
					children: (0, react_jsx_runtime.jsx)(NodeBox, { node, theme, revealDelay, selectedId, onCodePanel }),
				}),
				node.children && node.children.length > 0
					? (0, react_jsx_runtime.jsx)("div", { style: S.childrenColumn, children: node.children.map((child, idx) => (0, react_jsx_runtime.jsx)("div", {
						key: child.id,
						ref: (el) => {
							childRefs.current[idx] = el;
						},
						children: (0, react_jsx_runtime.jsx)(TreeRow, { node: child, theme, onNodeContextMenu, reveal, selectedId, onCodePanel }),
					}, child.id)) })
					: null,
				] });
				}

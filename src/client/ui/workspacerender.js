// Generated source fragment. Edit this file, then run npm run build:client.
	//#region 026 工作区渲染：壳无关的内容（头部 tab 行 + 导出 + 画布/树/加载态）
	// 027 内嵌头部视觉对齐：variant="sidebar" 时 Better Sidebar 外层已有 Tab 头部，
	// 内嵌只保留一行紧凑工具栏——「脑图列表」标签 + 当前脑图标签 + 导出图片按钮
	//（导出在行尾，不再独占一行）。variant="standalone" 时保持原双层头部（headerTop
	// spacer + 导出 + 关闭 → tabRow）不变。
	// 不可见时仍挂载（hooks 已在上文跑完），只跳过 JSX——auto-open effect
	// 在 visible=false 时仍能调 onAutoOpen 把壳拉起。
	if (!visible) return null;
	// headerHeight 由独立 fixed 壳传入（对齐聊天头部底部分隔线）；
	// BS Tab 模式传 null → 头部高度自适应（Better Sidebar 管自己的外壳）。
	const wsHeaderStyle = headerHeight != null ? { ...S.header, height: `${headerHeight - 1}px` } : S.header;

	// 027 导出按钮（两种模式共用）：disabled 语义 = 无树 / 导出中 / 本地占位。
	const exportBtn = (0, react_jsx_runtime.jsx)("button", {
		type: "button",
		style: S.action,
		disabled: !tree || exporting || (doc && doc.op === "local"),
		onClick: onExport,
		children: exporting ? "导出中…" : "导出图片",
	});
	const exportErrorSpan = exportError
		? (0, react_jsx_runtime.jsx)("span", { style: { color: "var(--dsw-alias-label-error)", fontSize: "12px" }, children: exportError })
		: null;

	// 027 目录/列表标签文案：sidebar 模式叫「脑图列表」，standalone 模式叫「目录」。
	const treeTabLabel = variant === "sidebar" ? "脑图列表" : "目录";

	if (variant === "sidebar") {
		// 027 sidebar 模式：单行紧凑工具栏。BS 外层已有 Tab 头部与关闭按钮，
		// 内嵌不再加重复外壳标题或关闭按钮。
		return (0, react_jsx_runtime.jsxs)("div", { style: S.sbRoot, children: [
			(0, react_jsx_runtime.jsxs)("div", { style: S.sbToolbar, children: [
				(0, react_jsx_runtime.jsx)("button", {
					type: "button",
					style: active === TREE_TAB ? { ...S.sbTab, ...S.sbTabActive } : (hoverKey === TREE_TAB ? { ...S.sbTab, ...S.tabHover } : S.sbTab),
					title: fsTree.cwd ?? "工作目录",
					onClick: () => setView("tree"),
					onMouseEnter: () => setHoverKey(TREE_TAB),
					onMouseLeave: () => setHoverKey((k) => (k === TREE_TAB ? null : k)),
					onContextMenu: (e) => {
						e.preventDefault();
						e.stopPropagation();
						setTabMenu({ x: e.clientX, y: e.clientY, path: TREE_TAB });
					},
					children: treeTabLabel,
				}, TREE_TAB),
				shown ? (0, react_jsx_runtime.jsxs)("span", {
					key: shown,
					style: { ...S.sbTabWrap, ...(active !== TREE_TAB ? S.sbTabActive : {}), ...(active === TREE_TAB && hoverKey === shown ? S.tabHover : {}) },
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
							style: S.sbTabTitle,
							title: shown,
							onClick: () => setView("mindmap"),
							children: merged.byPath[shown].rootTitle,
						}),
						(0, react_jsx_runtime.jsx)("button", {
							type: "button",
							style: S.sbTabClose,
							title: "关闭脑图",
							onClick: () => closeMindmap(shown),
							children: "✕",
						}),
					],
				}, shown) : null,
				// 导出按钮 + 错误推到行尾。
				(0, react_jsx_runtime.jsx)("span", { style: S.spacer }),
				exportErrorSpan,
				exportBtn,
			] }),
			// 016：脑图视图走 MindmapCanvas（自带滚动 + 居中 + 右上角缩放控制条），
			// 不再套 S.body（避免嵌套滚动容器与双重 padding）；目录/加载/空态保持原样。
			active === TREE_TAB || (doc && doc.op === "local") || !tree
				? (0, react_jsx_runtime.jsx)("div", { style: S.body, children: active === TREE_TAB
					? renderTree()
					: (doc && doc.op === "local")
						? renderLoading()
						: renderTree() })
				: (0, react_jsx_runtime.jsx)(MindmapCanvas, { node: tree, theme, fitKey: doc && doc.path, reveal }),
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
						children: tabMenu.path === TREE_TAB ? "刷新脑图列表" : "关闭脑图",
					}),
				],
			}) : null,
		] });
	}

	// 027 standalone 模式：原双层头部（headerTop spacer + 导出 + 关闭 → tabRow）不变。
	const wsHeaderChildren = [
		(0, react_jsx_runtime.jsxs)("div", { style: S.headerTop, children: [
			(0, react_jsx_runtime.jsx)("span", { style: S.spacer }),
			exportBtn,
			exportErrorSpan,
			// 关闭按钮：仅独立 fixed 壳提供 onClose（BS Tab 自带关闭）。
			onClose ? (0, react_jsx_runtime.jsx)("button", {
				type: "button",
				style: S.action,
				title: "收起脑图面板",
				onClick: () => onClose(),
				children: "✕",
			}) : null,
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
				children: treeTabLabel,
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
	];
	return (0, react_jsx_runtime.jsxs)("div", { style: { display: "flex", flexDirection: "column", flex: "1 1 auto", minHeight: 0 }, children: [
		(0, react_jsx_runtime.jsx)("div", { style: wsHeaderStyle, children: wsHeaderChildren }),
		// 016：脑图视图走 MindmapCanvas（自带滚动 + 居中 + 右上角缩放控制条），
		// 不再套 S.body（避免嵌套滚动容器与双重 padding）；目录/加载/空态保持原样。
		active === TREE_TAB || (doc && doc.op === "local") || !tree
			? (0, react_jsx_runtime.jsx)("div", { style: S.body, children: active === TREE_TAB
				? renderTree()
				: (doc && doc.op === "local")
					? renderLoading()
					: renderTree() })
			: (0, react_jsx_runtime.jsx)(MindmapCanvas, { node: tree, theme, fitKey: doc && doc.path, reveal }),
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
	] });
	}
	//#endregion

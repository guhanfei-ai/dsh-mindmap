// Generated source fragment. Edit this file, then run npm run build:client.
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
			] }) });
		}
		//#endregion

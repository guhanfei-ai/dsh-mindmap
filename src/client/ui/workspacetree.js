// Generated source fragment. Edit this file, then run npm run build:client.
			//#region 013 目录树 tab：懒加载树 + 把指令填进聊天输入框
			// 草稿保护：确实读到非空草稿才让路（改走剪贴板），读不到就按既有
			// 行为直填直发——宿主不暴露草稿时不能把功能整个卡死。
			function draftBlocked() {
				return draftBlocksAutoSend(inputActions);
			}

			function submitChatCommand(text) {
				if (draftBlocked()) return false;
				if (!inputActions || typeof inputActions.setDraft !== "function" || typeof inputActions.submit !== "function") return false;
				try {
					inputActions.setDraft(text);
					inputActions.submit();
					return true;
				} catch {
					return false;
				}
			}

			// 手动新建指令同样不覆盖已有草稿；否则填入输入框。
			function fillDraft(text) {
				try {
					if (!draftBlocked() && inputActions && typeof inputActions.setDraft === "function") {
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
				// 有未发送草稿：不建占位、不抢输入框，改把指令交给用户自己发。
				if (draftBlocked()) {
					if (typeof navigator !== "undefined" && navigator.clipboard && typeof navigator.clipboard.writeText === "function") {
						navigator.clipboard.writeText(text).catch(() => {});
						setFilledHint("检测到未发送的草稿，已保留；打开指令已复制到剪贴板，粘贴发送即可");
					} else {
						setFilledHint(`检测到未发送的草稿，已保留。请手动发送：${text}`);
					}
					return;
				}
				// 016：记录点击时刻的错误基线（errorByPath 与 latestError 的全部
				// 事件键）——只有其后新出现的错误才归因本次打开，旧错误不打扰。
				localErrorBaseRef.current = errorEventKeys(merged);
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
				if (submitChatCommand(text)) {
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

			/** 016 加载态恢复：错误/超时后重试——重发打开指令并重启看门狗。 */
			function retryOpen() {
				if (!doc || doc.op !== "local") return;
				// openMindmap 无条件重发指令、重建本地占位（新 doc 引用 → 看门狗
				// 重启），并重建错误基线（当前错误已含其中，不会重复弹出）。
				openMindmap({ path: doc.path, name: `${stemOf(doc.path)}.md` });
			}

			// 拉取一层目录（path 缺省 = 会话 cwd 根）。host 路由 /mindmap/api/tree
			// 只读；返回 {path, cwd, entries:[{name,path,isDir,hidden}], truncated}。
			// 返回 true/false 供调用方决定是否标记展开（失败时不要把目录标成已展开）。
			async function loadTree(path) {
				const generation = treeGenerationRef.current;
				const key = path === undefined || path === null ? "" : path;
				setFsTree((prev) => ({ ...prev, loading: { ...prev.loading, [key]: true }, error: null }));
				try {
					if (!mindmapFace || typeof mindmapFace.listTree !== "function") throw new Error("目录树能力不可用");
					const listing = await mindmapFace.listTree(sessionId, typeof path === "string" && path ? path : undefined);
					if (generation !== treeGenerationRef.current) return false;
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
					return true;
				} catch (error) {
					if (generation !== treeGenerationRef.current) return false;
					setFsTree((prev) => ({ ...prev, loading: { ...prev.loading, [key]: false }, error: String(error?.message ?? error) }));
					return false;
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
				// 加载失败不标记展开：箭头/子项状态与真实数据保持一致。
				if (!fsTree.nodes[entry.path]) {
					const ok = await loadTree(entry.path);
					if (!ok) return;
				}
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
				treeGenerationRef.current += 1;
				if (!sessionId) return;
				setFsTree({ nodes: {}, expanded: {}, loading: {}, cwd: null, error: null });
				loadTree(undefined);
			}, [sessionId]);

			const treeRows = react.useMemo(
				() => visibleTreeRows(fsTree.nodes, fsTree.expanded),
				[fsTree.nodes, fsTree.expanded],
			);

			// 内嵌文件夹使用 14px 线框图标，Markdown 使用 M 徽标。
			// 独立目录继续使用原有 emoji / M 徽标。
			function sidebarTreeIcon(folder, expanded = false) {
				const outline = folder
					? (expanded ? "M2 6V3h4l2 2h4v2M2 6h11l-2 6H1z" : "M1.5 3h4l2 2h5v7h-11z")
					: "M3 1.5h5l3 3V12.5H3z M8 1.5v3h3";
				return (0, react_jsx_runtime.jsx)("svg", {
					width: 14, height: 14, viewBox: "0 0 14 14", fill: "none",
					stroke: "currentColor", strokeWidth: 1, strokeLinejoin: "round", strokeLinecap: "round",
					style: { flex: "none" }, "aria-hidden": true, focusable: "false",
					children: (0, react_jsx_runtime.jsx)("path", { d: outline }),
				});
			}
			function directoryLabel(name, expanded) {
				return (0, react_jsx_runtime.jsx)("span", {
					style: { flex: "0 1 auto", overflow: "hidden", textOverflow: "ellipsis", minWidth: 0 },
					children: variant === "sidebar" ? name : `${expanded ? "📂" : "📁"} ${name}`,
				});
			}
			function blockFileInteraction(event) {
				event.preventDefault();
				event.stopPropagation();
			}

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
							variant === "sidebar" ? sidebarTreeIcon(true, expandedNow) : null,
							directoryLabel(node.name, expandedNow),
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
				const inactiveFile = variant === "sidebar" && !entry.isDir && !isMd;
				const expandedNow = entry.isDir && Boolean(fsTree.expanded[entry.path]);
				const hovered = !inactiveFile && hoverKey === entry.path;
				const style = {
					...S.treeRow,
					paddingLeft: depthPad,
					...(entry.isDir || isMd ? S.treeRowClickable : {}),
					...(isMd ? S.treeRowMd : entry.isDir ? {} : S.treeRowOther),
					...(entry.hidden ? { opacity: 0.6 } : {}),
					...(hovered ? S.treeRowHover : {}),
					...(inactiveFile ? { userSelect: "none" } : {}),
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
							variant === "sidebar" ? sidebarTreeIcon(true, expandedNow) : null,
							directoryLabel(entry.name, expandedNow),
						],
					});
				}
				return (0, react_jsx_runtime.jsxs)("div", {
					key: entry.path,
					style,
					title: inactiveFile ? undefined : isMd ? `打开脑图：${entry.path}` : entry.path,
					"aria-disabled": inactiveFile ? true : undefined,
					draggable: inactiveFile ? false : undefined,
					// 纯展示文件仍接住事件，避免穿透到宿主或空白处的新建菜单。
					onClick: inactiveFile ? blockFileInteraction : isMd ? () => openMindmap(entry) : undefined,
					onDoubleClick: inactiveFile ? blockFileInteraction : undefined,
					onMouseDown: inactiveFile ? blockFileInteraction : undefined,
					onDragStart: inactiveFile ? blockFileInteraction : undefined,
					onMouseEnter: inactiveFile ? undefined : () => setHoverKey(entry.path),
					onMouseLeave: inactiveFile ? undefined : () => setHoverKey((k) => (k === entry.path ? null : k)),
					// 右键：.md 不弹菜单（左键即打开）；非 .md 只拦掉默认菜单。
					onContextMenu: (e) => {
						e.preventDefault();
						e.stopPropagation();
					},
					children: [
						variant === "sidebar" ? (0, react_jsx_runtime.jsx)("span", { style: S.treeCaret, "aria-hidden": true }) : null,
						isMd
							? (0, react_jsx_runtime.jsx)("span", { style: S.mdBadge, "aria-hidden": true, children: "M" })
							: variant === "sidebar" ? sidebarTreeIcon(false)
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
				// 016 三态流转：加载中 →（错误 | 超时）——错误优先于超时；失败态
				// 提供「重试」一键重发打开指令（openMindmap 同款通路 + 降级链）。
				const failed = Boolean(docError) || openTimedOut;
				const message = docError
					? `AI 打开失败：${docError.message}`
					: openTimedOut
						? "等待 AI 打开超时（约 30 秒无结果）"
						: "AI 正在打开脑图…";
				return (0, react_jsx_runtime.jsxs)("div", { style: S.loadingWrap, children: [
					failed
						? (0, react_jsx_runtime.jsx)("span", { style: S.loadingFailMark, children: "⚠" })
						: (0, react_jsx_runtime.jsxs)("svg", { width: 22, height: 22, viewBox: "0 0 22 22", children: [
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
					(0, react_jsx_runtime.jsx)("p", { style: failed ? S.loadingErrorText : S.loadingText, children: message }),
					failed
						? (0, react_jsx_runtime.jsx)("button", {
							type: "button",
							style: S.retryBtn,
							onClick: retryOpen,
							children: "重试打开",
						})
						: null,
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

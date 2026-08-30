// Generated source fragment. Edit this file, then run npm run build:client.
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

				//#region 021 画布平移：拖拽手势（中键 / 空白处左键 / 空格+左键）
				// 平移契约（三条手指路径，覆盖鼠标与 Mac 触摸板）：
				//   中键拖动        —— 画布惯例，任何位置都拖（压节点上也拖）
				//   左键空白处拖动  —— Mac 触摸板「按住拖」= 左键拖拽，走这条
				//   空格 + 左键拖动 —— 压在节点上也能拖（节点上留文字选区给左键）
				// 方向：内容跟手（按下点始终贴着指针），故 scroll = 按下时 scroll − 位移。
				// 阈值 4px 以内算「点击」：不写 scroll（手抖不挪画布）、不上抓手光标、
				// 不吞随后的 click——保留点空白取消选中 / 点节点聚焦的既有行为。
				// 触摸（触屏）不劫持——交给原生滚动，保住惯性。
				const PAN = { threshold: 4 };

				/** 是否在该指针按下上启动平移。button: 0 左 / 1 中 / 2 右。 */
				function shouldStartPan(button, options) {
					const { onNode = false, spaceHeld = false, touch = false } = options || {};
					if (touch) return false;
					if (button === 1) return true;
					if (button !== 0) return false;
					if (spaceHeld) return true;
					return !onNode;
				}

				/** 平移一步：目标 scroll = 按下时 scroll − 位移；moved 表示已越过点击阈值。 */
				function panScroll(start, dx, dy, threshold) {
					const limit = Number.isFinite(threshold) ? threshold : PAN.threshold;
					return {
						scrollLeft: start.scrollLeft - dx,
						scrollTop: start.scrollTop - dy,
						moved: Math.abs(dx) >= limit || Math.abs(dy) >= limit,
					};
				}

				/** 空格键是否落在可输入元素里（聊天框/输入框与面板同 document，不能抢空格）。 */
				function isTextEntry(el) {
					if (!el || typeof el.tagName !== "string") return false;
					const tag = el.tagName.toLowerCase();
					return tag === "input" || tag === "textarea" || el.isContentEditable === true;
				}

				/** 空格键是否落在「空格即激活」的控件上（按钮/链接/自定义控件）。
				 *  这类元素上不能 preventDefault，否则挡掉空格激活。 */
				function isActivatable(el) {
					if (!el || typeof el.closest !== "function") return false;
					return Boolean(el.closest("button, a[href], [role='button'], input, textarea, select, [contenteditable='true']"));
				}
				//#endregion

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
							const { node, theme, fitKey, reveal } = props;
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
							// 019 选中态：点击聚焦的节点下选选中环（002 §6 状态体系）。
							const [selectedId, setSelectedId] = react.useState(null);
							// 019 代码块悬停浮层：{node, anchor}；null = 关闭。延迟关闭（150ms
							// 宽限）让鼠标能从节点盒移到面板上滚动全文，不闪灭。
							const [codePanel, setCodePanel] = react.useState(null);
							const codePanelTimerRef = react.useRef(null);
							function handleCodePanel(panel) {
								if (codePanelTimerRef.current) {
									clearTimeout(codePanelTimerRef.current);
									codePanelTimerRef.current = null;
								}
								if (panel) {
									setCodePanel(panel);
									return;
								}
								codePanelTimerRef.current = setTimeout(() => setCodePanel(null), 150);
							}

							// 021 画布平移锚点：本次拖拽按下时的指针与 scroll。刻意不用
							// state——平移起止若触发重渲染，每个 TreeRow 的 useLayoutEffect
							// 都要重测一遍（O(n) 强制重排），大树上拖一下会明显顿一下。
							// 光标与「禁用选中」直接改 DOM style，全程零重渲染。
							const panRef = react.useRef(null);
							// 021 空格键：按下时左键在节点上也能拖。同样用 ref（按空格不该重渲染）。
							const spaceRef = react.useRef(false);
						// 021 拖过就吞掉随后那次 click（保留单击空白取消选中 / 点节点聚焦）。
						const suppressClickRef = react.useRef(false);
						// 021 指针是否悬在画布上（空格键要不要拦默认行为的门控；纯
						// 读取，不参与渲染）。
						const hoverRef = react.useRef(false);

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

				// 021 空格键跟踪：指针悬在画布上时按住空格 → 左键可拖画布（画布惯例）。
				// 输入框/聊天框里按空格不抢；窗口失焦即松开，防「卡在按住态」。
				// 悬停门控（hoverRef）用于决定要不要拦空格的默认行为——全局拦会把
				// 聊天区的「空格翻页」一起干掉，只拦「指针在画布上」这一刻才安全。
				react.useEffect(() => {
					const isSpace = (e) => e.code === "Space" || e.key === " ";
					const onKeyDown = (e) => {
						if (!isSpace(e) || isTextEntry(e.target)) return;
						spaceRef.current = true;
						// 悬在画布上、且不在按钮/链接上：掐掉空格滚动宿主页面。
						if (hoverRef.current && !isActivatable(e.target)) e.preventDefault();
					};
					const onKeyUp = (e) => {
						if (!isSpace(e)) return;
						spaceRef.current = false;
					};
					const onBlur = () => {
						spaceRef.current = false;
					};
					window.addEventListener("keydown", onKeyDown);
					window.addEventListener("keyup", onKeyUp);
					window.addEventListener("blur", onBlur);
					return () => {
						window.removeEventListener("keydown", onKeyDown);
						window.removeEventListener("keyup", onKeyUp);
						window.removeEventListener("blur", onBlur);
					};
				}, []);

				// 021 平移三件套：按下记锚点 → 移动按差值写 scroll → 松手收尾。
				// 用 pointer 事件 + setPointerCapture：指针滑出画布（甚至滑出面板）
				// 仍跟手，不必在 window 上挂监听。
				function applyPanCursor(scroller, active) {
					scroller.style.cursor = active ? "grabbing" : "grab";
					scroller.style.userSelect = active ? "none" : "";
				}

				function beginPan(e) {
					// 吞 click 的标记一律在本轮手势的最开头清零，放在所有早退之前：
					// 否则上轮手势留下的 true 会粘到下一次点击上——例：拖完画布后再
					// 触摸点按（touch 路径不启动平移就早退了），那次点击会被白吞一次。
					suppressClickRef.current = false;
					const scroller = scrollRef.current;
					if (!scroller || panRef.current) return;
					const target = e.target;
					const onNode = Boolean(target && typeof target.closest === "function" && target.closest("[data-mindmap-node]"));
					if (!shouldStartPan(e.button, { onNode, spaceHeld: spaceRef.current, touch: e.pointerType === "touch" })) return;
					// 中键：掐掉浏览器自动滚动；左键：掐掉拖选文本。
					e.preventDefault();
					panRef.current = {
						pointerId: e.pointerId,
						x: e.clientX,
						y: e.clientY,
						scrollLeft: scroller.scrollLeft,
						scrollTop: scroller.scrollTop,
						moved: false,
					};
					// 不在按下就上抓手光标：普通点击（位移 < 阈值）不该闪一下
					// grabbing、也不该提前锁掉文本选择——等真正越过阈值再上。
					if (e.pointerId != null && typeof scroller.setPointerCapture === "function") {
						try { scroller.setPointerCapture(e.pointerId); } catch { /* 捕获失败：退化为元素内拖拽，movePan 有兜底 */ }
					}
				}

				function movePan(e) {
					const pan = panRef.current;
					const scroller = scrollRef.current;
					if (!pan || !scroller) return;
					// 多指针（触屏/笔）下第二根指头的移动不该驱动第一根指头的锚点。
					if (e.pointerId != null && pan.pointerId != null && e.pointerId !== pan.pointerId) return;
					// 兜底：捕获失败退化为元素内拖拽时，指针在滚动区外松手就收不到
					// pointerup，panRef 会悬挂 → 之后不按键移动也会拖画布。无按键
					// 还在动说明早已松手，直接收尾（触摸进不了平移，不会误伤）。
					if (e.buttons === 0) {
						endPan();
						return;
					}
					const step = panScroll(pan, e.clientX - pan.x, e.clientY - pan.y, PAN.threshold);
					// 阈值内不写 scroll：点击手抖 1~3px 不该把画布挪走。公式是从按下
					// 锚点算的绝对值（非增量），跳过早期写入仍保持 1:1 跟手。
					if (!pan.moved && !step.moved) return;
					// 首次越过阈值：这才算拖拽——上抓手光标 + 锁文本选择。
					if (!pan.moved) applyPanCursor(scroller, true);
					if (step.moved) pan.moved = true;
					// 越界交给浏览器钳制（不自己算 scrollWidth，省一次重排）。
					scroller.scrollLeft = step.scrollLeft;
					scroller.scrollTop = step.scrollTop;
				}

				function endPan() {
					const pan = panRef.current;
					// 已收尾（pointerup 后浏览器会补发 lostpointercapture）→ 不再动手，
					// 否则会把 suppressClickRef 清掉、平移后误触发 click。
					if (!pan) return;
					panRef.current = null;
					const scroller = scrollRef.current;
					if (scroller) {
						applyPanCursor(scroller, false);
						if (pan.pointerId != null && typeof scroller.releasePointerCapture === "function") {
							try { scroller.releasePointerCapture(pan.pointerId); } catch { /* 已释放 */ }
						}
					}
					suppressClickRef.current = pan.moved;
				}

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
					// 021：刚拖过画布（平移）的这次 click 不是点击，直接吞掉——
					// 否则每次平移松手都会顺手把选中环清掉。
					if (suppressClickRef.current) {
						suppressClickRef.current = false;
						return;
					}
					const target = e.target;
					if (!target || typeof target.closest !== "function") return;
					const boxEl = target.closest("[data-mindmap-node]");
					if (!boxEl || !boxEl.isConnected) {
						// 019 空白处点击：取消选中环（链接点击已 stopPropagation，不走这里）。
						setSelectedId(null);
						return;
					}
					// 019：聚焦同时记选中态（盒包裹上挂了 data-mindmap-node-id）。
					setSelectedId(boxEl.getAttribute("data-mindmap-node-id"));
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
					// 019：文档内容变化时同步收掉代码浮层（节点对象已失效）。
					setCodePanel(null);
				}, [node]);

				// 017 右键节点：记录菜单锚点与目标子树（清掉上次的忙碌/错误态）。
				function onNodeContextMenu(e, target) {
					setNodeMenuBusy(null);
					setNodeMenuError("");
					setNodeMenu({ x: e.clientX, y: e.clientY, node: target });
				}

				// 017 菜单动作：text = 节点全文写剪贴板（020）；copy = PNG 写系统剪贴板
				// （可粘贴到聊天/文档）；export = PNG 下载为文件。图片范围 = 该节点
				// 及其全部子孙（buildExportSvg 以任意节点为根重排布局，根样式随深度判定）。
				async function onNodeMenuAction(mode) {
					const target = nodeMenu && nodeMenu.node;
					if (!target || nodeMenuBusy) return;
					setNodeMenuBusy(mode);
					setNodeMenuError("");
					try {
						if (mode === "text") await copyPlainText(nodeFullText(target));
						else if (mode === "copy") await copyPng(target, theme && theme.colorTheme);
						else await exportPng(target, target.topic, theme && theme.colorTheme);
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
					(0, react_jsx_runtime.jsx)("div", {
						ref: scrollRef,
						style: S.canvasScroll,
						onClick: onCanvasClick,
						// 021 画布平移：pointer 三件套 + 捕获，指针滑出画布仍跟手。
						onPointerDown: beginPan,
						onPointerMove: movePan,
						onPointerUp: endPan,
						// 系统手势打断（如三指滑动）与捕获丢失都走同一收尾。
						onPointerCancel: endPan,
						onLostPointerCapture: endPan,
						// 中键松开的 auxclick：掐掉自动滚动 / 剪贴板粘贴等默认行为。
						onAuxClick: (e) => {
							if (e.button === 1) e.preventDefault();
						},
						// 021 悬停门控：空格键只在指针悬在画布上时才拦默认行为。
						onPointerEnter: () => { hoverRef.current = true; },
						onPointerLeave: () => { hoverRef.current = false; },
						// 平移中掐掉原生 HTML5 拖拽（拖文字/图片会抢走手势）。
						onDragStart: (e) => {
							if (panRef.current) e.preventDefault();
						},
						children: 
						(0, react_jsx_runtime.jsx)("div", { style: S.canvasCenter, children: 
							(0, react_jsx_runtime.jsx)("div", { ref: contentRef, style: { margin: "auto", zoom }, children: 
								(0, react_jsx_runtime.jsx)(TreeRow, { node, theme, onNodeContextMenu, reveal, selectedId, onCodePanel: handleCodePanel })
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
					// 017 节点右键菜单：标题行（节点主题）+ 复制全文/复制为图片/导出为
					// 图片三动作 + 错误行。复用目录树菜单容器样式（fixed 定位，left/top = 视口坐标）。
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
							// 020：标题与动作项之间拉一根分隔线。
							(0, react_jsx_runtime.jsx)("div", { style: S.nodeMenuDivider }),
							(0, react_jsx_runtime.jsx)("button", {
								type: "button",
								style: nodeMenuBusy ? { ...S.treeMenuItem, ...S.treeMenuItemDisabled } : S.treeMenuItem,
								disabled: Boolean(nodeMenuBusy),
								title: "把该节点自身内容的完整文本复制到剪贴板（截断块/代码块/表格块均取全文）",
								onClick: () => onNodeMenuAction("text"),
								children: nodeMenuBusy === "text" ? "复制中…" : "复制全文",
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
					// 019 代码块 / 020 截断散文块 悬停浮层：position:fixed 挂在画布外层
					// （不进 zoom 内容，不影响行测量）。恒贴节点盒右侧——溢出视口右缘
					// 也不翻左（翻左会盖住左侧内容、位置跳）：用户点节点自动聚焦，
					// 节点进视口后再悬停即看全（020 作者拍板）。可滚动全文；代码走等宽
					// pre，散文走等线 pre-wrap 且行内链接可点。
					codePanel ? (() => {
						const panelH = 340;
						const anchor = codePanel.anchor || { left: 0, right: 0, top: 0 };
						const left = anchor.right + 8;
						const top = Math.min(anchor.top, Math.max(8, window.innerHeight - panelH - 8));
						const pnode = codePanel.node;
						const isCode = pnode.kind === "code";
						const label = isCode
							? ((pnode.data && pnode.data.lang) || "code")
							: `${({ text: "文本块", md: "Markdown 块", list: "列表块", quote: "引用块" })[pnode.kind] || pnode.kind} · 全文`;
						return (0, react_jsx_runtime.jsxs)("div", {
							style: { ...(isCode ? S.codePanel : S.textPanel), left, top },
							onMouseLeave: () => handleCodePanel(null),
							children: [
								(0, react_jsx_runtime.jsx)("p", { style: S.codePanelLang, children: label }),
								isCode
									? (0, react_jsx_runtime.jsx)("pre", { style: S.codePanelCode, children: (pnode.data && pnode.data.code) || "" })
									: (0, react_jsx_runtime.jsx)("div", { style: S.textPanelBody, children: renderInline(pnode.topic, `panel-${pnode.id}`) }),
							],
						});
					})() : null,
				] });
				}
				//#endregion

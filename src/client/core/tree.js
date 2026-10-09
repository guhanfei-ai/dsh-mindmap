// Generated source fragment. Edit this file, then run npm run build:client.
		//#region 目录树 tab：懒加载节点表 → 可见行（013）
		/** 条目路径 → 相对工作目录（cwd 外/异常退回条目名）。 */
		function relPathWithin(cwd, path, fallbackName) {
			const base = String(cwd ?? "").replace(/[\\/]+$/, "").replace(/\\/g, "/");
			const s = String(path ?? "").replace(/\\/g, "/");
			if (!base) return fallbackName || s;
			if (s === base) return "";
			if (s.startsWith(`${base}/`)) return s.slice(base.length + 1);
			return fallbackName || s;
		}

		/**
		 * 把懒加载节点表压成可见行列表（先序遍历）。
		 * nodes: { path → {path, name, parentPath, entries, truncated} }；
		 * expanded: { path → true }。根 = parentPath 为 null 的节点。
		 * 目录只渲染一次：已加载且展开 → 节点行（递归子条目）；否则 → entry 行。
		 * 返回 [{kind:"dir", node, depth} | {kind:"entry", entry, depth}]。
		 */
		function visibleTreeRows(nodes, expanded) {
			const rootPath = Object.keys(nodes ?? {}).find((p) => nodes[p]?.parentPath === null);
			if (!rootPath) return [];
			const rows = [];
			const walk = (path, depth) => {
				const node = nodes[path];
				if (!node) return;
				rows.push({ kind: "dir", node, depth });
				if (!expanded?.[path]) return;
				for (const entry of node.entries ?? []) {
					if (entry.isDir && nodes[entry.path] && expanded?.[entry.path]) {
						// 已加载且展开：只走节点行，避免与 entry 行重复渲染。
						walk(entry.path, depth + 1);
					} else {
						rows.push({ kind: "entry", entry, depth: depth + 1 });
					}
				}
			};
			walk(rootPath, 0);
			return rows;
		}
		//#endregion

		//#region 036 脑图收件箱：默认目录的显示文案与新建入口（纯函数）
		const DEFAULT_MINDMAP_DIR = ".mindmaps";
		const DEFAULT_MINDMAP_DIR_LABEL = "脑图收件箱（.mindmaps）";

		/** 目录树显示名：点号目录看着像工具残留，收件箱给一句人话（真实路径仍在 title 上）。 */
		function treeDirLabel(name) {
			const raw = String(name ?? "");
			return raw === DEFAULT_MINDMAP_DIR ? DEFAULT_MINDMAP_DIR_LABEL : raw;
		}

		/** 新建入口文案：有目录上下文就写进那个目录，没有才交给默认收件箱。 */
		function treeCreateDraft(relDirectory) {
			const dir = String(relDirectory ?? "").trim();
			return dir
				? `我想在 ${dir} 目录里创建一个 Markdown 脑图`
				: `我想新建一个脑图，按默认命名放进 ${DEFAULT_MINDMAP_DIR} 脑图收件箱`;
		}

		function treeCreateLabel(relDirectory) {
			return String(relDirectory ?? "").trim() ? "在此目录新建 Markdown 脑图" : "在脑图收件箱新建脑图";
		}
		//#endregion

		//#region 025 草稿保护：正式输入快照优先，旧宿主动作面兜底
		function draftStateOf(inputActions, readInputState) {
			try {
				if (typeof readInputState === "function") return readInputState() ?? null;
				if (typeof inputActions?.getState === "function") return inputActions.getState() ?? null;
			} catch { return null; }
			return null;
		}

		/**
		 * 新宿主的 useInput 提供 draft/attachmentIds；动作对象不提供读取方法。
		 * readInputState 在发送时读取最新快照，避免异步打开期间覆盖后来输入的内容。
		 */
		function readDraftText(inputActions, readInputState) {
			const state = draftStateOf(inputActions, readInputState);
			if (typeof state?.draft === "string") return state.draft;
			// 正式快照存在但不可读时，不能把旧动作对象误当作空草稿。
			if (typeof readInputState === "function") return null;
			try {
				if (typeof inputActions?.getDraft === "function") return String(inputActions.getDraft() ?? "");
				if (typeof inputActions?.draft === "string") return inputActions.draft;
			} catch {
				return null;
			}
			return null;
		}

		/**
		 * 文字、引用和附件都属于未发送内容。未知状态同样保留输入；目录直读
		 * 不依赖自动发送，旧宿主仍可打开文件，指令走剪贴板/手动发送。
		 */
		function draftBlocksAutoSend(inputActions, readInputState) {
			const state = draftStateOf(inputActions, readInputState);
			const draft = readDraftText(inputActions, readInputState);
			const attachmentsUnknown = typeof readInputState === "function" && !Array.isArray(state?.attachmentIds);
			return draft === null || attachmentsUnknown || draft.trim() !== "" || (Array.isArray(state?.attachmentIds) && state.attachmentIds.length > 0);
		}

		/** 037 节点焦点消息：保护现有草稿后，原子地写入并提交到当前 DSH 对话。 */
		function submitNodeFocusMessage(inputActions, text, readInputState) {
			if (!inputActions || typeof inputActions.setDraft !== "function" || typeof inputActions.submit !== "function") {
				throw new Error("当前对话不支持自动发送节点焦点消息");
			}
			if (draftBlocksAutoSend(inputActions, readInputState)) {
				throw new Error("当前聊天框有未发送内容，或暂时无法读取草稿；请保留并处理后再围绕节点聊天");
			}
			inputActions.setDraft(String(text ?? ""));
			inputActions.submit();
			return true;
		}
		//#endregion

		//#region 025 子树折叠：画布视图态纯函数（不进 markdown 资产，只影响呈现）
		/** 折叠集合切换：恒返回新集合，React 状态可直接按引用比较。 */
		function toggleCollapsed(collapsed, id) {
			const next = new Set(collapsed ?? []);
			if (next.has(id)) next.delete(id);
			else next.add(id);
			return next;
		}

		/** 子孙节点总数：折叠后用于提示「隐藏了多少节点」。 */
		function countDescendants(node) {
			let total = 0;
			const walk = (n) => {
				for (const child of n.children ?? []) {
					total += 1;
					walk(child);
				}
			};
			if (node) walk(node);
			return total;
		}

		/**
		 * 丢弃当前树里已不存在的折叠 id（AI 改写文档后旧 id 会失效）。
		 * 没有变化时原样返回入参，避免制造新引用触发多余重渲染。
		 */
		function pruneCollapsed(collapsed, tree) {
			if (!collapsed || collapsed.size === 0) return collapsed;
			const ids = collectTreeIds(tree);
			let changed = false;
			const next = new Set();
			for (const id of collapsed) {
				if (ids.has(id)) next.add(id);
				else changed = true;
			}
			return changed ? next : collapsed;
		}
		//#endregion

		//#region 035 节点搜索：命中计算 / 下标步进 / 命中保持 / 祖先展开（纯函数，经 internals 供测试）
		/**
		 * 在当前树里搜节点可见文字（topic）：大小写不敏感子串匹配，先序遍历
		 * 返回命中节点 id 列表（含根）。空/纯空白查询返回空数组。不搜整个
		 * workspace、不做正则/模糊——第一版只要简单可靠。
		 */
		function searchTreeMatches(tree, query) {
			const q = String(query ?? "").trim().toLowerCase();
			if (!q) return [];
			const out = [];
			const walk = (node) => {
				if (!node) return;
				if (String(node.topic ?? "").toLowerCase().includes(q)) out.push(node.id);
				for (const child of node.children ?? []) walk(child);
			};
			walk(tree);
			return out;
		}

		/**
		 * 下标步进（delta = +1 下一个 / −1 上一个），双向环绕（末尾→开头、
		 * 开头→末尾）。当前下标越界（AI 改写后命中列表已变）先归零再步进；
		 * 无命中返回 −1。
		 */
		function stepMatchIndex(index, count, delta) {
			if (!(count > 0)) return -1;
			const base = Number.isInteger(index) && index >= 0 && index < count ? index : 0;
			const step = delta >= 0 ? 1 : -1;
			return (base + step + count) % count;
		}

		/**
		 * 命中列表重算后的当前项保持（AI 更改 mindmap 后）：优先按稳定结构 id
		 * 找回原命中节点；找不到则钳制到最近的有效下标；再不行回落第一个。
		 * 无命中返回 −1。返回值是 matches 里的下标。
		 */
		function reconcileActiveMatch(prevId, prevIndex, matches) {
			if (!Array.isArray(matches) || matches.length === 0) return -1;
			if (prevId != null) {
				const idx = matches.indexOf(prevId);
				if (idx >= 0) return idx;
			}
			if (Number.isInteger(prevIndex) && prevIndex >= 0 && prevIndex < matches.length) return prevIndex;
			return 0;
		}

		/**
		 * 定位命中前展开其祖先路径：把「根 → 目标」链上的折叠 id 全部移出
		 *（不含目标自身——自身折叠只藏子树，盒子仍可见），无关折叠保留。
		 * 无需变化 / 目标不存在时原样返回入参集合（引用不变，React 免重渲染）。
		 */
		function expandAncestorsFor(collapsed, tree, nodeId) {
			if (!collapsed || collapsed.size === 0 || !tree || nodeId == null) return collapsed;
			const ancestors = [];
			const walk = (node, chain) => {
				if (!node) return false;
				if (node.id === nodeId) {
					for (const id of chain) ancestors.push(id);
					return true;
				}
				for (const child of node.children ?? []) {
					if (walk(child, chain.concat(node.id))) return true;
				}
				return false;
			};
			walk(tree, []);
			if (!ancestors.some((id) => collapsed.has(id))) return collapsed;
			const next = new Set(collapsed);
			for (const id of ancestors) next.delete(id);
			return next;
		}
		//#endregion

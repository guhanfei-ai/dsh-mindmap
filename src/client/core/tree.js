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

		//#region 025 草稿保护：能力探测（宿主是否让插件读到聊天草稿）
		/**
		 * 读取当前聊天草稿。宿主契约只保证 setDraft/submit，读取面属可选能力：
		 * 逐个探测已知形态，读不到返回 null（= 不可知，不等于空草稿）。
		 */
		function readDraftText(inputActions) {
			if (!inputActions) return null;
			try {
				if (typeof inputActions.getDraft === "function") return String(inputActions.getDraft() ?? "");
				if (typeof inputActions.draft === "string") return inputActions.draft;
				if (typeof inputActions.getState === "function") {
					const state = inputActions.getState();
					if (state && typeof state.draft === "string") return state.draft;
				}
			} catch {
				return null;
			}
			return null;
		}

		/**
		 * 是否因「已有未发送草稿」而放弃自动发送。只有确实读到非空草稿才拦截；
		 * 读不到时不拦——否则在不暴露草稿的宿主上，点目录文件会完全打不开。
		 */
		function draftBlocksAutoSend(inputActions) {
			const draft = readDraftText(inputActions);
			return typeof draft === "string" && draft.trim() !== "";
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



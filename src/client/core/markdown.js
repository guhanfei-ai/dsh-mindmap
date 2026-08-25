// Generated source fragment. Edit this file, then run npm run build:client.
		//#region markdown → 脑图树（零依赖手写解析）
		/** 规范化节点内容用于稳定 ID：折叠空白、截断到 60 字符（MarkGrove 同款）。 */
		function normalizeForId(text) {
			return String(text ?? "").replace(/\s+/g, " ").trim().slice(0, 60);
		}

		/**
		 * 稳定 ID 工厂：按「父结构路径 | 类型 | 规范化内容」计同名出现序，
		 * 路径+内容哈希成紧凑 id。位置漂移（前插/后插兄弟）不改变既有 id。
		 * 每次解析新建工厂（出现序计数器按次重置）。
		 */
		function createIdFactory() {
			const counters = new Map();
			return function structuralId(kind, content, parentPath) {
				const normalized = normalizeForId(content);
				const key = `${parentPath}|${kind}|${normalized}`;
				const idx = counters.get(key) || 0;
				counters.set(key, idx + 1);
				const path = parentPath ? `${parentPath}/${kind}-${idx}` : `${kind}-${idx}`;
				let hash = 0;
				const full = `${path}:${normalized}`;
				for (let i = 0; i < full.length; i++) {
					hash = ((hash << 5) - hash + full.charCodeAt(i)) | 0;
				}
				return `s${Math.abs(hash).toString(36)}`;
			};
		}

		/** 缩进宽度：tab 按 4 空格折算。 */
		function indentWidth(raw) {
			let width = 0;
			for (const ch of raw) width += ch === "\t" ? 4 : 1;
			return width;
		}

		/**
		 * markdown → 脑图树。根节点 topic = 文档名（rootTitle，由调用方从文件路径
		 * 推导——001 决策 2：根节点标题 = markdown 文档名）。
		 * 节点 kind：root / heading / list / placeholder / code。
		 * 段落不成为节点，附到最近的标题（或根）的 data.description。
		 */
		function parseMarkdownToTree(markdown, rootTitle) {
			const idOf = createIdFactory();
			const root = {
				id: "root",
				kind: "root",
				topic: String(rootTitle ?? "").trim() || "脑图",
				children: [],
				data: {},
			};
			const headingStack = [];
			let listStack = [];
			// 根标题回声标记：记录文档常以文件名作首行 H1（如 "# 002-spike结论.md"），
			// 而根节点标题就是文件名——首个 H1 与根标题一致（或仅多 .md 后缀）时
			// 并入根节点，避免标题显示两次。
			let firstHeadingSeen = false;
			const lines = String(markdown ?? "").split(/\r?\n/);

			const parentRec = () => (headingStack.length ? headingStack[headingStack.length - 1] : null);
			const parentPathOf = () => {
				if (listStack.length) return listStack[listStack.length - 1].path;
				const h = parentRec();
				return h ? h.path : "";
			};
			const parentNode = () => {
				if (listStack.length) return listStack[listStack.length - 1].node;
				const h = parentRec();
				return h ? h.node : root;
			};
			const appendDescription = (node, text) => {
				node.data.description = node.data.description ? `${node.data.description}\n${text}` : text;
			};

			let i = 0;
			// 跳过 YAML frontmatter（--- ... ---）
			if (lines.length > 0 && /^\s*---\s*$/.test(lines[0])) {
				for (i = 1; i < lines.length; i++) {
					if (/^\s*---\s*$/.test(lines[i])) {
						i += 1;
						break;
					}
				}
			}

			let paraBuffer = [];
			const flushParagraph = () => {
				if (paraBuffer.length === 0) return;
				appendDescription(parentNode(), paraBuffer.join(" "));
				paraBuffer = [];
			};

			for (; i < lines.length; i++) {
				const line = lines[i];

				// 围栏代码块：整块成为一个叶节点，标题 = [语言] 首行摘要。
				if (/^\s*(```|~~~)/.test(line)) {
					flushParagraph();
					listStack = [];
					const lang = line.trim().slice(3).trim();
					const buf = [];
					for (i += 1; i < lines.length && !/^\s*(```|~~~)/.test(lines[i]); i++) buf.push(lines[i]);
					const code = buf.join("\n");
					const firstLine = (code.split("\n")[0] || "").trim();
					const summary = firstLine.length > 40 ? `${firstLine.slice(0, 40)}…` : firstLine;
					const node = {
						id: idOf("code", code, parentPathOf()),
						kind: "code",
						topic: `[${lang || "code"}] ${summary}`,
						children: [],
						data: { lang, code, firstLine: firstLine || undefined },
					};
					parentNode().children.push(node);
					continue;
				}

				// ATX 标题：按层级入栈挂树（H1 挂根、H2 挂前一个 H1……）。
				const heading = /^(#{1,6})\s+(.*?)\s*#*\s*$/.exec(line);
				if (heading) {
					flushParagraph();
					listStack = [];
					const level = heading[1].length;
					const text = heading[2].trim() || "（无标题）";
					// 首个 H1 与根标题一致（或仅多 .md 后缀）→ 并入根节点，不另建节点。
					if (!firstHeadingSeen && level === 1 && (text === root.topic || text === `${root.topic}.md`)) {
						firstHeadingSeen = true;
						continue;
					}
					firstHeadingSeen = true;
					while (headingStack.length > 0 && headingStack[headingStack.length - 1].level >= level) headingStack.pop();
					const basePath = parentRec() ? parentRec().path : "";
					const node = {
						id: idOf("heading", text, basePath),
						kind: "heading",
						topic: text,
						children: [],
						data: { level },
					};
					parentNode().children.push(node);
					headingStack.push({ level, node, path: `${basePath}/h${level}-${node.id}` });
					continue;
				}

				// 水平分隔线：线性视觉脚手架，跳过。
				if (/^\s*(-{3,}|\*{3,}|_{3,})\s*$/.test(line)) {
					flushParagraph();
					continue;
				}

				// 列表项：缩进决定层级（约定每级 2 空格，tab=4）；空项=占位节点。
				const listItem = /^(\s*)([-*+]|(\d+)[.)])\s+(.*)$/.exec(line);
				const listEmpty = /^(\s*)([-*+]|(\d+)[.)])\s*$/.exec(line);
				if (listItem || listEmpty) {
					flushParagraph();
					const m = listItem || listEmpty;
					const indent = indentWidth(m[1]);
					const text = listItem ? m[4].trim() : "";
					const ordered = m[3] !== undefined;
					while (listStack.length > 0 && listStack[listStack.length - 1].indent >= indent) listStack.pop();
					const topic = ordered && listItem ? `${m[3]}. ${text}` : text;
					const node = text === ""
						? { id: idOf("list", "", parentPathOf()), kind: "placeholder", topic: "", children: [], data: {} }
						: { id: idOf("list", topic, parentPathOf()), kind: "list", topic, children: [], data: ordered ? { ordered: true } : {} };
					parentNode().children.push(node);
					listStack.push({ indent, node, path: `${parentPathOf()}/${node.id}` });
					continue;
				}

				// 引用块：v0 不映射，跳过。
				if (/^\s*>/.test(line)) {
					flushParagraph();
					continue;
				}

				if (!line.trim()) {
					flushParagraph();
					continue;
				}

				paraBuffer.push(line.trim());
			}
			flushParagraph();

			// 病理内容的兜底去重（MarkGrove 同款）：重复 id 追加序号。
			const seen = new Set();
			const dedupe = (node) => {
				if (seen.has(node.id)) {
					let k = 1;
					while (seen.has(`${node.id}-${k}`)) k++;
					node.id = `${node.id}-${k}`;
				}
				seen.add(node.id);
				for (const child of node.children) dedupe(child);
			};
			dedupe(root);
			return root;
		}
		//#endregion

		//#region 018 生长动画：树 id 收集 + 渐显计划（纯函数，经 internals 供测试）
		/** 先序收集树的全部节点 id（含根）。 */
		function collectTreeIds(tree) {
			const ids = new Set();
			const walk = (node) => {
				if (!node) return;
				ids.add(node.id);
				for (const child of node.children || []) walk(child);
			};
			walk(tree);
			return ids;
		}

		/**
		 * 生长动画计划：广度优先（根→叶）收集「不在 prevIds 中」的节点，逐个错峰渐显。
		 * prevIds = null（首屏/切文档）= 全部节点含根；无新增/变化节点返回 null。
		 * 错峰步长按节点数压缩（总时长 = 末节点延迟 + duration ≤ budget，大图不拖沓）。
		 * 返回 {nodes: Map(id→delayMs), edges: Map(父id→最早新子节点的 delay), totalMs}。
		 */
		function planGrowthReveal(tree, prevIds, options) {
			if (!tree) return null;
			const { budgetMs = 2000, stepMs = 90, durationMs = 320 } = options || {};
			const fresh = [];
			const queue = [tree];
			for (let i = 0; i < queue.length; i++) {
				const node = queue[i];
				if (!prevIds || !prevIds.has(node.id)) fresh.push(node);
				for (const child of node.children || []) queue.push(child);
			}
			if (fresh.length === 0) return null;
			const step = fresh.length > 1
				? Math.min(stepMs, Math.floor(Math.max(0, budgetMs - durationMs) / (fresh.length - 1)))
				: 0;
			const nodes = new Map();
			const edges = new Map();
			fresh.forEach((node, index) => {
				nodes.set(node.id, index * step);
			});
			for (const node of queue) {
				let earliest = null;
				for (const child of node.children || []) {
					const delay = nodes.get(child.id);
					if (delay !== undefined && (earliest === null || delay < earliest)) earliest = delay;
				}
				if (earliest !== null) edges.set(node.id, earliest);
			}
			return { nodes, edges, totalMs: (fresh.length - 1) * step + durationMs };
		}
		//#endregion



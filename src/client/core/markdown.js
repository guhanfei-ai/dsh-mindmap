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
		
		//#region 019 块概念（骨架/血肉/皮肤 的血肉层，规范源：MarkGrove/_arch/003）
		/**
		 * 行内格式检测（003 §3 拆分判据）：粗体/斜体/删除线/行内代码/链接/图片
		 * 都是行内格式——永不拆子节点，只影响块内渲染；含任一即判为 md 块，
		 * 否则是 text 块。
		 */
		function hasInlineFormat(text) {
			return /(\*\*[^*]+\*\*)|(\*[^*\s][^*]*\*)|(~~[^~]+~~)|(`[^`]+`)|(!?\[[^\]]*\]\([^)]*\))/.test(String(text ?? ""));
		}
		
		/** 表格分隔行：由 | - : 空白组成且至少含一个 -。 */
		function isTableSeparator(line) {
			const t = String(line ?? "").trim();
			return /^[|:\s-]+$/.test(t) && t.includes("-");
		}
		
		/** 表格行 → 单元格数组（去首尾空段，保留中间空单元格）。
		 * 支持 GFM 转义：`\|` 是字面竖线（占位符避位，剥标记后还原），不切单元格；
		 * `\\|` 则是已转义的反斜杠 + 真分隔符，照常切开。 */
		function parseTableRow(line) {
			return String(line ?? "").trim()
				.replace(/^\|/, "").replace(/\|$/, "")
				.replace(/(?<!\\)((?:\\\\)*)\\\|/g, "$1\u0000")
				.split("|")
				.map((c) => c.replace(/\u0000/g, "|").trim());
		}

		/**
		 * 020 复制全文（右键菜单）：单节点自身内容的完整文本。代码块取围栏全文；
		 * 表格块按 Markdown 源码形态输出完整网格；其余块取原文（data.raw 优先，
		 * 引用块 raw = 整块引用源码；无 raw 时回退 topic）。
		 */
		function nodeFullText(node) {
			if (!node) return "";
			const data = node.data || {};
			if (node.kind === "code") return data.code || node.topic || "";
			if (node.kind === "table" && Array.isArray(data.rows) && data.rows.length > 0) {
				// data.rows 不含分隔行（解析时剔除）；复制时补回，粘回 Markdown 仍是合法表格。
				const lines = data.rows.map((row) => `| ${row.join(" | ")} |`);
				if (data.rows.length > 1) lines.splice(1, 0, `| ${data.rows[0].map(() => "---").join(" | ")} |`);
				return lines.join("\n");
			}
			return data.raw || node.topic || "";
		}
		//#endregion
		
		/**
		 * markdown → 脑图树。根节点 topic = 文档名（rootTitle，由调用方从文件路径
		 * 推导——001 决策 2：根节点标题 = markdown 文档名）。
		 * 节点 kind：root / heading / list / placeholder / code / text / md / quote / table。
		 * 019 块概念：段落升格为节点（含行内格式 → md 块，否则 text 块，原文存
		 * data.raw）；引用块聚合为 quote 节点（首段提升为自身内容，其余成子节点）；
		 * 连续 | 行解析为 table 节点（data.rows 全量保留，单元格不拆）。
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
			// 根标题回声标记：记录文档常以文件名作首行 H1（如 "# 002-spike结论.md"），
			// 而根节点标题就是文件名——首个顶层 H1 与根标题一致（或仅多 .md 后缀）
			// 时并入根节点，避免标题显示两次。只有顶层 H1 参与回声：H2 等低级标题
			// 不消耗名额，引用块递归（echoRoot=false）也不触碰本标记。
			let firstTopH1Seen = false;
			const lines = String(markdown ?? "").split(/\r?\n/);
		
			let start = 0;
			// 跳过 YAML frontmatter（--- ... ---）：找不到闭合行说明不是
			// frontmatter（如以水平线开头的合法文档），回退普通解析，
			// 否则整篇会被吞成空树。
			if (lines.length > 0 && /^\s*---\s*$/.test(lines[0])) {
				for (start = 1; start < lines.length; start++) {
					if (/^\s*---\s*$/.test(lines[start])) {
						start += 1;
						break;
					}
				}
				if (start >= lines.length) start = 0;
			}
		
			/**
			 * 块级解析循环（标题/列表/代码/引用/表格/段落）。引用块内容递归走本函数，
			 * echoRoot=false 时不参与根标题回声。节点挂入 container（顶层 = root.children）。
			 */
			function parseBlockLines(container, lineList, echoRoot) {
				const headingStack = [];
				let listStack = [];
				const parentRec = () => (headingStack.length ? headingStack[headingStack.length - 1] : null);
				const parentPathOf = () => {
					if (listStack.length) return listStack[listStack.length - 1].path;
					const h = parentRec();
					return h ? h.path : "";
				};
				const parentNode = () => {
					if (listStack.length) return listStack[listStack.length - 1].node;
					const h = parentRec();
					return h ? h.node : null;
				};
				const appendNode = (node) => {
					const p = parentNode();
					(p ? p.children : container).push(node);
				};
		
				let paraBuffer = [];
				// 019 段落升格：段落不再塞 description，自己成为 text/md 块节点。
				const flushParagraph = () => {
					if (paraBuffer.length === 0) return;
					const text = paraBuffer.join(" ");
					paraBuffer = [];
					const kind = hasInlineFormat(text) ? "md" : "text";
					appendNode({
						id: idOf(kind, text, parentPathOf()),
						kind,
						topic: text,
						children: [],
						data: { raw: text },
					});
				};
		
				for (let i = 0; i < lineList.length; i++) {
					const line = lineList[i];
		
					// 围栏代码块：整块成为一个叶节点，标题 = [语言] 首行摘要（盒内紧凑，
					// 悬停浮层看全文——003 §5.3；data.code 全量保存）。
					// GFM：闭合围栏须同字符且不少于开启长度——``` 块里的 ~~~、
					// ```` 块里的 ``` 都是代码内容，不是围栏。
					const fence = /^\s*(`{3,}|~{3,})/.exec(line);
					if (fence) {
						flushParagraph();
						listStack = [];
						const lang = line.trim().slice(fence[1].length).trim();
						const fenceClose = new RegExp(`^\\s*${fence[1][0]}{${fence[1].length},}\\s*$`);
						const buf = [];
						for (i += 1; i < lineList.length && !fenceClose.test(lineList[i]); i++) buf.push(lineList[i]);
						const code = buf.join("\n");
						const firstLine = (code.split("\n")[0] || "").trim();
						const summary = firstLine.length > 40 ? `${firstLine.slice(0, 40)}…` : firstLine;
						appendNode({
							id: idOf("code", code, parentPathOf()),
							kind: "code",
							topic: `[${lang || "code"}] ${summary}`,
							children: [],
							data: { lang, code, firstLine: firstLine || undefined },
						});
						continue;
					}
		
					// ATX 标题：按层级入栈挂树（H1 挂根、H2 挂前一个 H1……）。
					const heading = /^(#{1,6})\s+(.*?)\s*#*\s*$/.exec(line);
					if (heading) {
						flushParagraph();
						listStack = [];
						const level = heading[1].length;
						const text = heading[2].trim() || "（无标题）";
						// 首个顶层 H1 与根标题一致（或仅多 .md 后缀）→ 并入根节点，不另建节点。
						// 名额只属于顶层 H1：低级标题先行、引用块内出现标题都不影响回声。
						if (echoRoot && level === 1) {
							if (!firstTopH1Seen && (text === root.topic || text === `${root.topic}.md`)) {
								firstTopH1Seen = true;
								continue;
							}
							firstTopH1Seen = true;
						}
						while (headingStack.length > 0 && headingStack[headingStack.length - 1].level >= level) headingStack.pop();
						const basePath = parentRec() ? parentRec().path : "";
						const node = {
							id: idOf("heading", text, basePath),
							kind: "heading",
							topic: text,
							children: [],
							data: { level },
						};
						appendNode(node);
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
						appendNode(node);
						listStack.push({ indent, node, path: `${parentPathOf()}/${node.id}` });
						continue;
					}
		
					// 019 表格块：连续 | 行且第二行为分隔行 → table 节点（003 §5.5，
					// data.rows 全量保留，单元格不拆子节点）。不满足分隔行条件的 | 行
					// 按普通段落处理。
					if (/^\s*\|/.test(line)) {
						const rows = [];
						let j = i;
						for (; j < lineList.length && /^\s*\|/.test(lineList[j]); j++) rows.push(lineList[j]);
						if (rows.length >= 2 && isTableSeparator(rows[1])) {
							flushParagraph();
							listStack = [];
							i = j - 1;
							// GFM 对齐契约：列数钉死在分隔行。表头与数据行同等待遇：
							// 少列补空、多列截断——未转义竖线切碎的行顶多内容错位，网格永不参差。
							const cols = parseTableRow(rows[1]).length;
							const toCols = (cells) => {
								if (cells.length >= cols) return cells.slice(0, cols);
								return cells.concat(new Array(cols - cells.length).fill(""));
							};
							const header = toCols(parseTableRow(rows[0]));
							const body = rows.slice(2).map((row) => toCols(parseTableRow(row)));
							const tableRows = [header].concat(body);
							appendNode({
								id: idOf("table", tableRows.map((r) => r.join("\u0001")).join("\u0002"), parentPathOf()),
								kind: "table",
								topic: `${tableRows.length}×${cols} 表格`,
								children: [],
								data: { rows: tableRows },
							});
							continue;
						}
						// 非表格：落入下方段落缓冲。
					}
		
					// 019 引用块：连续 > 行聚合为 quote 节点（003 §5.4）。去 > 前缀后
						// 递归走同一套块规则；首个 text/md 段提升为自身内容（001 §3.1），
						// 其余内容成为子节点。
					if (/^\s*>/.test(line)) {
						flushParagraph();
						listStack = [];
						const inner = [];
						let j = i;
						for (; j < lineList.length && /^\s*>/.test(lineList[j]); j++) inner.push(lineList[j].replace(/^\s*>\s?/, ""));
						i = j - 1;
						const innerNodes = [];
						parseBlockLines(innerNodes, inner, false);
						let topic = "";
						const promoteIdx = innerNodes.findIndex((n) => n.kind === "text" || n.kind === "md");
						if (promoteIdx >= 0) {
							topic = innerNodes[promoteIdx].topic;
							innerNodes.splice(promoteIdx, 1);
						}
						appendNode({
							id: idOf("quote", topic || inner.join("\n"), parentPathOf()),
							kind: "quote",
							topic: topic || "（引用）",
							children: innerNodes,
							data: { raw: inner.join("\n") },
						});
						continue;
					}
		
					if (!line.trim()) {
						flushParagraph();
						continue;
					}
		
					paraBuffer.push(line.trim());
				}
				flushParagraph();
			}
		
			parseBlockLines(root.children, lines.slice(start), true);
		
			// 病理内容的兕底去重（MarkGrove 同款）：重复 id 追加序号。
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



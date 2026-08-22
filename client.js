// dsh-mindmap —— 浏览器半边（ModuleLoader 单文件模块，无外部依赖）。
//
// 职责：
// - 「思维脑图」折叠按钮：挂 conversation.session.header.actions（list 槽，追加式），
//   点击切换右侧 details 脑图面板的开/合（ctx.layout.openDetails/closeDetails）。
// - details 面板：以 priority:-1 顶替官方 DetailsPanel（003 实测结论：single 槽
//   必须显式更低 priority 才能合法顶替，lowest renders；工具详情共存不可行，
//   作者已拍板接受让位）。
// - 实时数据通路：消费会话快照（useSession → nodes）里 mindmap_* 工具的
//   ToolResultNode，重放出各文档的最新内容并渲染（002/003：无自定义事件通道，
//   工具调用本身就是事件流）。
// - markdown→脑图树：本文件内置零依赖解析器（MarkGrove mdastConverter 的映射
//   语法移植：标题栈→树、列表→子节点、空列表项=占位节点、代码块→首行摘要叶
//   节点、段落→挂标题的正文说明、结构路径稳定 ID）。
// - PNG 导出：树 → SVG → canvas → PNG 下载。
//
// 解析器等纯函数经 exports.internals 暴露给 Node 测试（vm 加载本文件，见
// test/client.test.js）。工具结果 JSON 由 host 半边（index.js）产出。
window.__ModuleLoader__.load({
	id: "dsh-mindmap",
	factory: (require) => {
		var module = { exports: {} };
		var exports = module.exports;
		let react_jsx_runtime = require("react/jsx-runtime");
		let react = require("react");

		const inject = ["slots", "layout"];

		// host 半边四个工具名（见 index.js）；面板只认这些工具的结果。
		const TOOL_NAMES = new Set(["mindmap_create", "mindmap_open", "mindmap_get", "mindmap_update"]);
		// 这些 op 的「新到达」会触发面板自动展开（001 场景 1；001 决策 5：AI 自动
		// 打开与手动开关并存）。update 不自动开面板，避免打扰正在看别的的用户。
		const OPENING_OPS = new Set(["create", "open"]);

		const EMPTY_NODES = [];

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

		//#region 会话快照 → 文档集
		/** 取工具结果里 text 块拼接的文本。 */
		function resultTextOfBlocks(blocks) {
			return (blocks ?? []).filter((b) => b?.type === "text").map((b) => b.text).join("\n");
		}

		/** 从路径取文档名（去 .md）——根节点标题。 */
		function stemOf(path) {
			const base = String(path ?? "").split(/[\\/]/).pop() || "mindmap";
			return base.replace(/\.md$/i, "");
		}

		/**
		 * 重放会话快照里的 mindmap_* 工具结果，得到每个脑图文档的最新状态。
		 * nodes: ConversationSnapshot.nodes（ToolResultNode 含 call.name 与渲染后的
		 * content 文本块——host 的工具结果 JSON 就写在其中）。
		 * 返回 { order: path[], byPath: { path → {path, rootTitle, content, op, callId} } }。
		 */
		function reduceDocuments(nodes) {
			const byPath = Object.create(null);
			let order = [];
			for (const node of nodes ?? []) {
				if (!node || node.kind !== "tool-result" || node.isError) continue;
				const name = node.call?.name;
				if (typeof name !== "string" || !TOOL_NAMES.has(name)) continue;
				let parsed;
				try {
					parsed = JSON.parse(resultTextOfBlocks(node.content));
				} catch {
					continue;
				}
				if (!parsed || parsed.ok !== true || typeof parsed.path !== "string" || !parsed.path) continue;
				// 根标题改名 = 文件重命名：旧路径键迁移到新路径。
				const renamedFrom = typeof parsed.renamedFrom === "string" ? parsed.renamedFrom : null;
				if (renamedFrom && byPath[renamedFrom] && renamedFrom !== parsed.path) {
					delete byPath[renamedFrom];
					order = order.filter((p) => p !== renamedFrom);
				}
				if (!byPath[parsed.path]) order.push(parsed.path);
				byPath[parsed.path] = {
					path: parsed.path,
					rootTitle: typeof parsed.rootTitle === "string" && parsed.rootTitle ? parsed.rootTitle : stemOf(parsed.path),
					content: typeof parsed.content === "string" ? parsed.content : "",
					op: typeof parsed.op === "string" ? parsed.op : name,
					callId: node.callId,
					// 013：rename 迁移后保留旧路径，供本地直读 tab 清理（mergeDocuments）。
					renamedFrom: typeof parsed.renamedFrom === "string" ? parsed.renamedFrom : null,
				};
			}
			return { order, byPath };
		}

		/**
		 * 快照文档集（AI 工具结果）与本地直读文档集（read 路由即时打开）合并：
		 * - 快照优先（同 path 覆盖本地占位）；
		 * - 本地文档追加在快照 order 之后；
		 * - 快照里有 renamedFrom 指向某本地路径时，丢弃该本地条目（文件已改名）。
		 */
		function mergeDocuments(snapshot, localDocs) {
			const byPath = { ...localDocs, ...snapshot.byPath };
			const dropped = new Set();
			for (const doc of Object.values(snapshot.byPath)) {
				if (typeof doc.renamedFrom === "string" && doc.renamedFrom && localDocs[doc.renamedFrom]) {
					dropped.add(doc.renamedFrom);
				}
			}
			for (const p of dropped) delete byPath[p];
			const order = [...snapshot.order];
			for (const p of Object.keys(localDocs)) {
				if (!snapshot.byPath[p] && !dropped.has(p)) order.push(p);
			}
			return { order, byPath };
		}
		//#endregion

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

		//#region PNG 导出（SVG 序列化 → canvas → 下载）
		const EXPORT = { nodeW: 200, nodeH: 30, hGap: 48, vGap: 10, pad: 20, fontSize: 13 };

		function escapeXml(text) {
			return String(text ?? "").replace(/[&<>"']/g, (ch) => ({
				"&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&apos;",
			})[ch]);
		}

		function truncateForExport(text, max = 26) {
			const s = String(text ?? "");
			return [...s].length > max ? `${[...s].slice(0, max).join("")}…` : s;
		}

		/**
		 * 布局 + 生成导出用 SVG 字符串。左→右分层：x = 深度列，叶子自上而下占行，
		 * 父节点垂直居中于其子块；连线为水平贝塞尔。
		 */
		function buildExportSvg(tree) {
			const placed = [];
			const edges = [];
			let cursor = EXPORT.pad;
			let maxDepth = 0;
			const place = (node, depth, parent) => {
				const entry = { node, depth, x: EXPORT.pad + depth * (EXPORT.nodeW + EXPORT.hGap), y: 0 };
				placed.push(entry);
				if (depth > maxDepth) maxDepth = depth;
				if (parent) edges.push({ from: parent, to: entry });
				if (node.children && node.children.length > 0) {
					let first = null;
					let last = null;
					for (const child of node.children) {
						const childEntry = place(child, depth + 1, entry);
						if (!first) first = childEntry;
						last = childEntry;
					}
					entry.y = (first.y + last.y) / 2;
				} else {
					entry.y = cursor + EXPORT.nodeH / 2;
					cursor += EXPORT.nodeH + EXPORT.vGap;
				}
				return entry;
			};
			place(tree, 0, null);
			const width = EXPORT.pad * 2 + (maxDepth + 1) * EXPORT.nodeW + maxDepth * EXPORT.hGap;
			const height = Math.max(EXPORT.pad * 2 + EXPORT.nodeH, cursor - EXPORT.vGap + EXPORT.pad);
			const parts = [];
			parts.push(`<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" font-family="-apple-system, 'PingFang SC', 'Microsoft YaHei', sans-serif">`);
			parts.push(`<rect x="0" y="0" width="${width}" height="${height}" fill="#ffffff"/>`);
			for (const e of edges) {
				const x1 = e.from.x + EXPORT.nodeW;
				const y1 = e.from.y;
				const x2 = e.to.x;
				const y2 = e.to.y;
				const mid = (x1 + x2) / 2;
				parts.push(`<path d="M ${x1} ${y1} C ${mid} ${y1}, ${mid} ${y2}, ${x2} ${y2}" fill="none" stroke="#c8cdd6" stroke-width="1.5"/>`);
			}
			for (const p of placed) {
				const isRoot = p.depth === 0;
				const isPlaceholder = p.node.kind === "placeholder";
				const isCode = p.node.kind === "code";
				const boxY = p.y - EXPORT.nodeH / 2;
				const fill = isRoot ? "#eef2ff" : isCode ? "#f5f2ea" : "#f6f7f9";
				parts.push(`<rect x="${p.x}" y="${boxY}" width="${EXPORT.nodeW}" height="${EXPORT.nodeH}" rx="7" fill="${isPlaceholder ? "none" : fill}" stroke="${isRoot ? "#7c8cf8" : isPlaceholder ? "#b9c0cc" : "#d4d9e0"}" stroke-width="${isRoot ? 1.6 : 1}"${isPlaceholder ? ' stroke-dasharray="5,4"' : ""}/>`);
				const label = isPlaceholder ? "待填写" : truncateForExport(p.node.topic);
				const color = isRoot ? "#2f3ab2" : isPlaceholder ? "#9aa2b1" : "#1f2430";
				const weight = isRoot ? 700 : p.node.kind === "heading" ? 600 : 400;
				parts.push(`<text x="${p.x + 10}" y="${p.y + 4.5}" font-size="${EXPORT.fontSize}" font-weight="${weight}" font-family="${isCode ? "Menlo, monospace" : "inherit"}" fill="${color}">${escapeXml(label)}</text>`);
			}
			parts.push("</svg>");
			return { svg: parts.join(""), width, height };
		}

		/** 浏览器侧导出：SVG → Image → canvas → PNG 下载。 */
		async function exportPng(tree, rootTitle) {
			const { svg, width, height } = buildExportSvg(tree);
			const url = `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`;
			const img = new Image();
			await new Promise((resolve, reject) => {
				img.onload = () => resolve();
				img.onerror = () => reject(new Error("脑图 SVG 渲染失败"));
				img.src = url;
			});
			const canvas = document.createElement("canvas");
			canvas.width = Math.max(1, Math.ceil(width));
			canvas.height = Math.max(1, Math.ceil(height));
			const ctx2d = canvas.getContext("2d");
			ctx2d.fillStyle = "#ffffff";
			ctx2d.fillRect(0, 0, canvas.width, canvas.height);
			ctx2d.drawImage(img, 0, 0);
			const dataUrl = canvas.toDataURL("image/png");
			const a = document.createElement("a");
			a.href = dataUrl;
			a.download = `${(rootTitle || "mindmap").replace(/[\\/:*?"<>|]/g, "_")}.png`;
			document.body.appendChild(a);
			a.click();
			a.remove();
		}
		//#endregion

		//#region React 组件
		const S = {
			mButton: { display: "inline-flex", alignItems: "center", gap: "4px", padding: "0 8px", height: "22px", background: "var(--dsw-alias-fill-tsp-secondary)", color: "var(--dsw-alias-label-secondary)", border: "none", borderRadius: "6px", cursor: "pointer", font: "inherit", fontSize: "12px", whiteSpace: "nowrap" },
			root: { height: "100%", display: "flex", flexDirection: "column", background: "var(--dsw-alias-bg-base)", color: "var(--dsw-alias-label-primary)", fontSize: "13px", minWidth: 0 },
			header: { display: "flex", flexDirection: "column", gap: "6px", padding: "12px 14px 0", boxSizing: "border-box", borderBottom: "1px solid var(--dsw-alias-border-l2)" },
			headerTop: { display: "flex", alignItems: "center", gap: "10px", flex: "none" },
			tabRow: { display: "flex", alignItems: "flex-end", gap: "10px", marginTop: "auto", overflowX: "auto", overflowY: "hidden", minWidth: 0, flex: "none" },
			tab: { border: "none", background: "none", cursor: "pointer", padding: "3px 12px", lineHeight: "18px", borderRadius: "8px 8px 0 0", font: "inherit", color: "var(--dsw-alias-label-secondary)", whiteSpace: "nowrap", maxWidth: "120px", overflow: "hidden", textOverflow: "ellipsis", transition: "background 0.08s ease, color 0.08s ease" },
			tabHover: { background: "var(--dsw-alias-interactive-bg-hover)" },
			// 激活 tab 用内阴影画 2px 指示条，贴着头部分隔线，不挤高度。
			tabActive: { background: "var(--dsw-alias-bg-layer-3)", color: "var(--dsw-alias-label-primary)", boxShadow: "inset 0 -2px 0 0 var(--dsw-alias-state-business-primary)" },
			// 文档 tab = 包裹（承载视觉）+ 标题按钮 + 关闭 ✕（013：可关闭标签页）。
			tabWrap: { display: "inline-flex", alignItems: "flex-end", borderRadius: "8px 8px 0 0", overflow: "hidden", maxWidth: "160px", transition: "background 0.08s ease" },
			tabTitle: { background: "none", border: "none", cursor: "pointer", font: "inherit", color: "inherit", padding: "3px 4px 3px 12px", lineHeight: "18px", whiteSpace: "nowrap", maxWidth: "110px", overflow: "hidden", textOverflow: "ellipsis" },
			tabClose: { background: "none", border: "none", cursor: "pointer", padding: "3px 8px 3px 2px", lineHeight: "18px", color: "var(--dsw-alias-label-tertiary)", fontSize: "11px", flex: "none" },
			spacer: { flex: "1 1 auto" },
			action: { border: "1px solid var(--dsw-alias-border-l2)", background: "var(--dsw-alias-bg-layer-3)", color: "var(--dsw-alias-label-primary)", borderRadius: "8px", height: "20px", padding: "0 12px", cursor: "pointer", font: "inherit", fontSize: "12px", whiteSpace: "nowrap" },
			body: { flex: "1 1 auto", minHeight: 0, overflow: "auto", padding: "16px" },
			empty: { color: "var(--dsw-alias-label-tertiary)", lineHeight: 1.7 },
			emptyHint: { color: "var(--dsw-alias-label-tertiary)", fontSize: "12px", lineHeight: 1.6, margin: "0" },
			// 013：tab 秒建后的加载态（内容要等 AI 工具结果才渲染）。
			loadingWrap: { display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", gap: "12px", height: "100%", minHeight: 0 },
			loadingText: { color: "var(--dsw-alias-label-secondary)", fontSize: "13px", margin: "0" },
			// 013 目录树 tab：树容器/行样式。视觉自成一套：emoji 图标 + M 徽标 +
			// 悬停高亮 + 激活指示条，不做 VSCode 式 chevron/线框。
			// 树容器 -2px 负边距抵消 body 16px 内距：树左缘 = 头部「目录」tab 左缘（14px）。
			treeWrap: { display: "flex", flexDirection: "column", gap: "12px", height: "100%", minHeight: 0, marginLeft: "-2px", marginRight: "-2px" },
			treeList: { flex: "1 1 auto", overflowY: "auto", display: "flex", flexDirection: "column", gap: "2px", minHeight: 0 },
			treeRow: { display: "flex", alignItems: "center", gap: "8px", width: "100%", boxSizing: "border-box", fontSize: "13px", lineHeight: "22px", borderRadius: "8px", padding: "2px 10px", cursor: "default", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis", minWidth: 0, background: "none", border: "none", font: "inherit", color: "var(--dsw-alias-label-secondary)", textAlign: "left", transition: "background 0.08s ease" },
			treeRowHover: { background: "var(--dsw-alias-interactive-bg-hover)" },
			treeRowClickable: { cursor: "pointer" },
			treeRowMd: { color: "var(--dsw-alias-label-primary)", fontWeight: 500 },
			treeRowOther: { color: "var(--dsw-alias-label-tertiary)" },
			treeRootRow: { fontWeight: 700, color: "var(--dsw-alias-label-primary)" },
			treeCaret: { flex: "none", width: "16px", fontSize: "11px", color: "var(--dsw-alias-label-caption)", textAlign: "center" },
			// .md 专属徽标：脑图品牌的识别点（与 VSCode 文件图标区分开）。
			mdBadge: { flex: "none", width: "18px", height: "18px", borderRadius: "5px", display: "inline-flex", alignItems: "center", justifyContent: "center", fontSize: "11px", fontWeight: 700, lineHeight: 1, background: "var(--dsw-alias-state-business-tertiary)", color: "var(--dsw-alias-state-business-primary)" },
			fileDot: { flex: "none", width: "18px", height: "18px", display: "inline-flex", alignItems: "center", justifyContent: "center" },
			fileDotCore: { width: "4px", height: "4px", borderRadius: "50%", background: "var(--dsw-alias-label-caption)" },
			treeRefresh: { flex: "none", border: "none", background: "none", cursor: "pointer", font: "inherit", fontSize: "12px", color: "var(--dsw-alias-label-tertiary)", padding: "0 8px", borderRadius: "6px", lineHeight: "20px" },
			treeRefreshHover: { background: "var(--dsw-alias-interactive-bg-hover)", color: "var(--dsw-alias-label-primary)" },
			treeError: { color: "var(--dsw-alias-label-error)", fontSize: "12px", lineHeight: 1.6, margin: "0" },
			treeMenu: { position: "fixed", zIndex: 60, minWidth: "210px", background: "var(--dsw-alias-bg-layer-3)", border: "1px solid var(--dsw-alias-border-l2)", borderRadius: "10px", padding: "6px", boxShadow: "var(--dsw-shadow-lv2)" },
			treeMenuItem: { display: "block", width: "100%", boxSizing: "border-box", textAlign: "left", border: "none", background: "none", cursor: "pointer", padding: "7px 12px", borderRadius: "8px", font: "inherit", fontSize: "13px", color: "var(--dsw-alias-label-primary)" },
			row: { display: "flex", alignItems: "center", minWidth: 0 },
			childrenColumn: { display: "flex", flexDirection: "column", gap: "8px", marginLeft: "24px", minWidth: 0 },
			box: { padding: "6px 12px", borderRadius: "10px", border: "1px solid var(--dsw-alias-border-l2)", background: "var(--dsw-alias-bg-layer-3)", maxWidth: "240px", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", flex: "0 0 auto", boxShadow: "0 1px 2px rgba(16,24,40,0.04)" },
			rootBox: { fontWeight: 700, fontSize: "14px", border: "1px solid var(--dsw-alias-border-l2-darkmode-thin, #b9c0cc)", background: "var(--dsw-alias-bg-module-platform, #eef2ff)" },
			headingBox: { fontWeight: 600 },
			placeholderBox: { padding: "6px 12px", borderRadius: "10px", border: "1px dashed var(--dsw-alias-border-l2)", color: "var(--dsw-alias-label-tertiary)", background: "none" },
			codeBox: { fontFamily: "Menlo, monospace", fontSize: "12px" },
		};

		/** 「思维脑图」按钮：读取 AppFrame 的 data-details-collapsed 属性判断当前态再切换。 */
		function MindmapButton(props) {
			const layout = props.mindmapFace.layout;
			return (0, react_jsx_runtime.jsxs)("button", {
				type: "button",
				title: "脑图面板：展开 / 收起",
				style: S.mButton,
				onClick: () => {
					const collapsed = document.querySelector("[data-details-collapsed]") !== null;
					if (collapsed) layout.openDetails();
					else layout.closeDetails();
				},
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
			});
		}

		function NodeBox(props) {
			const { node } = props;
			const style = node.kind === "root"
				? { ...S.box, ...S.rootBox }
				: node.kind === "heading"
					? { ...S.box, ...S.headingBox }
					: node.kind === "placeholder"
						? { ...S.placeholderBox }
						: node.kind === "code"
							? { ...S.box, ...S.codeBox }
							: S.box;
			const title = node.data?.description
				? `${node.topic}\n\n${node.data.description}`
				: node.data?.code
					? `${node.topic}\n\n${node.data.code}`
					: node.topic;
			return (0, react_jsx_runtime.jsx)("div", { style, title, children: node.kind === "placeholder" ? "待填写" : node.topic });
		}

		/** 左→右递归树：节点盒 + 右侧子节点列。 */
		function TreeRow(props) {
			const { node } = props;
			return (0, react_jsx_runtime.jsxs)("div", { style: S.row, children: [
				(0, react_jsx_runtime.jsx)(NodeBox, { node }),
				node.children && node.children.length > 0
					? (0, react_jsx_runtime.jsx)("div", { style: S.childrenColumn, children: node.children.map((child) => (0, react_jsx_runtime.jsx)(TreeRow, { node: child }, child.id)) })
					: null,
			] });
		}

		function MindmapDetailsPanel(props) {
			// inputActions 是 details 槽的标准注入（runner catalog：session 作用域
			// 槽组件免费获得）；setDraft 即官方公共面「把指令写进输入草稿」。
			const { useSession, sessionId, inputActions, mindmapFace } = props;
			const nodes = useSession ? useSession((s) => (s && s.nodes) || EMPTY_NODES) : EMPTY_NODES;
			const docs = react.useMemo(() => reduceDocuments(nodes), [nodes]);
			// 013：本地加载占位文档（左键点 .md 秒建 tab、内容为空），与快照文档
			// 合并显示；快照优先（AI 结果覆盖占位）。
			const [localDocs, setLocalDocs] = react.useState({});
			const merged = react.useMemo(() => mergeDocuments(docs, localDocs), [docs, localDocs]);
			const panelRootRef = react.useRef(null);
			// 013 目录树 tab：常驻第一个 tab（TREE_TAB 哨兵，永不与绝对路径撞名）。
			const TREE_TAB = "__tree__";
			// 013 作者拍板「单脑图模式」：面板只有「目录」与「脑图」两个 tab，
			// 打开新脑图替换掉旧的（覆盖 001 决策 3 的多标签形态，记录见 013）。
			const [view, setView] = react.useState("tree");
			const [currentPath, setCurrentPath] = react.useState(null);
			const [hiddenPath, setHiddenPath] = react.useState(null);
			const [exporting, setExporting] = react.useState(false);
			const [exportError, setExportError] = react.useState("");
			const [filledHint, setFilledHint] = react.useState("");
			// fsTree：nodes = {path → 节点}, expanded = {path → true}, loading = {path → true}。
			const [fsTree, setFsTree] = react.useState({ nodes: {}, expanded: {}, loading: {}, cwd: null, error: null });
			// 013 右键菜单：{x, y, kind: "root"|"dir", rel}；null = 关闭。
			const [treeMenu, setTreeMenu] = react.useState(null);
			// tab 右键菜单：{x, y, path}（path === TREE_TAB 时是「刷新目录树」）。
			const [tabMenu, setTabMenu] = react.useState(null);
			// 悬停高亮键：树行用 entry.path / node.path，tab 用 TREE_TAB / 文档路径。
			const [hoverKey, setHoverKey] = react.useState(null);

			// 008 动态测量聊天区头部高度,实现面板与聊天区底边线像素级对齐;
			// 测不到时回退 75(007 数值修正版)。
			// 009 修复:多插件(如 dsh-better-sidebar)会包裹中间列,使 008 的结构链
			// 取到「包含整个会话区的大容器」(高 ≈ 600),撑大面板;修正为选择器
			// 优先级反转(主选 wSkVaW_header) + 高度合法性校验 + 失败 reset 回退。
			const FALLBACK_HEADER_HEIGHT = 75;
			const [headerHeight, setHeaderHeight] = react.useState(FALLBACK_HEADER_HEIGHT);
			react.useLayoutEffect(() => {
				const HEADER_MIN = 40;
				const HEADER_MAX = 200;
				const tryPaths = [
					() => document.querySelector('[class*="wSkVaW_header"]'),
					() => {
						const detailsCol = document.querySelector('[class*="detailsCol"]');
						if (!detailsCol) return null;
						const centerCol = detailsCol.previousElementSibling;
						if (!centerCol) return null;
						return centerCol.firstElementChild?.firstElementChild || null;
					},
				];
				const measure = () => {
					for (const path of tryPaths) {
						const el = path();
						if (!el) continue;
						const rect = el.getBoundingClientRect();
						const panelTop = panelRootRef.current
							? panelRootRef.current.getBoundingClientRect().top
							: rect.top;
						// 010 精确对齐：聊天区可见分隔线是 ::after（bottom:1px, height:1px），
						// 实测其顶缘位于元素底部上方 1px 处；面板线用 border-bottom 贴底，
						// 故头部高度 = rect.bottom - 1 - panelTop。保留一位小数避免亚像素偏差。
						const h = rect.bottom - 1 - panelTop;
						if (h >= HEADER_MIN && h <= HEADER_MAX) {
							setHeaderHeight(Math.round(h * 10) / 10);
							return;
						}
					}
					// 全部失败/超范围:reset 到回退值,避免卡在错误高度。
					setHeaderHeight(FALLBACK_HEADER_HEIGHT);
				};
				measure();
				// observer 锚点用主选(稳定),主选缺失才退化到结构链。
				const target = tryPaths[0]() || tryPaths[1]();
				let observer = null;
				if (target && typeof ResizeObserver !== "undefined") {
					observer = new ResizeObserver(measure);
					observer.observe(target);
				}
				window.addEventListener("resize", measure);
				return () => {
					if (observer) observer.disconnect();
					window.removeEventListener("resize", measure);
				};
			}, []);

			// 单脑图模式：可见脑图 = 用户当前点选（且未被关闭）的快照/本地文档，
			// 否则跟随最新工具结果；隐藏过的路径不自动回弹（重新点树里文件才恢复）。
			const lastPath = merged.order.length > 0 ? merged.order[merged.order.length - 1] : null;
			const shown = currentPath && currentPath !== hiddenPath && merged.byPath[currentPath]
				? currentPath
				: (lastPath && lastPath !== hiddenPath ? lastPath : null);
			const active = view === "mindmap" && shown ? shown : TREE_TAB;
			const doc = active !== TREE_TAB && merged.byPath[active] ? merged.byPath[active] : null;
			const tree = react.useMemo(
				() => (doc ? parseMarkdownToTree(doc.content, doc.rootTitle) : null),
				[doc && doc.content, doc && doc.rootTitle],
			);

			// AI 自动打开（001 决策 5）：新到达的 create/open 结果触发 openDetails；
			// 首次挂载只登记不打开（刷新后面板保持收起，003 实测行为）。
			const seen = react.useRef(null);
			react.useEffect(() => {
				const ids = new Set(merged.order.map((p) => merged.byPath[p].callId));
				if (seen.current === null) {
					seen.current = ids;
					return;
				}
				let shouldOpen = false;
				for (const p of merged.order) {
					const d = merged.byPath[p];
					if (OPENING_OPS.has(d.op) && !seen.current.has(d.callId)) shouldOpen = true;
				}
				seen.current = ids;
				if (shouldOpen) {
					mindmapFace.layout.openDetails();
					// 单脑图模式：新打开的脑图顶替旧视图（001 场景 1「一句开脑图」）。
					setHiddenPath(null);
					setCurrentPath(null);
					setView("mindmap");
				}
			}, [merged]);

			// 013「所见即所编」焦点同步：AI 焦点 = 快照里最新工具结果的文档路径；
			// 脑图视图激活且其文档 ≠ 焦点时，自动填「用 mindmap_open 打开 <它>」
			// 并发送，让 AI 跟上用户眼睛看的那颗脑图。
			const focusPath = docs.order.length > 0 ? docs.order[docs.order.length - 1] : null;
			const focusSentRef = react.useRef(null);
			react.useEffect(() => {
				if (!sessionId) return;
				if (!active || active === TREE_TAB) return;
				if (!docs.byPath[active]) return; // 本地占位：它的 open 请求已在途
				if (focusPath === active) return;
				if (focusSentRef.current === active) return; // 已发过，等 AI 结果追平
				if (!inputActions || typeof inputActions.setDraft !== "function") return;
				const rel = fsTree.cwd ? relPathWithin(fsTree.cwd, active, stemOf(active)) : active;
				try {
					inputActions.setDraft(`用 mindmap_open 打开 ${rel}`);
					if (typeof inputActions.submit === "function") inputActions.submit();
					focusSentRef.current = active;
				} catch {
					// 发送失败：下次 active/focus 变化会再试；也可手动在聊天里说。
				}
			}, [active, focusPath, fsTree.cwd, docs]);

			async function onExport() {
				if (!tree || !doc || exporting) return;
				setExporting(true);
				setExportError("");
				try {
					await exportPng(tree, doc.rootTitle);
				} catch (error) {
					setExportError(String(error?.message ?? error));
				} finally {
					setExporting(false);
				}
			}

			//#region 013 目录树 tab：懒加载树 + 把指令填进聊天输入框
			// 主路径 = inputActions.setDraft（官方公共面，整串替换草稿）；
			// 无则降级剪贴板复制 + 面板内提示。
			function fillDraft(text) {
				try {
					if (inputActions && typeof inputActions.setDraft === "function") {
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
				let sent = false;
				if (inputActions && typeof inputActions.setDraft === "function") {
					try {
						inputActions.setDraft(text);
						if (typeof inputActions.submit === "function") {
							inputActions.submit();
							sent = true;
						}
					} catch {
						// 落剪贴板降级
					}
				}
				if (sent) {
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

			// 拉取一层目录（path 缺省 = 会话 cwd 根）。host 路由 /mindmap/api/tree
			// 只读；返回 {path, cwd, entries:[{name,path,isDir,hidden}], truncated}。
			async function loadTree(path) {
				const key = path === undefined || path === null ? "" : path;
				setFsTree((prev) => ({ ...prev, loading: { ...prev.loading, [key]: true }, error: null }));
				try {
					if (!mindmapFace || typeof mindmapFace.listTree !== "function") throw new Error("目录树能力不可用");
					const listing = await mindmapFace.listTree(sessionId, typeof path === "string" && path ? path : undefined);
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
				} catch (error) {
					setFsTree((prev) => ({ ...prev, loading: { ...prev.loading, [key]: false }, error: String(error?.message ?? error) }));
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
				if (!fsTree.nodes[entry.path]) await loadTree(entry.path);
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
				if (!sessionId) return;
				setFsTree({ nodes: {}, expanded: {}, loading: {}, cwd: null, error: null });
				loadTree(undefined);
			}, [sessionId]);

			const treeRows = react.useMemo(
				() => visibleTreeRows(fsTree.nodes, fsTree.expanded),
				[fsTree.nodes, fsTree.expanded],
			);

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
							(0, react_jsx_runtime.jsx)("span", {
								style: { flex: "0 1 auto", overflow: "hidden", textOverflow: "ellipsis", minWidth: 0 },
								children: expandedNow ? `📂 ${node.name}` : `📁 ${node.name}`,
							}),
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
				const expandedNow = entry.isDir && Boolean(fsTree.expanded[entry.path]);
				const hovered = hoverKey === entry.path;
				const style = {
					...S.treeRow,
					paddingLeft: depthPad,
					...(entry.isDir || isMd ? S.treeRowClickable : {}),
					...(isMd ? S.treeRowMd : entry.isDir ? {} : S.treeRowOther),
					...(entry.hidden ? { opacity: 0.6 } : {}),
					...(hovered ? S.treeRowHover : {}),
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
							(0, react_jsx_runtime.jsx)("span", { style: { overflow: "hidden", textOverflow: "ellipsis", minWidth: 0 }, children: expandedNow ? `📂 ${entry.name}` : `📁 ${entry.name}` }),
						],
					});
				}
				return (0, react_jsx_runtime.jsxs)("div", {
					key: entry.path,
					style,
					title: isMd ? `打开脑图：${entry.path}` : entry.path,
					onClick: isMd ? () => openMindmap(entry) : undefined,
					onMouseEnter: () => setHoverKey(entry.path),
					onMouseLeave: () => setHoverKey((k) => (k === entry.path ? null : k)),
					// 右键：.md 不弹菜单（左键即打开）；非 .md 只拦掉默认菜单。
					onContextMenu: (e) => {
						e.preventDefault();
						e.stopPropagation();
					},
					children: [
						isMd
							? (0, react_jsx_runtime.jsx)("span", { style: S.mdBadge, children: "M" })
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
				return (0, react_jsx_runtime.jsxs)("div", { style: S.loadingWrap, children: [
					(0, react_jsx_runtime.jsxs)("svg", { width: 22, height: 22, viewBox: "0 0 22 22", children: [
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
					(0, react_jsx_runtime.jsx)("p", { style: S.loadingText, children: "AI 正在打开脑图…" }),
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

			return (0, react_jsx_runtime.jsxs)("div", { ref: panelRootRef, style: S.root, children: [
				// 010 对齐聊天区 ::after 分隔线(它在 bottom:1px height:1px,线在元素底边上方 1px);
				// 面板 border-bottom 贴底,需 height = headerHeight - 1 抵消。
				// hook 内 HEADER_MIN=40 保证减 1 后 ≥ 39,无需 clamp。
				// 013 头部改列布局:上行=导出/✕,下行=tab 行(贴底线)。
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
							onClick: () => mindmapFace.layout.closeDetails(),
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
				(0, react_jsx_runtime.jsx)("div", { style: S.body, children: active === TREE_TAB
					? renderTree()
					: (doc && doc.op === "local")
						? renderLoading()
						: tree
							? (0, react_jsx_runtime.jsx)(TreeRow, { node: tree })
							: renderTree() }),
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

		function apply(ctx) {
			const face = { layout: ctx.layout };

			// 013 目录树 tab：host 自建只读路由 /mindmap/api/tree（dsh-better-sidebar
			// 同款机制——官方 host.listDirectory 在 native picker 环境必挂，见 013）。
			// 客户端只读目录，仍无任何写文件通道。
			face.listTree = async (sessionId, path) => {
				const response = await fetch("/mindmap/api/tree", {
					method: "POST",
					headers: { "content-type": "application/json" },
					body: JSON.stringify(typeof path === "string" && path ? { sessionId, path } : { sessionId }),
				});
				const parsed = await response.json().catch(() => null);
				if (!response.ok || parsed === null || parsed.ok !== true || !parsed.value) {
					throw new Error(parsed?.error?.message ?? `HTTP ${response.status}`);
				}
				return parsed.value;
			};

			// details 是 single 槽且被官方 DetailsPanel 占据（priority 0）；
			// 必须显式 -1 才能合法顶替（lowest renders，003 实测）。
			ctx.slots.inject("details", () => ctx.slots.register({
				name: "details",
				priority: -1,
				inject: () => ({ mindmapFace: face }),
			}, MindmapDetailsPanel));

			// header 动作行是 list 槽，追加式零冲突（002 静态 + 003 实测①-c）。
			ctx.slots.inject("conversation.session.header.actions", () => ctx.slots.register({
				name: "conversation.session.header.actions",
				id: "dsh-mindmap",
				order: 100,
				inject: () => ({ mindmapFace: face }),
			}, MindmapButton));
		}

		exports.apply = apply;
		exports.inject = inject;
		exports.internals = Object.freeze({
			parseMarkdownToTree,
			reduceDocuments,
			mergeDocuments,
			resultTextOfBlocks,
			stemOf,
			buildExportSvg,
			createIdFactory,
			relPathWithin,
			visibleTreeRows,
			TOOL_NAMES,
			OPENING_OPS,
		});
		return module.exports;
	}
});

// dsh-mindmap —— 浏览器半边（ModuleLoader 单文件模块，无外部依赖）。
//
// 职责：
// - 「思维脑图」按钮：挂 conversation.session.header.actions（list 槽，追加式），
//   点击切换右侧悬浮脑图面板的开/合；面板宿主层（fixed）与按钮同槽位渲染，
//   会话能力（useSession/sessionId/inputActions）经 props 直给面板组件。
// - 脑图面板：014 起注册在 shell.overlay（list 槽、root scope、点击穿透层），
//   右缘贴边全高悬浮、左缘拖拽调宽（280~80% 视口，localStorage 持久化）；
//   details 槽已归还官方（原生「工具详情」栏恢复，003 的顶替方案退役）。
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

		const inject = ["slots"];

		// host 半边四个工具名（见 index.js）；面板只认这些工具的结果。
		const TOOL_NAMES = new Set(["mindmap_create", "mindmap_open", "mindmap_get", "mindmap_update"]);
		// 这些 op 的「新到达」会触发面板自动展开（001 场景 1；001 决策 5：AI 自动
		// 打开与手动开关并存）。update 不自动开面板，避免打扰正在看别的的用户。
		const OPENING_OPS = new Set(["create", "open"]);

		const EMPTY_NODES = [];

		// 015 节点颜色主题（三风格：海洋蓝 / 落日橙 / 森林绿）。
		// 根盒用主题色淡底 + 半透明描边；标题节点文字用主题主色；背景永远跟随全局。
		const COLOR_THEMES = {
			ocean: { rootBg: "rgba(59,91,219,0.10)", rootBorder: "rgba(59,91,219,0.45)", heading: "#3b5bdb" },
			sunset: { rootBg: "rgba(232,110,52,0.10)", rootBorder: "rgba(232,110,52,0.45)", heading: "#d96b2a" },
			forest: { rootBg: "rgba(42,157,104,0.10)", rootBorder: "rgba(42,157,104,0.45)", heading: "#2a9d68" },
		};
		/** 颜色主题名 → 色值令牌（未知名回落海洋蓝）。 */
		function colorThemeTokens(name) {
			return COLOR_THEMES[name] || COLOR_THEMES.ocean;
		}

		// 015 设置变更总线：设置面板保存成功后 bump；脑图面板订阅 stamp 重读主题。
		// 面板组件常驻不卸载，open 不变时不会自行重读——靠总线驱动
		// （闭包实现，不依赖 this）。
		const settingsBus = (() => {
			let stamp = 0;
			const listeners = new Set();
			return {
				get: () => stamp,
				bump() {
					stamp += 1;
					for (const fn of listeners) fn(stamp);
				},
				subscribe(fn) {
					listeners.add(fn);
					return () => {
						listeners.delete(fn);
					};
				},
			};
		})();

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
		 * 返回文档集及最近一次 create/open 意图，用于驱动面板自动切换目标。
		 */
		function reduceDocuments(nodes) {
			const byPath = Object.create(null);
			let order = [];
			let latestOpeningPath = null;
			let latestOpeningEventKey = null;
			for (const [nodeIndex, node] of (nodes ?? []).entries()) {
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
				const op = typeof parsed.op === "string" ? parsed.op : name;
				// callId 是正常路径下的事件身份；nodeIndex 是无 callId 时的稳定兜底，
				// 避免同一文档重复 mindmap_open 被误判成同一个事件。
				const eventKey = node.callId != null && String(node.callId)
					? `call:${String(node.callId)}`
					: `node:${nodeIndex}`;
				const previous = byPath[parsed.path];
				const openingEventKey = OPENING_OPS.has(op)
					? eventKey
					: (previous?.openingEventKey ?? null);
				if (OPENING_OPS.has(op)) {
					latestOpeningPath = parsed.path;
					latestOpeningEventKey = eventKey;
				}
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
					op,
					callId: node.callId,
					eventKey,
					openingEventKey,
					// 013：rename 迁移后保留旧路径，供本地直读 tab 清理（mergeDocuments）。
					renamedFrom: typeof parsed.renamedFrom === "string" ? parsed.renamedFrom : null,
				};
			}
			return { order, byPath, latestOpeningPath, latestOpeningEventKey };
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
			return {
				order,
				byPath,
				latestOpeningPath: snapshot.latestOpeningPath ?? null,
				latestOpeningEventKey: snapshot.latestOpeningEventKey ?? null,
			};
		}

		/**
		 * 找到本次快照需要自动展示的脑图路径。
		 * seenKeys 为 null 表示首次挂载：恢复历史会话最近一次 create/open；
		 * 否则只响应尚未消费的打开事件。
		 */
		function autoOpenTarget(snapshot, seenKeys) {
			if (!snapshot || !snapshot.latestOpeningPath || !snapshot.byPath?.[snapshot.latestOpeningPath]) return null;
			if (seenKeys === null) return snapshot.latestOpeningPath;
			const latest = snapshot.byPath[snapshot.latestOpeningPath];
			if (latest.openingEventKey && !seenKeys.has(latest.openingEventKey)) return snapshot.latestOpeningPath;
			let target = null;
			for (const p of snapshot.order ?? []) {
				const doc = snapshot.byPath[p];
				if (doc?.openingEventKey && !seenKeys.has(doc.openingEventKey)) target = p;
			}
			return target;
		}

		function openingEventKeys(snapshot) {
			return new Set((snapshot?.order ?? [])
				.map((p) => snapshot.byPath[p]?.openingEventKey)
				.filter((key) => key != null));
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
			// 014 overlay 外壳：右缘贴边全高悬浮面板，点击穿透层里自 opt-in pointer-events。
			panelHost: { position: "fixed", top: 0, right: 0, bottom: 0, left: 0, pointerEvents: "none", zIndex: 40 },
			overlayRoot: { position: "absolute", top: 0, right: 0, bottom: 0, display: "flex", flexDirection: "column", background: "var(--dsw-alias-bg-base)", color: "var(--dsw-alias-label-primary)", fontSize: "13px", minWidth: 0, borderLeft: "1px solid var(--dsw-alias-border-l2)", boxShadow: "-8px 0 24px rgba(16,24,40,0.10)", pointerEvents: "auto" },
			overlayHandle: { position: "absolute", left: -4, top: 0, bottom: 0, width: 8, cursor: "col-resize", zIndex: 1 },
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
			// 015 设置面板（settings.section 页面内容）。
			settingsWrap: { display: "flex", flexDirection: "column", gap: "12px", padding: "16px", maxWidth: "480px" },
			settingsGroup: { display: "flex", flexDirection: "column", gap: "14px", border: "1px solid var(--dsw-alias-border-l2)", borderRadius: "12px", padding: "14px", background: "var(--dsw-alias-bg-layer-3)" },
			settingsGroupTitle: { fontSize: "13px", fontWeight: 600, color: "var(--dsw-alias-label-primary)", margin: "4px 0 0" },
			settingsRow: { display: "flex", alignItems: "center", gap: "12px", fontSize: "13px", color: "var(--dsw-alias-label-primary)" },
			settingsLabel: { flex: "1 1 auto", minWidth: 0, color: "var(--dsw-alias-label-secondary)" },
			settingsInput: { width: "72px", padding: "4px 8px", borderRadius: "6px", border: "1px solid var(--dsw-alias-border-l2)", background: "var(--dsw-alias-bg-base)", color: "var(--dsw-alias-label-primary)", font: "inherit", fontSize: "13px" },
			settingsHint: { color: "var(--dsw-alias-label-tertiary)", fontSize: "12px", lineHeight: 1.6, margin: "0" },
			settingsNotice: { color: "var(--dsw-alias-state-success-primary, #1a7f37)", fontSize: "12px", margin: "0" },
			settingsError: { color: "var(--dsw-alias-label-error)", fontSize: "12px", lineHeight: 1.6, margin: "0" },
			// 分段选择控件（线型/卡片风格）
			segmentRow: { display: "inline-flex", gap: "4px", padding: "3px", borderRadius: "8px", background: "var(--dsw-alias-bg-base)", border: "1px solid var(--dsw-alias-border-l2)" },
			segmentBtn: { border: "none", background: "none", cursor: "pointer", font: "inherit", fontSize: "12px", padding: "3px 12px", borderRadius: "6px", color: "var(--dsw-alias-label-secondary)", lineHeight: "18px" },
			segmentBtnActive: { background: "var(--dsw-alias-bg-layer-3)", color: "var(--dsw-alias-label-primary)", boxShadow: "0 1px 2px rgba(16,24,40,0.08)" },
			// 颜色主题色板
			swatchRow: { display: "flex", gap: "6px", flex: "1 1 auto", justifyContent: "flex-end" },
			swatchBtn: { display: "inline-flex", alignItems: "center", gap: "6px", border: "1px solid var(--dsw-alias-border-l2)", background: "var(--dsw-alias-bg-base)", cursor: "pointer", font: "inherit", fontSize: "12px", padding: "3px 10px", borderRadius: "8px", color: "var(--dsw-alias-label-secondary)", lineHeight: "18px" },
			swatchActive: { borderColor: "var(--dsw-alias-state-business-primary)", color: "var(--dsw-alias-label-primary)", boxShadow: "inset 0 0 0 1px var(--dsw-alias-state-business-primary)" },
			swatchDot: { width: "10px", height: "10px", borderRadius: "50%", flex: "none" },
			row: { display: "flex", alignItems: "center", minWidth: 0 },
			childrenColumn: { display: "flex", flexDirection: "column", gap: "8px", marginLeft: "40px", minWidth: 0 },
			// 面板树连线层：正交折线（MarkGrove 的 orthogonalPath 风格），
			// 覆盖整行、点击穿透、置于节点盒之下。
			edgeLayer: { position: "absolute", top: 0, left: 0, width: "100%", height: "100%", pointerEvents: "none", overflow: "visible" },
			box: { padding: "6px 12px", borderRadius: "10px", border: "1px solid var(--dsw-alias-border-l2)", background: "var(--dsw-alias-bg-layer-3)", maxWidth: "240px", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", flex: "0 0 auto", boxShadow: "0 1px 2px rgba(16,24,40,0.04)" },
			rootBox: { fontWeight: 700, fontSize: "14px", border: "1px solid var(--dsw-alias-border-l2-darkmode-thin, #b9c0cc)", background: "var(--dsw-alias-bg-module-platform, #eef2ff)" },
			headingBox: { fontWeight: 600 },
			placeholderBox: { padding: "6px 12px", borderRadius: "10px", border: "1px dashed var(--dsw-alias-border-l2)", color: "var(--dsw-alias-label-tertiary)", background: "none" },
			codeBox: { fontFamily: "Menlo, monospace", fontSize: "12px" },
		};

		/** 015 分段选择控件（线型/卡片风格）。 */
		function Segmented(props) {
			const { options, value, onChange, disabled } = props;
			return (0, react_jsx_runtime.jsx)("div", { style: S.segmentRow, children: options.map((opt) => (0, react_jsx_runtime.jsx)("button", {
				key: opt.value,
				type: "button",
				style: value === opt.value ? { ...S.segmentBtn, ...S.segmentBtnActive } : S.segmentBtn,
				disabled,
				onClick: () => onChange(opt.value),
				children: opt.label,
			}, opt.value)) });
		}

		/**
		 * 015 设置面板（settings.section 页面，root scope）：读写 host 的
		 * settings namespace "mindmap"。节点主题三件套（线/卡片/颜色）+ 面板宽度；
		 * requireApproval 按作者要求隐藏（功能保留，经 config/API 仍可设）。
		 */
		function SettingsPanel(props) {
			const { mindmapFace } = props;
			const [value, setValue] = react.useState(null);
			const [saving, setSaving] = react.useState(false);
			const [notice, setNotice] = react.useState("");
			const [error, setError] = react.useState("");

			react.useEffect(() => {
				let alive = true;
				(async () => {
					try {
						const v = mindmapFace && typeof mindmapFace.readSettings === "function" ? await mindmapFace.readSettings() : null;
						if (!alive) return;
						if (v === null) setError("设置服务不可用：settings namespace 未注册或 connection 缺失");
						setValue({
							lineStyle: v && v.lineStyle === "curve" ? "curve" : "elbow",
							cardStyle: v && v.cardStyle === "square" ? "square" : "rounded",
							colorTheme: v && COLOR_THEMES[v.colorTheme] ? v.colorTheme : "ocean",
							defaultPanelWidth: v && typeof v.defaultPanelWidth === "number" ? v.defaultPanelWidth : 42,
						});
					} catch (err) {
						if (alive) setError(String(err?.message ?? err));
					}
				})();
				return () => {
					alive = false;
				};
			}, [mindmapFace]);

			async function save(patch) {
				setSaving(true);
				setError("");
				setNotice("");
				try {
					if (!mindmapFace || typeof mindmapFace.updateSettings !== "function") throw new Error("settings service unavailable");
					await mindmapFace.updateSettings(patch);
					settingsBus.bump(); // 通知脑图面板重读主题（面板常驻，open 不变）
					setNotice("已保存");
				} catch (err) {
					setError(String(err?.message ?? err));
				} finally {
					setSaving(false);
				}
			}

			if (value === null) {
				return (0, react_jsx_runtime.jsx)("div", { style: S.settingsWrap, children: error
					? (0, react_jsx_runtime.jsx)("p", { style: S.settingsError, children: error })
					: (0, react_jsx_runtime.jsx)("p", { style: S.settingsHint, children: "正在读取设置…" }) });
			}

			const setField = (patch) => {
				setValue({ ...value, ...patch });
				save(patch);
			};
			const changeWidth = (e) => {
				const raw = Number(e.target.value);
				const next = Number.isFinite(raw) ? Math.min(80, Math.max(20, Math.round(raw))) : value.defaultPanelWidth;
				setValue({ ...value, defaultPanelWidth: next });
			};
			const commitWidth = () => {
				save({ defaultPanelWidth: value.defaultPanelWidth });
			};

			return (0, react_jsx_runtime.jsxs)("div", { style: S.settingsWrap, children: [
				(0, react_jsx_runtime.jsx)("p", { style: S.settingsGroupTitle, children: "节点主题" }),
				(0, react_jsx_runtime.jsxs)("div", { style: S.settingsGroup, children: [
					(0, react_jsx_runtime.jsxs)("div", { style: S.settingsRow, children: [
						(0, react_jsx_runtime.jsx)("span", { style: S.settingsLabel, children: "线" }),
						(0, react_jsx_runtime.jsx)(Segmented, {
							options: [{ value: "elbow", label: "折线" }, { value: "curve", label: "曲线" }],
							value: value.lineStyle,
							disabled: saving,
							onChange: (v) => setField({ lineStyle: v }),
						}),
					] }),
					(0, react_jsx_runtime.jsxs)("div", { style: S.settingsRow, children: [
						(0, react_jsx_runtime.jsx)("span", { style: S.settingsLabel, children: "卡片" }),
						(0, react_jsx_runtime.jsx)(Segmented, {
							options: [{ value: "rounded", label: "圆角" }, { value: "square", label: "直角" }],
							value: value.cardStyle,
							disabled: saving,
							onChange: (v) => setField({ cardStyle: v }),
						}),
					] }),
					(0, react_jsx_runtime.jsxs)("div", { style: S.settingsRow, children: [
						(0, react_jsx_runtime.jsx)("span", { style: S.settingsLabel, children: "颜色" }),
						(0, react_jsx_runtime.jsx)("div", { style: S.swatchRow, children: [
							{ value: "ocean", label: "海洋蓝" },
							{ value: "sunset", label: "落日橙" },
							{ value: "forest", label: "森林绿" },
						].map((t) => {
							const tokens = colorThemeTokens(t.value);
							return (0, react_jsx_runtime.jsxs)("button", {
								key: t.value,
								type: "button",
								style: value.colorTheme === t.value ? { ...S.swatchBtn, ...S.swatchActive } : S.swatchBtn,
								disabled: saving,
								onClick: () => setField({ colorTheme: t.value }),
								children: [
									(0, react_jsx_runtime.jsx)("span", { style: { ...S.swatchDot, background: tokens.heading } }),
									t.label,
								],
							}, t.value);
						}) }),
					] }),
				] }),
				(0, react_jsx_runtime.jsx)("p", { style: S.settingsHint, children: "主题改动在脑图面板下次打开时生效；背景色始终跟随全局主题。" }),
				(0, react_jsx_runtime.jsx)("p", { style: S.settingsGroupTitle, children: "面板" }),
				(0, react_jsx_runtime.jsxs)("div", { style: S.settingsGroup, children: [
					(0, react_jsx_runtime.jsxs)("div", { style: S.settingsRow, children: [
						(0, react_jsx_runtime.jsx)("span", { style: S.settingsLabel, children: "默认宽度（%）" }),
						(0, react_jsx_runtime.jsx)("input", {
							type: "number",
							min: 20,
							max: 80,
							value: value.defaultPanelWidth,
							disabled: saving,
							onChange: changeWidth,
							onBlur: commitWidth,
							style: S.settingsInput,
						}),
					] }),
					(0, react_jsx_runtime.jsx)("p", { style: S.settingsHint, children: "范围 20~80。拖拽面板后的宽度会记住（localStorage）；清除本地记忆后回到这里配置的默认值。" }),
				] }),
				saving ? (0, react_jsx_runtime.jsx)("p", { style: S.settingsHint, children: "保存中…" }) : null,
				notice ? (0, react_jsx_runtime.jsx)("p", { style: S.settingsNotice, children: notice }) : null,
				error ? (0, react_jsx_runtime.jsx)("p", { style: S.settingsError, children: error }) : null,
			] });
		}

		/**
		 * 「思维脑图」槽位组件（014）：同一槽位渲染 M 按钮 + 悬浮面板宿主层。
		 * session scope 的 useSession/sessionId/inputActions 直给，经 props 传给
		 * MindmapDetailsPanel（无桥、无 useSyncExternalStore——shell.overlay 跨槽
		 * 方案实测未渲染，弃用后顺手把桥也删了）。
		 */
		function MindmapSlot(props) {
			const { useSession, sessionId, inputActions, mindmapFace } = props;
			const nodes = useSession ? useSession((s) => (s && s.nodes) || EMPTY_NODES) : EMPTY_NODES;
			const [open, setOpen] = react.useState(false);
			return (0, react_jsx_runtime.jsxs)(react.Fragment, { children: [
				(0, react_jsx_runtime.jsxs)("button", {
					type: "button",
					title: "脑图面板：展开 / 收起",
					style: S.mButton,
					onClick: () => setOpen((v) => !v),
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
				}),
				(0, react_jsx_runtime.jsx)(MindmapDetailsPanel, {
					open,
					sessionId,
					inputActions,
					nodes,
					mindmapFace,
					onOpen: () => setOpen(true),
					onClose: () => setOpen(false),
				}),
			] });
		}

		function NodeBox(props) {
			const { node, theme } = props;
			// 015 节点主题：卡片圆角（圆角/直角）+ 颜色主题令牌（根盒/标题用主题色）。
			const tokens = colorThemeTokens(theme && theme.colorTheme);
			const radius = theme && theme.cardStyle === "square" ? 0 : 10;
			const style = node.kind === "root"
				? { ...S.box, ...S.rootBox, borderRadius: radius, borderColor: tokens.rootBorder, background: tokens.rootBg }
				: node.kind === "heading"
					? { ...S.box, ...S.headingBox, borderRadius: radius, color: tokens.heading }
					: node.kind === "placeholder"
						? { ...S.placeholderBox, borderRadius: radius }
						: node.kind === "code"
							? { ...S.box, ...S.codeBox, borderRadius: radius }
							: { ...S.box, borderRadius: radius };
			const title = node.data?.description
				? `${node.topic}\n\n${node.data.description}`
				: node.data?.code
					? `${node.topic}\n\n${node.data.code}`
					: node.topic;
			return (0, react_jsx_runtime.jsx)("div", { style, title, children: node.kind === "placeholder" ? "待填写" : node.topic });
		}

		/** 左→右递归树：节点盒 + 右侧子节点列 + 连线层（015 支持折线/曲线两种线型）。 */
		function TreeRow(props) {
			const { node, theme } = props;
			const rowRef = react.useRef(null);
			const boxWrapRef = react.useRef(null);
			const childRefs = react.useRef([]);
			const [edges, setEdges] = react.useState([]);
			const prevEdgesRef = react.useRef("");

			// 测量父盒右缘与各子节点包裹块的几何位置，画连线
			// （折线 = M x1 y1 H midX V y2 H x2；曲线 = 贝塞尔水平切出）；
			// 序列化比对防 setState 循环。
			react.useLayoutEffect(() => {
				const rowEl = rowRef.current;
				const boxEl = boxWrapRef.current;
				if (!rowEl || !boxEl) return;
				const curve = theme && theme.lineStyle === "curve";
				const measure = () => {
					const rowRect = rowEl.getBoundingClientRect();
					const boxRect = boxEl.getBoundingClientRect();
					const next = [];
					for (const ref of childRefs.current) {
						if (!ref) continue;
						const c = ref.getBoundingClientRect();
						const x1 = boxRect.right - rowRect.left;
						const y1 = boxRect.top - rowRect.top + boxRect.height / 2;
						const x2 = c.left - rowRect.left;
						const y2 = c.top - rowRect.top + c.height / 2;
						const midX = (x1 + x2) / 2;
						next.push(curve
							? `M ${x1} ${y1} C ${midX} ${y1}, ${midX} ${y2}, ${x2} ${y2}`
							: `M ${x1} ${y1} H ${midX} V ${y2} H ${x2}`);
					}
					const key = next.join("|");
					if (prevEdgesRef.current === key) return;
					prevEdgesRef.current = key;
					setEdges(next);
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

			return (0, react_jsx_runtime.jsxs)("div", { ref: rowRef, style: { ...S.row, position: "relative" }, children: [
				edges.length > 0
					? (0, react_jsx_runtime.jsx)("svg", {
						style: S.edgeLayer,
						children: edges.map((d, i) => (0, react_jsx_runtime.jsx)("path", {
							key: i,
							d,
							stroke: "var(--dsw-alias-border-l2)",
							strokeWidth: 1.5,
							fill: "none",
						}, i)),
					})
					: null,
				(0, react_jsx_runtime.jsx)("div", { ref: boxWrapRef, style: { flex: "0 0 auto" }, children: (0, react_jsx_runtime.jsx)(NodeBox, { node, theme }) }),
				node.children && node.children.length > 0
					? (0, react_jsx_runtime.jsx)("div", { style: S.childrenColumn, children: node.children.map((child, idx) => (0, react_jsx_runtime.jsx)("div", {
						key: child.id,
						ref: (el) => {
							childRefs.current[idx] = el;
						},
						children: (0, react_jsx_runtime.jsx)(TreeRow, { node: child, theme }),
					}, child.id)) })
					: null,
			] });
		}

		function MindmapDetailsPanel(props) {
			// 014：面板与 M 按钮同槽位（conversation.session.header.actions），
			// 会话能力（sessionId/inputActions/nodes）与开合回调全部由 MindmapSlot
			// 经 props 直给（无桥、无 useSyncExternalStore）。
			const { mindmapFace, open, sessionId, inputActions, nodes, onOpen, onClose } = props;
			const docs = react.useMemo(() => reduceDocuments(nodes), [nodes]);
			// 013：本地加载占位文档（左键点 .md 秒建 tab、内容为空），与快照文档
			// 合并显示；快照优先（AI 结果覆盖占位）。
			const [localDocs, setLocalDocs] = react.useState({});
			const merged = react.useMemo(() => mergeDocuments(docs, localDocs), [docs, localDocs]);
			// 014 overlay 宽度：localStorage 持久化，拖拽钳制 [280, 视口 80%]。
			const WIDTH_KEY = "dsh-mindmap.overlay-width";
			const [panelWidth, setPanelWidth] = react.useState(() => {
				try {
					const saved = Number(localStorage.getItem(WIDTH_KEY));
					if (Number.isFinite(saved) && saved >= 280) return Math.min(saved, Math.round(window.innerWidth * 0.8));
				} catch {
					// localStorage 不可用：走默认
				}
				return Math.round(window.innerWidth * 0.42);
			});
			react.useEffect(() => {
				if (panelWidth > Math.round(window.innerWidth * 0.8)) {
					setPanelWidth(Math.round(window.innerWidth * 0.8));
				}
			}, []);
			// 015 设置面板：没有本地拖拽记忆时，用 settings 里的默认宽度。
			react.useEffect(() => {
				let hasLocal = false;
				try {
					hasLocal = localStorage.getItem(WIDTH_KEY) !== null;
				} catch {
					// 忽略
				}
				if (hasLocal) return;
				if (!mindmapFace || typeof mindmapFace.readSettings !== "function") return;
				mindmapFace.readSettings().then((v) => {
					const pct = v && typeof v.defaultPanelWidth === "number" ? Math.min(80, Math.max(20, v.defaultPanelWidth)) : 42;
					const px = Math.round(window.innerWidth * pct / 100);
					setPanelWidth((prev) => (Math.abs(prev - px) < 2 ? prev : px));
				}).catch(() => {
					// 读设置失败：保持 42% 默认
				});
			}, [mindmapFace]);

			// 015 节点主题：面板每次打开、或设置总线 bump（设置页保存）时重读
			// settings——面板常驻不卸载，光靠 open 变化会漏掉「开着面板改设置」。
			const settingsStamp = react.useSyncExternalStore(settingsBus.subscribe, settingsBus.get);
			const [theme, setTheme] = react.useState({ lineStyle: "elbow", cardStyle: "rounded", colorTheme: "ocean" });
			react.useEffect(() => {
				if (!open) return;
				if (!mindmapFace || typeof mindmapFace.readSettings !== "function") return;
				mindmapFace.readSettings().then((v) => {
					if (!v) return;
					setTheme({
						lineStyle: v.lineStyle === "curve" ? "curve" : "elbow",
						cardStyle: v.cardStyle === "square" ? "square" : "rounded",
						colorTheme: COLOR_THEMES[v.colorTheme] ? v.colorTheme : "ocean",
					});
				}).catch(() => {
					// 读设置失败：保持当前主题
				});
			}, [open, settingsStamp, mindmapFace]);
			const dragStateRef = react.useRef(null);
			function startResize(e) {
				e.preventDefault();
				dragStateRef.current = { startX: e.clientX, startWidth: panelWidth, latestWidth: panelWidth };
				const onMove = (ev) => {
					if (!dragStateRef.current) return;
					const max = Math.round(window.innerWidth * 0.8);
					const next = Math.min(max, Math.max(280, dragStateRef.current.startWidth + (dragStateRef.current.startX - ev.clientX)));
					dragStateRef.current.latestWidth = next;
					setPanelWidth(next);
				};
				const onUp = () => {
					try {
						localStorage.setItem(WIDTH_KEY, String(dragStateRef.current ? dragStateRef.current.latestWidth : panelWidth));
					} catch {
						// localStorage 不可用：忽略
					}
					dragStateRef.current = null;
					window.removeEventListener("mousemove", onMove);
					window.removeEventListener("mouseup", onUp);
				};
				window.addEventListener("mousemove", onMove);
				window.addEventListener("mouseup", onUp);
			}
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

			// 007~010 头线对齐（overlay 版回归）：面板头部高度动态跟随聊天区头部，
			// 让两者的底部分隔线像素对齐。面板贴视口顶（fixed 宿主层），故
			// 头部高度 = 聊天头部 rect.bottom - 1 - 面板顶（面板顶 ≈ 视口顶）。
			// 主选 wSkVaW_header；结构链回退；合法性钳制 [40,200]；失败回退 74（75-1）。
			const panelRootRef = react.useRef(null);
			const FALLBACK_HEADER_HEIGHT = 74;
			const [headerHeight, setHeaderHeight] = react.useState(FALLBACK_HEADER_HEIGHT);
			react.useLayoutEffect(() => {
				const HEADER_MIN = 40;
				const HEADER_MAX = 200;
				const tryPaths = [
					() => document.querySelector('[class*="wSkVaW_header"]'),
					() => {
						const frame = document.querySelector("[data-dsh-frame]");
						if (!frame) return null;
						const center = frame.querySelector('[data-pane="conversation"]');
						return center ? center.firstElementChild : null;
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
						const h = rect.bottom - 1 - panelTop;
						if (h >= HEADER_MIN && h <= HEADER_MAX) {
							setHeaderHeight(Math.round(h * 10) / 10);
							return;
						}
					}
					setHeaderHeight(FALLBACK_HEADER_HEIGHT);
				};
				measure();
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

			// AI 自动打开：create/open 代表用户明确的「创建 / 打开 / 查看」意图。
			// 无论面板当前是否收起，都展开并切到这次意图对应的文档；首次挂载的
			// 历史快照也照常显示最近一次打开的脑图，避免出现「AI 说已打开但面板没了」。
			const seen = react.useRef(null);
			react.useEffect(() => {
				const targetPath = autoOpenTarget(merged, seen.current);
				seen.current = openingEventKeys(merged);
				if (targetPath) {
					onOpen();
					setHiddenPath(null);
					setCurrentPath(targetPath);
					setView("mindmap");
				}
			}, [merged]);

			// 013「所见即所编」焦点同步：AI 焦点 = 快照里最新工具结果的文档路径；
			// 脑图视图激活且其文档 ≠ 焦点时，自动填「用 mindmap_open 打开 <它>」
			// 并发送，让 AI 跟上用户眼睛看的那颗脑图。
			const focusPath = docs.order.length > 0 ? docs.order[docs.order.length - 1] : null;
			const focusSentRef = react.useRef(null);
			react.useEffect(() => {
				if (!open) return; // 面板收起时不自动发消息（014 overlay 形态守卫）
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
			}, [active, focusPath, fsTree.cwd, docs, open]);

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
				(0, react_jsx_runtime.jsx)("div", { style: S.body, children: active === TREE_TAB
					? renderTree()
					: (doc && doc.op === "local")
						? renderLoading()
						: tree
							? (0, react_jsx_runtime.jsx)(TreeRow, { node: tree, theme })
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
			] }) });
		}
		//#endregion

		function apply(ctx) {
			const face = {};

			// 014「布局让位」CSS（better-sidebar 同款机制）：面板打开时给 #root 挂
			// margin-right + 宽度挤压，把聊天区推到左边、面板占右侧腾出的空间，
			// 互不遮挡。015 修复级联冲突：它家（dsh-better-sidebar）同样注入
			// #root 规则，后注入者胜导致我们的推挤被压掉——我们的规则加
			// !important 且把双方变量相加（它开面板时聊天同样让位），无论注入
			// 顺序如何都稳定生效。若它家未来也用 !important，需再评估（见 docs/014）。
			if (typeof document !== "undefined") {
				const style = document.createElement("style");
				style.setAttribute("data-dsh-mindmap", "layout-push");
				style.textContent = [
					"#root{",
					"margin-right:calc(var(--dsh-mindmap-width,0px) + var(--dsh-sidebar-width,0px))!important;",
					"width:calc(100% - var(--dsh-mindmap-width,0px) - var(--dsh-sidebar-width,0px))!important;",
					"transition:margin-right var(--ds-transition-duration-slow) var(--ds-ease-in-out),width var(--ds-transition-duration-slow) var(--ds-ease-in-out);",
					"}",
				].join("");
				document.head.appendChild(style);
			}

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

			// 015 设置面板：settings namespace（dsh-grafana 同款读写面）。
			// connection 走 ctx.get 可选查取（动态 ctx 契约）；缺失时设置面板降级提示。
			const connection = ctx.get("connection");
			const settingsApi = connection && typeof connection.api === "object" ? connection.api : null;
			face.readSettings = async () => {
				if (!settingsApi || typeof settingsApi.settings?.describe !== "function") return null;
				const res = await settingsApi.settings.describe({});
				const namespaces = res?.result?.value?.namespaces ?? [];
				const ns = namespaces.find((n) => n?.ns === "mindmap");
				return ns?.value ?? null;
			};
			face.updateSettings = async (patch) => {
				if (!settingsApi || typeof settingsApi.settings?.update !== "function") {
					throw new Error("settings service unavailable");
				}
				await settingsApi.settings.update({ ns: "mindmap", patch });
			};

			// 015 设置面板：settings.section（list 槽、root scope）——设置页左栏
			// 新增「思维脑图」导航项（better-sidebar 同款入口；dsh-grafana 的
			// settings.plugin.item 卡片是另一条路，未采用）。
			ctx.slots.inject("settings.section", () => ctx.slots.register({
				name: "settings.section",
				id: "dsh-mindmap",
				order: 100,
				label: "思维脑图",
				inject: () => ({ mindmapFace: face }),
			}, SettingsPanel));

			// 014 overlay 形态（作者拍板，见 docs/014）：面板宿主层（position:fixed）
			// 与 M 按钮一起渲染在 conversation.session.header.actions 槽位里——
			// better-sidebar 同款「fixed 宿主层自举」思路（它的宿主层挂在
			// conversation.chat.turnTail）；session scope 全套 props 直给，无需跨槽。
			// details 槽已归还官方（原生「工具详情」栏恢复）；shell.overlay 方案
			// 实测未渲染，已弃用（见 docs/014 排障）。
			ctx.slots.inject("conversation.session.header.actions", () => ctx.slots.register({
				name: "conversation.session.header.actions",
				id: "dsh-mindmap",
				order: 100,
				inject: () => ({ mindmapFace: face }),
			}, MindmapSlot));
		}

		exports.apply = apply;
		exports.inject = inject;
		exports.internals = Object.freeze({
			parseMarkdownToTree,
			reduceDocuments,
			mergeDocuments,
			autoOpenTarget,
			openingEventKeys,
			resultTextOfBlocks,
			stemOf,
			buildExportSvg,
			createIdFactory,
			relPathWithin,
			visibleTreeRows,
			colorThemeTokens,
			TOOL_NAMES,
			OPENING_OPS,
		});
		return module.exports;
	}
});

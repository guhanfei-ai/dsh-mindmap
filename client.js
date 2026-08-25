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

		//#region 皮肤层：令牌注册表 + 回退链 + 节点样式解析（002 规范 §7/§5）
		/**
		 * 令牌注册表（002 §7.2）：只登记实际被消费的令牌。
		 * default 一律给安全值（多数跟随宿主 --dsw-alias-* 变量，面板亮暗自动跟随）；
		 * fallback 为可选回退令牌名（回退链：专用 → 通用 → 默认）。
		 */
		const TOKEN_REGISTRY = {
			"color.surface.default": { default: "var(--dsw-alias-bg-layer-3)" },
			"color.surface.root": { default: "var(--dsw-alias-bg-module-platform, #eef2ff)", fallback: "color.surface.default" },
			"color.surface.code": { default: "var(--dsw-alias-fill-tsp-secondary)", fallback: "color.surface.default" },
			"color.surface.quote": { default: "var(--dsw-alias-bg-layer-3)", fallback: "color.surface.default" },
			"color.surface.table": { default: "var(--dsw-alias-bg-layer-3)", fallback: "color.surface.default" },
			"color.border.default": { default: "var(--dsw-alias-border-l2)" },
			"color.border.strong": { default: "var(--dsw-alias-border-l2-darkmode-thin, #b9c0cc)", fallback: "color.border.default" },
			"color.border.subtle": { default: "var(--dsw-alias-border-l2)", fallback: "color.border.default" },
			"color.border.root": { default: "var(--dsw-alias-border-l2-darkmode-thin, #b9c0cc)", fallback: "color.border.strong" },
			"color.text.primary": { default: "var(--dsw-alias-label-primary)" },
			"color.text.muted": { default: "var(--dsw-alias-label-tertiary)" },
			// 强调色族：默认值 = 海洋蓝（默认主题），各主题以覆写表换肤。
			"color.accent.root": { default: "#3b5bdb" },
			"color.accent.heading.strong": { default: "#3b5bdb", fallback: "color.accent.root" },
			"color.accent.heading.medium": { default: "#5c7cfa", fallback: "color.accent.heading.strong" },
			"color.accent.heading.subtle": { default: "#91a7ff", fallback: "color.accent.heading.medium" },
			"color.accent.code": { default: "#3b5bdb", fallback: "color.accent.root" },
			"color.accent.quote": { default: "#5c7cfa", fallback: "color.accent.heading.medium" },
			"color.state.selected": { default: "var(--dsw-alias-state-business-primary)" },
			"color.state.hovered": { default: "var(--dsw-alias-interactive-bg-hover)" },
			"connector.color": { default: "var(--dsw-alias-border-l2)", fallback: "color.border.default" },
			"connector.width": { default: 1.5 },
			"shape.radius.node": { default: 10 },
			"effect.shadow.default": { default: "0 1px 2px rgba(16,24,40,0.04)" },
			"effect.shadow.hovered": { default: "0 4px 12px rgba(16,24,40,0.10)", fallback: "effect.shadow.default" },
		};

		/**
		 * 颜色主题 = 令牌覆写表（002 §7.1）：三主题只覆写强调色族与根盒表面/描边，
		 * 其余令牌走注册表默认值。持久化格式（设置里的名字）不变。
		 */
		const COLOR_THEMES = {
			ocean: {
				"color.accent.root": "#3b5bdb",
				"color.accent.heading.strong": "#3b5bdb",
				"color.accent.heading.medium": "#5c7cfa",
				"color.accent.heading.subtle": "#91a7ff",
				"color.accent.code": "#3b5bdb",
				"color.accent.quote": "#5c7cfa",
				"color.surface.root": "rgba(59,91,219,0.10)",
				"color.border.root": "rgba(59,91,219,0.45)",
			},
			sunset: {
				"color.accent.root": "#d96b2a",
				"color.accent.heading.strong": "#d96b2a",
				"color.accent.heading.medium": "#e8834a",
				"color.accent.heading.subtle": "#f2a26d",
				"color.accent.code": "#d96b2a",
				"color.accent.quote": "#e8834a",
				"color.surface.root": "rgba(232,110,52,0.10)",
				"color.border.root": "rgba(232,110,52,0.45)",
			},
			forest: {
				"color.accent.root": "#2a9d68",
				"color.accent.heading.strong": "#2a9d68",
				"color.accent.heading.medium": "#3db57f",
				"color.accent.heading.subtle": "#6fcf9f",
				"color.accent.code": "#2a9d68",
				"color.accent.quote": "#3db57f",
				"color.surface.root": "rgba(42,157,104,0.10)",
				"color.border.root": "rgba(42,157,104,0.45)",
			},
		};

		/**
		 * 令牌解析（002 §7.4）：先沿回退链逐跳找主题覆写（全链优先），
		 * 命中即返；全链无覆写再取登记默认值（同样沿链找第一个可用默认）。
		 * 这样主题只覆写上级令牌时下级自动跟随（如只覆写 heading.strong
		 * 时 medium/subtle 也随之换色）。未登记令牌返回 null（纯函数）。
		 */
		function resolveToken(name, overrides) {
			let current = name;
			for (let hop = 0; current && hop < 8; hop++) {
				const entry = TOKEN_REGISTRY[current];
				if (!entry) break;
				if (overrides && Object.prototype.hasOwnProperty.call(overrides, current) && overrides[current] != null) {
					return overrides[current];
				}
				current = entry.fallback;
			}
			current = name;
			for (let hop = 0; current && hop < 8; hop++) {
				const entry = TOKEN_REGISTRY[current];
				if (!entry) return null;
				if (entry.default != null) return entry.default;
				current = entry.fallback;
			}
			return null;
		}

		/**
		 * 节点样式解析（002 §5 语义配方 + §6 状态）：纯函数，同输入同输出。
		 * 输入 = 节点语义身份（kind / 标题级别）+ 交互状态 + 主题覆写表；
		 * 输出 = 可直接铺进节点盒 style 的外观属性（骨架属性不在其中）。
		 */
		function resolveNodeStyle(node, options) {
			const opts = options || {};
			const overrides = COLOR_THEMES[opts.colorTheme] || COLOR_THEMES.ocean;
			const kind = node && node.kind;
			const level = node && node.data && node.data.level;
			const states = opts.states || {};
			const radius = opts.cardStyle === "square" ? 0 : resolveToken("shape.radius.node", overrides);
			const style = {
				borderRadius: radius,
				background: resolveToken("color.surface.default", overrides),
				border: `1px solid ${resolveToken("color.border.default", overrides)}`,
				color: resolveToken("color.text.primary", overrides),
				boxShadow: resolveToken("effect.shadow.default", overrides),
			};
			if (kind === "root") {
				style.background = resolveToken("color.surface.root", overrides);
				style.border = `1px solid ${resolveToken("color.border.root", overrides)}`;
				style.color = resolveToken("color.accent.root", overrides);
				style.fontWeight = 700;
				style.fontSize = "14px";
			} else if (kind === "heading") {
				// §5.2：H1-H2 强 / H3-H4 中 / H5-H6 弱。
				const tier = level <= 2 ? "strong" : level <= 4 ? "medium" : "subtle";
				style.color = resolveToken(`color.accent.heading.${tier}`, overrides);
				style.fontWeight = 600;
			} else if (kind === "code") {
				style.background = resolveToken("color.surface.code", overrides);
				style.fontFamily = "Menlo, monospace";
				style.fontSize = "12px";
			} else if (kind === "quote") {
				style.background = resolveToken("color.surface.quote", overrides);
				style.border = `1px solid ${resolveToken("color.border.subtle", overrides)}`;
				style.borderLeft = `3px solid ${resolveToken("color.accent.quote", overrides)}`;
			} else if (kind === "table") {
				style.background = resolveToken("color.surface.table", overrides);
				style.border = `1px solid ${resolveToken("color.border.subtle", overrides)}`;
			} else if (kind === "placeholder") {
				style.background = "none";
				style.border = `1px dashed ${resolveToken("color.border.default", overrides)}`;
				style.color = resolveToken("color.text.muted", overrides);
				style.boxShadow = "none";
			}
			// §6 状态叠加：hovered 抬升阴影；selected 强调环优先（两者并存时环在外）。
			if (states.hovered && kind !== "placeholder") {
				style.boxShadow = resolveToken("effect.shadow.hovered", overrides);
			}
			if (states.selected) {
				const ring = resolveToken("color.state.selected", overrides);
				style.boxShadow = `0 0 0 2px ${ring}${style.boxShadow && style.boxShadow !== "none" ? `, ${style.boxShadow}` : ""}`;
			}
			return style;
		}

		/**
		 * 导出静态亮色快照：导出 SVG 走 data-URL，宿主 CSS 变量在那里不可解析，
		 * 只能带静态十六进制色。按主题名取强调色族（未知名回落海洋蓝）。
		 */
		function exportPalette(name) {
			const theme = COLOR_THEMES[name] || COLOR_THEMES.ocean;
			return {
				rootBg: "#eef2ff",
				rootBorder: theme["color.accent.root"] || "#7c8cf8",
				rootText: theme["color.accent.heading.strong"] || "#2f3ab2",
				heading: theme["color.accent.heading.strong"] || "#3b5bdb",
				quote: theme["color.accent.quote"] || "#5c7cfa",
				surface: "#f6f7f9",
				surfaceCode: "#f5f2ea",
				border: "#d4d9e0",
				borderSubtle: "#e2e6eb",
				connector: "#c8cdd6",
				text: "#1f2430",
				muted: "#9aa2b1",
				canvasBg: "#ffffff",
			};
		}
		//#endregion

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
		
		/** 表格行 → 单元格数组（去首尾空段，保留中间空单元格）。 */
		function parseTableRow(line) {
			return String(line ?? "").trim().replace(/^\|/, "").replace(/\|$/, "").split("|").map((c) => c.trim());
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
			// 而根节点标题就是文件名——首个 H1 与根标题一致（或仅多 .md 后缀）时
			// 并入根节点，避免标题显示两次。仅文档顶层参与回声（引用内不算）。
			let firstHeadingSeen = false;
			const lines = String(markdown ?? "").split(/\r?\n/);
		
			let start = 0;
			// 跳过 YAML frontmatter（--- ... ---）
			if (lines.length > 0 && /^\s*---\s*$/.test(lines[0])) {
				for (start = 1; start < lines.length; start++) {
					if (/^\s*---\s*$/.test(lines[start])) {
						start += 1;
						break;
					}
				}
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
					if (/^\s*(```|~~~)/.test(line)) {
						flushParagraph();
						listStack = [];
						const lang = line.trim().slice(3).trim();
						const buf = [];
						for (i += 1; i < lineList.length && !/^\s*(```|~~~)/.test(lineList[i]); i++) buf.push(lineList[i]);
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
						// 首个 H1 与根标题一致（或仅多 .md 后缀）→ 并入根节点，不另建节点。
						if (echoRoot && !firstHeadingSeen && level === 1 && (text === root.topic || text === `${root.topic}.md`)) {
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
							const header = parseTableRow(rows[0]);
							const body = rows.slice(2).map(parseTableRow);
							const tableRows = [header].concat(body);
							appendNode({
								id: idOf("table", tableRows.map((r) => r.join("\u0001")).join("\u0002"), parentPathOf()),
								kind: "table",
								topic: `${tableRows.length}×${header.length} 表格`,
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

		// 016 起 reduceDocuments 与 nodesFingerprint 共用（从函数体提升到模块层）。
		const MAX_SUBCALL_DEPTH = 100;

		/**
		 * 会话节点的结构指纹（016 可靠性加固）：数组长度 + 逐节点结构身份
		 * （kind / callId / call.name / isError / subCalls 数，递归子树，深度
		 * 上限与 reduceDocuments 一致）。只含结构身份、不含 content 文本——
		 * 流式 token 增长不改变指纹，只有新工具结果节点出现才变。
		 * 用作 useSession 的第二 selector 返回值：字符串按值比较，天然绕过
		 * 「store 原地改数组、引用不变」的相等短路，驱动面板重算快照。
		 */
		function nodesFingerprint(nodes) {
			if (!Array.isArray(nodes)) return "[]";
			const parts = [String(nodes.length)];
			const visit = (node, depth) => {
				if (!node || typeof node !== "object") {
					parts.push("·");
					return;
				}
				parts.push(
					String(node.kind ?? ""),
					String(node.callId ?? ""),
					String(node.call?.name ?? ""),
					node.isError ? "E" : "-",
				);
				const subCalls = Array.isArray(node.subCalls) ? node.subCalls : null;
				parts.push(String(subCalls ? subCalls.length : 0));
				if (subCalls && subCalls.length > 0 && depth < MAX_SUBCALL_DEPTH) {
					for (const subCall of subCalls) visit(subCall, depth + 1);
				}
			};
			for (const node of nodes) visit(node, 0);
			return parts.join("|");
		}

		/** 工具错误消息提取（016）：JSON 信封的 error/message 字段优先，回落原始文本。 */
		function extractErrorMessage(parsed, text) {
			if (parsed && typeof parsed === "object") {
				if (typeof parsed.error?.message === "string" && parsed.error.message) return parsed.error.message;
				if (typeof parsed.error === "string" && parsed.error) return parsed.error;
				if (typeof parsed.message === "string" && parsed.message) return parsed.message;
			}
			const raw = String(text ?? "").trim();
			return raw || "mindmap tool failed";
		}

		/**
		 * 重放会话快照里的 mindmap_* 工具结果，得到每个脑图文档的最新状态。
		 * nodes: ConversationSnapshot.nodes（ToolResultNode 含 call.name 与渲染后的
		 * content 文本块——host 的工具结果 JSON 就写在其中）。Code 等工具的结果
		 * 还可能把真实的 mindmap ToolResultNode 放在 subCalls 中，因此这里按事件
		 * 顺序递归重放整棵调用树。
		 * 返回文档集及最近一次 create/open 意图，用于驱动面板自动切换目标。
		 */
		function reduceDocuments(nodes) {
			const byPath = Object.create(null);
			let order = [];
			let latestOpeningPath = null;
			let latestOpeningEventKey = null;
			// 016 错误捕获（S2 成因）：isError / ok!==true 的 mindmap_* 结果不进
			// 文档集（语义不变），但记录为错误信号——errorByPath（可归因路径的
			// 最近错误）+ latestError（最近一次 mindmap 错误，含无路径归因的）。
			const errorByPath = Object.create(null);
			let latestError = null;
			const visited = new WeakSet();

			function replayNode(node, eventPath, depth) {
				if (!node || typeof node !== "object" || visited.has(node)) return;
				visited.add(node);

				if (node.kind === "tool-result") {
					const name = node.call?.name;
					if (typeof name === "string" && TOOL_NAMES.has(name)) {
						const text = resultTextOfBlocks(node.content);
						let parsed;
						try {
							parsed = JSON.parse(text);
						} catch {
							parsed = null;
						}
						// callId 是实际调用的事件身份；eventPath 是无 callId 时按会话
						// 遍历顺序生成的稳定兜底，避免重复 open 被合并成一个事件。
						const callId = node.callId != null && String(node.callId)
							? node.callId
							: node.call?.callId;
						const eventKey = callId != null && String(callId)
							? `call:${String(callId)}`
							: `node:${eventPath}`;
						if (!node.isError && parsed && parsed.ok === true && typeof parsed.path === "string" && parsed.path) {
							const op = typeof parsed.op === "string" ? parsed.op : name;
							const renamedFrom = typeof parsed.renamedFrom === "string" ? parsed.renamedFrom : null;
							const previous = byPath[parsed.path];
							const renamedDocument = renamedFrom && renamedFrom !== parsed.path
								? byPath[renamedFrom]
								: null;
							const inheritedOpeningEventKey = renamedDocument?.openingEventKey
								?? previous?.openingEventKey
								?? (renamedFrom && latestOpeningPath === renamedFrom ? latestOpeningEventKey : null);

							// 根节点改名会删除旧路径键；若旧路径正是最近一次打开意图，
							// 同时迁移路径并保留原 openingEventKey，确保自动切换仍生效。
							if (renamedFrom && renamedFrom !== parsed.path && latestOpeningPath === renamedFrom) {
								latestOpeningPath = parsed.path;
								if (latestOpeningEventKey == null) latestOpeningEventKey = inheritedOpeningEventKey;
							}

							const openingEventKey = OPENING_OPS.has(op)
								? eventKey
								: inheritedOpeningEventKey;
							if (OPENING_OPS.has(op)) {
								latestOpeningPath = parsed.path;
								latestOpeningEventKey = eventKey;
							}
							if (renamedFrom && renamedDocument && renamedFrom !== parsed.path) {
								delete byPath[renamedFrom];
								order = order.filter((p) => p !== renamedFrom);
							}
							if (!byPath[parsed.path]) order.push(parsed.path);
							byPath[parsed.path] = {
								path: parsed.path,
								rootTitle: typeof parsed.rootTitle === "string" && parsed.rootTitle ? parsed.rootTitle : stemOf(parsed.path),
								content: typeof parsed.content === "string" ? parsed.content : "",
								op,
								callId,
								eventKey,
								openingEventKey,
								// 013：rename 迁移后保留旧路径，供本地直读 tab 清理（mergeDocuments）。
								renamedFrom,
							};
							// 016：成功结果清除同路径历史错误（含 rename 旧路径）。
							delete errorByPath[parsed.path];
							if (renamedFrom && renamedFrom !== parsed.path) delete errorByPath[renamedFrom];
						} else if (node.isError || (parsed && typeof parsed === "object" && parsed.ok !== true)) {
							// 016 错误捕获：host 工具抛错时结果通常是纯文本（无 JSON 信封），
							// 有信封但 ok!==true 的同样收集。可归因路径的进 errorByPath；
							// latestError 恒记录最近一次——无路径错误由面板用「点击时刻
							// 基线」（errorEventKeys）归因到在途的打开请求。
							const errPath = parsed && typeof parsed === "object" && typeof parsed.path === "string" && parsed.path
								? parsed.path
								: null;
							const entry = {
								op: parsed && typeof parsed.op === "string" ? parsed.op : name,
								message: extractErrorMessage(parsed, text),
								callId,
								eventKey,
							};
							if (errPath) errorByPath[errPath] = entry;
							latestError = entry;
						}
					}
				}

				// 父级非 mindmap 工具不参与文档解析，但其 subCalls 仍是会话事件，
				// 必须继续深入；深度上限与 WeakSet 一起防止异常结构卡死。
				if (depth >= MAX_SUBCALL_DEPTH || !Array.isArray(node.subCalls)) return;
				for (const [subCallIndex, subCall] of node.subCalls.entries()) {
					replayNode(subCall, `${eventPath}.${subCallIndex}`, depth + 1);
				}
			}

			for (const [nodeIndex, node] of (Array.isArray(nodes) ? nodes : []).entries()) {
				replayNode(node, String(nodeIndex), 0);
			}
			return { order, byPath, latestOpeningPath, latestOpeningEventKey, errorByPath, latestError };
		}

		/**
		 * 快照文档集（AI 工具结果）与本地直读文档集（read 路由即时打开）合并：
		 * - 快照优先（同 path 覆盖本地占位）；
		 * - 本地文档追加在快照 order 之后；
		 * - 快照里有 renamedFrom 指向某本地路径时，丢弃该本地条目（文件已改名）；
		 * - 016 大小写 fallback（S5 成因）：本地占位（op:"local"）与快照文档仅
		 *   大小写不一致时（macOS 大小写不敏感 FS 上，AI 回传的规范 path 与树
		 *   点击 key 不同），丢弃占位键、保留快照规范 path——加载态随之解除，
		 *   既有 auto-open / 焦点同步机制照常接管。
		 * 错误信号（errorByPath / latestError）原样透传，容缺（旧快照无此字段）。
		 */
		function mergeDocuments(snapshot, localDocs) {
			const snapByPath = (snapshot && snapshot.byPath) || {};
			const byPath = { ...localDocs, ...snapByPath };
			const dropped = new Set();
			for (const doc of Object.values(snapByPath)) {
				if (typeof doc.renamedFrom === "string" && doc.renamedFrom && localDocs[doc.renamedFrom]) {
					dropped.add(doc.renamedFrom);
				}
			}
			const snapPaths = Object.keys(snapByPath);
			for (const p of Object.keys(localDocs)) {
				if (snapByPath[p] || dropped.has(p)) continue;
				if (!localDocs[p] || localDocs[p].op !== "local") continue;
				const lower = p.toLowerCase();
				if (snapPaths.some((sp) => sp.toLowerCase() === lower)) dropped.add(p);
			}
			for (const p of dropped) delete byPath[p];
			const order = [...(snapshot?.order ?? [])];
			for (const p of Object.keys(localDocs)) {
				if (!snapByPath[p] && !dropped.has(p)) order.push(p);
			}
			return {
				order,
				byPath,
				latestOpeningPath: snapshot?.latestOpeningPath ?? null,
				latestOpeningEventKey: snapshot?.latestOpeningEventKey ?? null,
				errorByPath: snapshot?.errorByPath ?? {},
				latestError: snapshot?.latestError ?? null,
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

		/**
		 * 找到可归因到某文档路径的错误（016 加载态恢复）：优先 errorByPath
		 * 精确匹配，其次小写全路径匹配（S5 同源）；sinceKeys（openMindmap
		 * 点击时刻的错误基线，见 errorEventKeys）提供时只认其后新出现的错误，
		 * 且无新路径错误时回落 latestError（无路径归因的最近错误）。
		 */
		function matchDocError(snapshot, path, sinceKeys) {
			if (!snapshot || typeof path !== "string" || !path) return null;
			const errors = snapshot.errorByPath ?? {};
			let matched = errors[path] ?? null;
			if (!matched) {
				const lower = path.toLowerCase();
				for (const key of Object.keys(errors)) {
					if (key.toLowerCase() === lower) {
						matched = errors[key];
						break;
					}
				}
			}
			if (sinceKeys) {
				if (matched && sinceKeys.has(matched.eventKey)) matched = null;
				const latest = snapshot.latestError ?? null;
				if (!matched && latest && !sinceKeys.has(latest.eventKey)) matched = latest;
			}
			return matched;
		}

		/** 当前快照的全部错误事件键（errorByPath + latestError），作「点击时刻基线」。 */
		function errorEventKeys(snapshot) {
			const keys = new Set();
			if (!snapshot) return keys;
			for (const entry of Object.values(snapshot.errorByPath ?? {})) {
				if (entry && entry.eventKey != null) keys.add(entry.eventKey);
			}
			const latest = snapshot.latestError;
			if (latest && latest.eventKey != null) keys.add(latest.eventKey);
			return keys;
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

		//#region PNG 导出（SVG 序列化 → canvas → 下载 / 剪贴板）
		// 019 可变盒高布局：盒高按内容估行数（全量换行的导出形态），表格节点加宽；
		// 布局契约不变——叶子自上而下占行、父节点垂直居中于其子块。
		const EXPORT = {
			nodeW: 220, padX: 12, padY: 8, hGap: 48, vGap: 12, pad: 20,
			fontSize: 13, lineHeight: 18,
			tableCellW: 110, tableCellPad: 8, tableMinW: 140, tableMaxW: 480,
		};

		function escapeXml(text) {
			return String(text ?? "").replace(/[&<>"']/g, (ch) => ({
				"&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&apos;",
			})[ch]);
		}

		function truncateForExport(text, max = 26) {
			const s = String(text ?? "");
			return [...s].length > max ? `${[...s].slice(0, max).join("")}…` : s;
		}

		/** 019 行内格式剥离：导出为纯文本（URL 原样保留——完整不缩减，003 §7）。 */
		function stripInlineForExport(text) {
			return String(text ?? "")
				.replace(/!\[([^\]]*)\]\(([^)]*)\)/g, "$2")
				.replace(/\[([^\]]*)\]\(([^)]*)\)/g, (m, label, url) => (label ? `${label}(${url})` : url))
				.replace(/`([^`]+)`/g, "$1")
				.replace(/\*\*([^*]+)\*\*/g, "$1")
				.replace(/~~([^~]+)~~/g, "$1")
				.replace(/\*([^*\n]+)\*/g, "$1");
		}

		/** 字符宽度估算：CJK 按一个字号宽，其余按 0.55 折算。 */
		function charW(ch, fontSize) {
			return ch.charCodeAt(0) > 0x2e7f ? fontSize : fontSize * 0.55;
		}

		/** 按可用宽度贪心折行（尊重显式换行；长串硬折——长 URL 完整呈现不截断）。 */
		function wrapExportText(text, maxWidth, fontSize) {
			const lines = [];
			for (const segment of String(text ?? "").split("\n")) {
				let cur = "";
				let w = 0;
				for (const ch of segment) {
					const cw = charW(ch, fontSize);
					if (w + cw > maxWidth && cur) {
						lines.push(cur);
						cur = ch;
						w = cw;
					} else {
						cur += ch;
						w += cw;
					}
				}
				lines.push(cur);
			}
			return lines.length > 0 ? lines : [""];
		}

		/** 019 导出块内容：按 kind 取全量呈现的文本与行数。 */
		function exportBlock(node) {
			if (node.kind === "table") {
				const rows = (node.data && node.data.rows) || [];
				const cells = rows.reduce((acc, row) => acc.concat(row), []);
				return { text: cells.map(stripInlineForExport).join("\n"), lines: Math.max(1, rows.length) };
			}
			if (node.kind === "quote") return { text: stripInlineForExport(node.topic), lines: null };
			if (node.kind === "code") return { text: node.topic, lines: 1 };
			return { text: stripInlineForExport(node.topic), lines: null };
		}

		/** 019 盒尺寸估算：文本按折行行数生长；表格按行列数算网格尺寸。 */
		function measureExportBox(node) {
			if (node.kind === "table") {
				const rows = (node.data && node.data.rows) || [];
				const cols = rows.reduce((mx, row) => Math.max(mx, row.length), 0) || 1;
				const cellInner = EXPORT.tableCellW - EXPORT.tableCellPad * 2;
				const rowLines = rows.map((row) => row.reduce((mx, cell) => Math.max(mx, wrapExportText(stripInlineForExport(cell), cellInner, EXPORT.fontSize - 1).length), 1));
				const w = Math.min(EXPORT.tableMaxW, Math.max(EXPORT.tableMinW, cols * EXPORT.tableCellW));
				const h = Math.max(EXPORT.lineHeight, rowLines.reduce((a, b) => a + b, 0) * EXPORT.lineHeight);
				return { w, h };
			}
			const text = exportBlock(node).text;
			const inner = EXPORT.nodeW - EXPORT.padX * 2;
			const lines = node.kind === "code" ? [text] : wrapExportText(text, inner, EXPORT.fontSize);
			return { w: EXPORT.nodeW, h: EXPORT.padY * 2 + lines.length * EXPORT.lineHeight };
		}

		/**
		 * 布局 + 生成导出用 SVG 字符串。左→右分层：x = 父盒右缘 + 间距（可变盒宽），
		 * 叶子自上而下占行，父节点垂直居中于其子块；连线为水平贝塞尔。
		 * 019：盒高随内容生长（表格/引用画专属形态）；色值取主题静态亮色快照
		 *（导出 SVG 走 data-URL，宿主 CSS 变量不可用）。
		 */
		function buildExportSvg(tree, themeName) {
			const palette = exportPalette(themeName);
			const placed = [];
			const edges = [];
			let cursor = EXPORT.pad;
			const place = (node, parentEntry) => {
				const size = measureExportBox(node);
				const entry = {
					node,
					size,
					x: parentEntry ? parentEntry.x + parentEntry.size.w + EXPORT.hGap : EXPORT.pad,
					y: 0,
				};
				placed.push(entry);
				if (parentEntry) edges.push({ from: parentEntry, to: entry });
				if (node.children && node.children.length > 0) {
					let first = null;
					let last = null;
					for (const child of node.children) {
						const childEntry = place(child, entry);
						if (!first) first = childEntry;
						last = childEntry;
					}
					entry.y = (first.y + last.y) / 2;
				} else {
					entry.y = cursor + size.h / 2;
					cursor += size.h + EXPORT.vGap;
				}
				return entry;
			};
			place(tree, null);
			const width = placed.reduce((mx, p) => Math.max(mx, p.x + p.size.w), 0) + EXPORT.pad;
			const height = Math.max(EXPORT.pad * 2 + EXPORT.lineHeight, cursor - EXPORT.vGap + EXPORT.pad);
			const parts = [];
			parts.push(`<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" font-family="-apple-system, 'PingFang SC', 'Microsoft YaHei', sans-serif">`);
			parts.push(`<rect x="0" y="0" width="${width}" height="${height}" fill="${palette.canvasBg}"/>`);
			for (const e of edges) {
				const x1 = e.from.x + e.from.size.w;
				const y1 = e.from.y;
				const x2 = e.to.x;
				const y2 = e.to.y;
				const mid = (x1 + x2) / 2;
				parts.push(`<path d="M ${x1} ${y1} C ${mid} ${y1}, ${mid} ${y2}, ${x2} ${y2}" fill="none" stroke="${palette.connector}" stroke-width="1.5"/>`);
			}
			for (const p of placed) {
				const node = p.node;
				const kind = node.kind;
				const isRoot = !edges.some((e) => e.to === p);
				const isPlaceholder = kind === "placeholder";
				const isCode = kind === "code";
				const isQuote = kind === "quote";
				const isTable = kind === "table";
				const boxY = p.y - p.size.h / 2;
				const fill = isRoot ? palette.rootBg : isCode ? palette.surfaceCode : palette.surface;
				parts.push(`<rect x="${p.x}" y="${boxY}" width="${p.size.w}" height="${p.size.h}" rx="7" fill="${isPlaceholder ? "none" : fill}" stroke="${isRoot ? palette.rootBorder : isPlaceholder ? palette.border : palette.border}" stroke-width="${isRoot ? 1.6 : 1}"${isPlaceholder ? ' stroke-dasharray="5,4"' : ""}/>`);
				if (isQuote) {
					parts.push(`<rect x="${p.x}" y="${boxY}" width="3" height="${p.size.h}" fill="${palette.quote}"/>`);
				}
				if (isTable) {
					// 表格块：完整网格（全量行列、单元格换行、不缩减，003 §5.5）。
					const rows = (node.data && node.data.rows) || [];
					const cols = rows.reduce((mx, row) => Math.max(mx, row.length), 0) || 1;
					const colW = p.size.w / cols;
					const rowLines = rows.map((row) => row.reduce((mx, cell) => Math.max(mx, wrapExportText(stripInlineForExport(cell), colW - EXPORT.tableCellPad * 2, EXPORT.fontSize - 1).length), 1));
					const rowH = rowLines.map((n) => n * EXPORT.lineHeight);
					let ry = boxY;
					rows.forEach((row, ri) => {
						row.forEach((cell, ci) => {
							const cx = p.x + ci * colW;
							parts.push(`<rect x="${cx}" y="${ry}" width="${colW}" height="${rowH[ri]}" fill="${ri === 0 ? palette.surfaceCode : "none"}" stroke="${palette.borderSubtle}" stroke-width="1"/>`);
							const cellLines = wrapExportText(stripInlineForExport(cell), colW - EXPORT.tableCellPad * 2, EXPORT.fontSize - 1);
							cellLines.forEach((ln, li) => {
								const ty = ry + (li + 0.5) * EXPORT.lineHeight + (EXPORT.fontSize - 1) * 0.35;
								parts.push(`<text x="${cx + EXPORT.tableCellPad}" y="${ty.toFixed(1)}" font-size="${EXPORT.fontSize - 1}" font-weight="${ri === 0 ? 600 : 400}" fill="${palette.text}">${escapeXml(ln)}</text>`);
							});
						});
						ry += rowH[ri];
					});
					continue;
				}
				const label = isPlaceholder ? "待填写" : exportBlock(node).text;
				const color = isPlaceholder ? palette.muted : isRoot ? palette.rootText : kind === "heading" ? palette.heading : palette.text;
				const weight = isRoot ? 700 : kind === "heading" ? 600 : 400;
				const inner = p.size.w - EXPORT.padX * 2 - (isQuote ? 3 : 0);
				const lines = isCode ? [label] : wrapExportText(label, inner, EXPORT.fontSize);
				const startY = p.y - (lines.length - 1) * EXPORT.lineHeight / 2 + EXPORT.fontSize * 0.35;
				lines.forEach((ln, li) => {
					parts.push(`<text x="${p.x + EXPORT.padX + (isQuote ? 3 : 0)}" y="${(startY + li * EXPORT.lineHeight).toFixed(1)}" font-size="${EXPORT.fontSize}" font-weight="${weight}" font-family="${isCode ? "Menlo, monospace" : "inherit"}" fill="${color}">${escapeXml(ln)}</text>`);
				});
			}
			parts.push("</svg>");
			return { svg: parts.join(""), width, height };
		}

		/** SVG → Image → 白底 canvas（下载 / 剪贴板共用，017 抽出）。 */
		async function renderSvgToCanvas(svg, width, height) {
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
			return canvas;
		}

		/** 浏览器侧导出：SVG → canvas → PNG 下载。tree 可为整树或任意子树（017）。 */
		async function exportPng(tree, rootTitle, themeName) {
			const { svg, width, height } = buildExportSvg(tree, themeName);
			const canvas = await renderSvgToCanvas(svg, width, height);
			const dataUrl = canvas.toDataURL("image/png");
			const a = document.createElement("a");
			a.href = dataUrl;
			a.download = `${(rootTitle || "mindmap").replace(/[\\/:*?"<>|]/g, "_")}.png`;
			document.body.appendChild(a);
			a.click();
			a.remove();
		}

		/**
		 * 020 复制全文：纯文本写系统剪贴板。优先 Clipboard API；老环境回退
		 * 临时 textarea + execCommand（宿主 webview 权限不齐时的保底）。
		 */
		async function copyPlainText(text) {
			if (navigator.clipboard && typeof navigator.clipboard.writeText === "function") {
				await navigator.clipboard.writeText(String(text ?? ""));
				return;
			}
			const ta = document.createElement("textarea");
			ta.value = String(text ?? "");
			ta.style.position = "fixed";
			ta.style.opacity = "0";
			document.body.appendChild(ta);
			ta.select();
			const ok = document.execCommand && document.execCommand("copy");
			ta.remove();
			if (!ok) throw new Error("当前环境不支持复制文本");
		}

		/**
		 * 浏览器侧复制（017 节点右键菜单）：tree 渲染成 PNG 写入系统剪贴板，
		 * 可直接粘贴到聊天 / 文档 / 微信等。ClipboardItem 携带 Blob Promise——
		 * 异步渲染期间保持用户激活态（Chrome 契约）；环境不支持（非安全
		 * 上下文等）或写入被拒时抛错，由菜单提示改用「导出为图片」。
		 */
		async function copyPng(tree, themeName) {
			if (typeof ClipboardItem === "undefined" || !navigator.clipboard || typeof navigator.clipboard.write !== "function") {
				throw new Error("当前环境不支持复制图片，请改用「导出为图片」");
			}
			const { svg, width, height } = buildExportSvg(tree, themeName);
			const blobPromise = renderSvgToCanvas(svg, width, height).then((canvas) => new Promise((resolve, reject) => {
				canvas.toBlob((blob) => (blob ? resolve(blob) : reject(new Error("PNG 生成失败"))), "image/png");
			}));
			try {
				await navigator.clipboard.write([new ClipboardItem({ "image/png": blobPromise })]);
			} catch (error) {
				throw new Error(`复制图片失败：${error?.message ?? error}。可改用「导出为图片」`);
			}
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
			// 016 加载态三态：错误/超时标记与文案、重试按钮（沿用面板语义色变量）。
			loadingErrorText: { color: "var(--dsw-alias-label-error)", fontSize: "13px", lineHeight: 1.6, margin: "0", textAlign: "center", wordBreak: "break-word", maxWidth: "90%" },
			loadingFailMark: { flex: "none", fontSize: "22px", lineHeight: 1, color: "var(--dsw-alias-label-error)" },
			retryBtn: { flex: "none", border: "1px solid var(--dsw-alias-border-l2)", background: "var(--dsw-alias-bg-layer-3)", color: "var(--dsw-alias-label-primary)", cursor: "pointer", font: "inherit", fontSize: "13px", padding: "6px 18px", borderRadius: "8px", lineHeight: "20px" },
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
			// 017 画布节点右键菜单：标题行（节点主题）+ 错误行 + 菜单项禁用态。
			nodeMenuHeader: { padding: "4px 12px 6px", fontSize: "12px", color: "var(--dsw-alias-label-tertiary)", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis", maxWidth: "220px", boxSizing: "border-box" },
			// 020：标题（节点主题）与动作项之间的分隔线，拉开层次。
			nodeMenuDivider: { height: "1px", background: "var(--dsw-alias-border-l2)", margin: "4px 6px" },
			nodeMenuError: { color: "var(--dsw-alias-label-error)", fontSize: "12px", lineHeight: 1.5, margin: "0", padding: "2px 12px 4px", wordBreak: "break-word" },
			treeMenuItemDisabled: { opacity: 0.5, cursor: "default" },
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
			// 016：去掉 CSS width/height 百分比——在 auto-height 的 flex 行内，
			// 百分比高度解析为 auto 会让 SVG 坐标系塌缩，连线与节点像素错位。
			// 改为由 TreeRow 在 measure 里同步记下实际像素，作 SVG 属性直传。
			edgeLayer: { position: "absolute", top: 0, left: 0, display: "block", pointerEvents: "none", overflow: "visible" },
			// 019 节点盒骨架（002 三层模型：骨架/血肉/皮肤）：只留内距与换行契约，
			// 颜色/圆角/阴影由 resolveNodeStyle 生成。020 长度治理：320px 宽上限
			// 强制盒内折行（废除横条）；长 URL 用 overflowWrap:anywhere 保证可折行不截断。
			box: { padding: "6px 12px", flex: "0 0 auto", whiteSpace: "pre-wrap", overflowWrap: "anywhere", lineHeight: "20px", fontSize: "13px", boxSizing: "border-box", maxWidth: 320 },
			// 020 长度治理：散文类块（text/md/list/quote）折行后仍超 6 行即截断+
			// 省略号，全文走悬停浮层（复用代码浮层通道，缩减≠阉割）。仅散文类套用。
			// 行高必须整数像素（20px）：小数行高会让 line-clamp 裁切边界与行盒
			// 错位，露出下一行半截字；maxHeight = 6×20 + 上下内距 12 作硬上限双保险。
			boxClamp: { display: "-webkit-box", WebkitLineClamp: 6, WebkitBoxOrient: "vertical", overflow: "hidden", maxHeight: 132 },
			// 019 代码块悬停浮层：看全文的浮起面板（position:fixed 不进测量链，
			// 不影响行测量；等宽全文、可滚动、移开即收）。
			codePanel: { position: "fixed", zIndex: 70, maxWidth: "440px", maxHeight: "340px", overflow: "auto", padding: "10px 12px", background: "var(--dsw-alias-bg-layer-3)", color: "var(--dsw-alias-label-primary)", border: "1px solid var(--dsw-alias-border-l2)", borderRadius: "10px", boxShadow: "var(--dsw-shadow-lv2)", fontFamily: "Menlo, monospace", fontSize: "12px", lineHeight: 1.6, whiteSpace: "pre", boxSizing: "border-box" },
			codePanelLang: { margin: "0 0 6px", fontSize: "11px", color: "var(--dsw-alias-label-tertiary)", fontFamily: "inherit" },
			codePanelCode: { margin: "0", fontFamily: "inherit", fontSize: "inherit", whiteSpace: "pre" },
			// 020 散文类全文浮层：与代码浮层共用定位/翻转/宽限逻辑，换等宽为等线、
			// pre 为 pre-wrap（正文不是代码）。
			textPanel: { position: "fixed", zIndex: 70, maxWidth: "440px", maxHeight: "340px", overflow: "auto", padding: "10px 12px", background: "var(--dsw-alias-bg-layer-3)", color: "var(--dsw-alias-label-primary)", border: "1px solid var(--dsw-alias-border-l2)", borderRadius: "10px", boxShadow: "var(--dsw-shadow-lv2)", fontSize: "12px", lineHeight: 1.6, boxSizing: "border-box" },
			textPanelBody: { margin: "0", whiteSpace: "pre-wrap", overflowWrap: "anywhere" },
			// 019 表格块：完整网格（全量行列、单元格内换行、弱边框）。020：表格不
			// 参与截断，超宽时盒内横向滚动，网格与单元格完整保留。
			tableWrap: { fontSize: "12px", lineHeight: 1.5, overflowX: "auto", maxWidth: "100%" },
			tableGrid: { borderCollapse: "collapse" },
			tableCell: { border: "1px solid var(--dsw-alias-border-l2)", padding: "3px 8px", whiteSpace: "pre-wrap", overflowWrap: "anywhere", verticalAlign: "top", textAlign: "left", minWidth: "64px", maxWidth: "240px" },
			tableHeaderCell: { fontWeight: 600, background: "var(--dsw-alias-fill-tsp-secondary)" },
			// 019 大一统可点击链接：任何块里的任何 URL 完整呈现、永不缩减。
			inlineLink: { color: "var(--dsw-alias-state-business-primary)", textDecoration: "underline", textUnderlineOffset: "2px", overflowWrap: "anywhere", cursor: "pointer" },
			inlineCode: { fontFamily: "Menlo, monospace", fontSize: "12px", background: "var(--dsw-alias-fill-tsp-secondary)", borderRadius: "4px", padding: "0 3px" },
			// 016 脑图画布：滚动区 + 居中层 + 右上角浮动缩放控制条。
			canvasWrap: { flex: "1 1 auto", minHeight: 0, minWidth: 0, position: "relative", display: "flex", flexDirection: "column" },
			canvasScroll: { flex: "1 1 auto", minHeight: 0, minWidth: 0, overflow: "auto" },
			// 居中层：内容小则铺满视口（100%），大则撑到内容尺寸（max-content）；
			// 子项用 margin:auto——空间充足双向居中，溢出时 margin 归零、从滚动
			// 原点排布（flexbox 溢出居中裁剪的标准解法，无左/上侧裁剪）。
			canvasCenter: { display: "flex", width: "100%", height: "100%", minWidth: "max-content", minHeight: "max-content", boxSizing: "border-box", padding: "16px" },
			// 缩放控制条：绝对定位于 canvasWrap（滚动区外，不随内容滚动）。
			zoomBar: { position: "absolute", top: "10px", right: "12px", zIndex: 5, display: "inline-flex", alignItems: "center", gap: "2px", padding: "3px", borderRadius: "8px", background: "var(--dsw-alias-bg-layer-3)", border: "1px solid var(--dsw-alias-border-l2)", boxShadow: "var(--dsw-shadow-lv2)" },
			zoomBtn: { border: "none", background: "none", cursor: "pointer", font: "inherit", fontSize: "13px", lineHeight: "20px", height: "22px", minWidth: "22px", padding: "0 4px", borderRadius: "6px", color: "var(--dsw-alias-label-secondary)", display: "inline-flex", alignItems: "center", justifyContent: "center", flex: "none" },
			zoomBtnHover: { background: "var(--dsw-alias-interactive-bg-hover)", color: "var(--dsw-alias-label-primary)" },
			zoomBtnDisabled: { opacity: 0.4, cursor: "default" },
			// 百分比标签：tabular-nums 防数字抖动。
			zoomLabel: { flex: "none", minWidth: "38px", textAlign: "center", fontSize: "11px", lineHeight: "20px", color: "var(--dsw-alias-label-secondary)", fontVariantNumeric: "tabular-nums", userSelect: "none" },
			zoomFitBtn: { border: "none", background: "none", cursor: "pointer", font: "inherit", fontSize: "12px", lineHeight: "20px", height: "22px", padding: "0 8px", borderRadius: "6px", color: "var(--dsw-alias-label-secondary)", flex: "none" },
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
							// 018：旧设置/读不到都默认开（!== false 语义）。
							growthAnimation: !(v && v.growthAnimation === false),
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
							// 019：色点读令牌表（该主题的强标题强调色）。
							const dot = resolveToken("color.accent.heading.strong", COLOR_THEMES[t.value]);
							return (0, react_jsx_runtime.jsxs)("button", {
								key: t.value,
								type: "button",
								style: value.colorTheme === t.value ? { ...S.swatchBtn, ...S.swatchActive } : S.swatchBtn,
								disabled: saving,
								onClick: () => setField({ colorTheme: t.value }),
								children: [
									(0, react_jsx_runtime.jsx)("span", { style: { ...S.swatchDot, background: dot } }),
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
					// 018 生长动画开关：每次更新后新增/变化节点逐个渐显；关掉即整棵直出。
					(0, react_jsx_runtime.jsxs)("div", { style: S.settingsRow, children: [
						(0, react_jsx_runtime.jsx)("span", { style: S.settingsLabel, children: "生长动画" }),
						(0, react_jsx_runtime.jsx)(Segmented, {
							options: [{ value: true, label: "开" }, { value: false, label: "关" }],
							value: value.growthAnimation,
							disabled: saving,
							onChange: (v) => setField({ growthAnimation: v }),
						}),
					] }),
					(0, react_jsx_runtime.jsx)("p", { style: S.settingsHint, children: "开启后，脑图每次更新的新增/变化节点会逐个渐显长出（总时长不超过 2 秒）；关闭则整棵树立刻完整显示。" }),
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
			// 016 可靠性加固：结构指纹作第二 selector。store 原地改数组（引用
			// 不变）时，nodes prop 不换、memo 命中缓存、auto-open effect 永不
			// 重跑——「AI 打开了脑图但面板不展开」的根因。指纹是原始值字符串，
			// 值比较天然绕过引用相等短路；useSession 不可用时回退空串。
			const nodesVersion = useSession ? useSession((s) => nodesFingerprint((s && s.nodes) || EMPTY_NODES)) : "";
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
					nodesVersion,
					mindmapFace,
					onOpen: () => setOpen(true),
					onClose: () => setOpen(false),
				}),
			] });
		}

		//#region 019 血肉渲染：行内格式 + 大一统链接 + 表格块（规范源：003）
		// 行内格式统一扫描序：图片/链接 → 行内代码 → 粗体 → 删除线 → 斜体 → 裸链接。
		// 先命中先生效，裸链接放最后，避免吞掉已被 [文字](url) 消费的 URL。
		const INLINE_PATTERN = /(!?\[[^\]]*\]\([^)]*\))|(`[^`]+`)|(\*\*[^*]+\*\*)|(~~[^~]+~~)|(\*[^*\s][^*]*\*)|(https?:\/\/[^\s)]+)/g;

		/** 大一统链接点击：在机器浏览器打开（新标签页），不触发画布聚焦缩放。 */
		function openLink(event, url) {
			event.preventDefault();
			event.stopPropagation();
			try {
				window.open(url, "_blank", "noopener");
			} catch {
				// 宿主环境拦截时退化为浏览器默认行为（不静默吞链接）。
				event.defaultPrevented = false;
			}
		}

		/**
		 * 零依赖行内渲染器：任何块（文本/Markdown/列表/表格单元格）的内容都走这里。
		 * 链接完整呈现、永不缩减（缩减=阉割信息，003 §7）；无预览、无加载态。
		 * 返回 React 子节点数组（无格式时原样返回字符串）。
		 */
		function renderInline(text, keyPrefix) {
			const source = String(text ?? "");
			INLINE_PATTERN.lastIndex = 0;
			const out = [];
			let last = 0;
			let k = 0;
			let m;
			while ((m = INLINE_PATTERN.exec(source)) !== null) {
				if (m.index > last) out.push(source.slice(last, m.index));
				const token = m[0];
				const key = `${keyPrefix || "i"}-${k++}`;
				if (m[1]) {
					// [文字](url) 或 ![alt](url)。图片块暂缓（003 §9）：图语法退化为
					// 指向原图的链接，同时把 alt 与原图地址都完整呈现（不缩减）。
					const parsed = /^(!?)\[([^\]]*)\]\(([^)]*)\)$/.exec(token);
					// 普通链接标签取文字（无文字显地址）；图语法带 alt 时两者都完整呈现。
					const label = parsed[1]
						? (parsed[2] ? `${parsed[2]} (${parsed[3]})` : parsed[3])
						: (parsed[2] || parsed[3]);
					out.push((0, react_jsx_runtime.jsx)("a", {
						key,
						href: parsed[3],
						target: "_blank",
						rel: "noopener noreferrer",
						style: S.inlineLink,
						title: parsed[3],
						onClick: (e) => openLink(e, parsed[3]),
						children: label,
					}, key));
				} else if (m[2]) {
					out.push((0, react_jsx_runtime.jsx)("code", { key, style: S.inlineCode, children: token.slice(1, -1) }, key));
				} else if (m[3]) {
					out.push((0, react_jsx_runtime.jsx)("strong", { key, children: token.slice(2, -2) }, key));
				} else if (m[4]) {
					out.push((0, react_jsx_runtime.jsx)("s", { key, children: token.slice(2, -2) }, key));
				} else if (m[5]) {
					out.push((0, react_jsx_runtime.jsx)("em", { key, children: token.slice(1, -1) }, key));
				} else {
					// 裸链接：完整显示、可点击。
					out.push((0, react_jsx_runtime.jsx)("a", {
						key,
						href: token,
						target: "_blank",
						rel: "noopener noreferrer",
						style: S.inlineLink,
						title: token,
						onClick: (e) => openLink(e, token),
						children: token,
					}, key));
				}
				last = m.index + token.length;
			}
			if (last < source.length) out.push(source.slice(last));
			return out.length > 1 || (out.length === 1 && typeof out[0] !== "string") ? out : source;
		}

		/** 表格块渲染：完整网格（全量行列、单元格内换行、表头加重），单元格不拆。 */
		function renderTableBlock(node) {
			const rows = (node.data && node.data.rows) || [];
			if (rows.length === 0) return renderInline(node.topic, node.id);
			return (0, react_jsx_runtime.jsx)("div", { style: S.tableWrap, children: (0, react_jsx_runtime.jsx)("table", { style: S.tableGrid, children: (0, react_jsx_runtime.jsx)("tbody", { children: rows.map((row, ri) => (0, react_jsx_runtime.jsx)("tr", { children: row.map((cell, ci) => (0, react_jsx_runtime.jsx)(ri === 0 ? "th" : "td", {
				style: ri === 0 ? { ...S.tableCell, ...S.tableHeaderCell } : S.tableCell,
				children: renderInline(cell, `${node.id}-${ri}-${ci}`),
			}, ci)) }, ri)) }) }) });
		}
		//#endregion

		function NodeBox(props) {
			const { node, theme, revealDelay, selectedId, onCodePanel } = props;
			const [hovered, setHovered] = react.useState(false);
			const boxRef = react.useRef(null);
			// 020 长度治理：散文类块（text/md/list/quote）套 6 行截断；clamped = 实测
			// 真的溢出了（scrollHeight>clientHeight），悬停浮层看全文（复用代码浮层）。
			const isProse = node.kind === "text" || node.kind === "md" || node.kind === "list" || node.kind === "quote";
			const [clamped, setClamped] = react.useState(false);
			react.useLayoutEffect(() => {
				const el = boxRef.current;
				if (!el || !isProse) {
					if (clamped) setClamped(false);
					return;
				}
				const overflow = el.scrollHeight > el.clientHeight + 1;
				if (overflow !== clamped) setClamped(overflow);
			}, [node.topic, node.kind]);
			// 019 皮肤层：颜色/圆角/阴影/状态全部由 resolveNodeStyle 纯函数生成。
			const style = {
				...S.box,
				...(isProse ? S.boxClamp : null),
				...resolveNodeStyle(node, {
					colorTheme: theme && theme.colorTheme,
					cardStyle: theme && theme.cardStyle,
					states: { hovered, selected: selectedId === node.id },
				}),
			};
			// 020 表格块不参与散文 320px 宽上限：完整网格需要更宽书写面，
			// 单独放到 680；超出部分盒内横滚（003 §8 结构类保留形态）。
			if (node.kind === "table") style.maxWidth = 680;
			// 018 生长动画：动画挂在内层节点盒（外层被连线测量，不能带 transform）。
			if (revealDelay !== undefined) style.animationDelay = `${revealDelay}ms`;

			function handleEnter() {
				setHovered(true);
				// 019 代码块 / 020 截断散文块：盒内紧凑，悬停浮起面板看全文（003 §5.3）。
				if ((node.kind === "code" || clamped) && onCodePanel && boxRef.current) {
					onCodePanel({ node, anchor: boxRef.current.getBoundingClientRect() });
				}
			}
			function handleLeave() {
				setHovered(false);
				if ((node.kind === "code" || clamped) && onCodePanel) onCodePanel(null);
			}

			const children = node.kind === "placeholder"
				? "待填写"
				: node.kind === "table"
					? renderTableBlock(node)
					: renderInline(node.topic, node.id);
			// 截断块的全文走浮层，原生 title 气泡会与之重复，故截断时不挂 title。
			const title = node.kind === "code" ? `${node.topic}\n\n（悬停看全文）` : clamped ? undefined : node.topic;
			return (0, react_jsx_runtime.jsx)("div", {
				ref: boxRef,
				style,
				title,
				className: revealDelay !== undefined ? "dsh-mm-reveal" : undefined,
				onMouseEnter: handleEnter,
				onMouseLeave: handleLeave,
				children,
			});
		}

		/** 左→右递归树：节点盒 + 右侧子节点列 + 连线层（015 支持折线/曲线两种线型）。 */
		function TreeRow(props) {
			const { node, theme, onNodeContextMenu, reveal, selectedId, onCodePanel } = props;
			// 018 生长动画：本节点渐显延迟（新节点盒）与本行连线渐显延迟（有新子节点）。
			const revealDelay = reveal && reveal.nodes ? reveal.nodes.get(node.id) : undefined;
			const edgeRevealDelay = reveal && reveal.edges ? reveal.edges.get(node.id) : undefined;
			// 019 连线外观走令牌（皮肤层），不再硬编码。
			const overrides = COLOR_THEMES[theme && theme.colorTheme] || COLOR_THEMES.ocean;
			const connectorColor = resolveToken("connector.color", overrides);
			const connectorWidth = resolveToken("connector.width", overrides);
			const rowRef = react.useRef(null);
			const boxWrapRef = react.useRef(null);
			const childRefs = react.useRef([]);
			// 016：一次测量 = 连线 + 行本地尺寸，单键防抖。坐标全部换算到行
			// 「本地空间」（视觉像素 ÷ 缩放因子，由隐形探针实测），SVG 用
			// viewBox 把用户空间钉在本地空间——CSS zoom 新旧实现都精确对齐，
			// 且 SVG 盒子恒等于行的视觉尺寸（绝不撑出滚动区）。
			const [layout, setLayout] = react.useState({ edges: [], w: 0, h: 0 });
			const prevKeyRef = react.useRef("");
			// 缩放探针：本地 10×10（小于最小节点盒，永不溢出行），visibility
			// 隐藏。getBoundingClientRect 返回 10×zoom → 实测缩放因子。
			const probeRef = react.useRef(null);

			// 测量父盒右缘与各子节点包裹块的几何位置，画连线
			// （折线 = M x1 y1 H midX V y2 H x2；曲线 = 贝塞尔水平切出）；
			// 序列化比对防 setState 循环。
			react.useLayoutEffect(() => {
				const rowEl = rowRef.current;
				const boxEl = boxWrapRef.current;
				const probeEl = probeRef.current;
				if (!rowEl || !boxEl || !probeEl) return;
				const curve = theme && theme.lineStyle === "curve";
				const measure = () => {
					// 探针实测缩放因子（视觉/本地）——与 DOM 当前状态同步，
					// 对 CSS zoom 的新旧实现（渲染期缩放 / used 值缩放）都成立。
					const scale = probeEl.getBoundingClientRect().width / 10 || 1;
					const rowRect = rowEl.getBoundingClientRect();
					const boxRect = boxEl.getBoundingClientRect();
					const next = [];
					for (const ref of childRefs.current) {
						if (!ref) continue;
						const c = ref.getBoundingClientRect();
						// 视觉像素 → 行本地坐标（SVG 用户空间 = 本地空间）。
						const x1 = (boxRect.right - rowRect.left) / scale;
						const y1 = (boxRect.top - rowRect.top + boxRect.height / 2) / scale;
						const x2 = (c.left - rowRect.left) / scale;
						const y2 = (c.top - rowRect.top + c.height / 2) / scale;
						const midX = (x1 + x2) / 2;
						next.push(curve
							? `M ${x1} ${y1} C ${midX} ${y1}, ${midX} ${y2}, ${x2} ${y2}`
							: `M ${x1} ${y1} H ${midX} V ${y2} H ${x2}`);
					}
					const w = rowRect.width / scale;
					const h = rowRect.height / scale;
					const key = `${w.toFixed(2)}x${h.toFixed(2)}|${next.join("|")}`;
					if (prevKeyRef.current === key) return;
					prevKeyRef.current = key;
					setLayout({ edges: next, w, h });
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

			// 016 点击聚焦标记：row = 该节点的整棵子树边界（盒+子列），node = 节点盒本身；
				// 画布层用事件委托 closest 定位（递归树不逐层传回调）。
				return (0, react_jsx_runtime.jsxs)("div", { ref: rowRef, "data-mindmap-row": "", style: { ...S.row, position: "relative" }, children: [
				// 缩放探针（本地 10×10，隐形，点击穿透）。
				(0, react_jsx_runtime.jsx)("div", { ref: probeRef, style: { position: "absolute", top: 0, left: 0, width: 10, height: 10, visibility: "hidden", pointerEvents: "none" } }),
				layout.edges.length > 0 && layout.w > 0 && layout.h > 0
					? (0, react_jsx_runtime.jsx)("svg", {
						// width/height = 本地尺寸 → 视觉 = 本地×zoom，恒等于行尺寸；
						// viewBox 把用户空间钉在本地空间，路径坐标（本地）精确落位。
						width: layout.w,
						height: layout.h,
						viewBox: `0 0 ${layout.w} ${layout.h}`,
						preserveAspectRatio: "none",
						style: edgeRevealDelay !== undefined ? { ...S.edgeLayer, animationDelay: `${edgeRevealDelay}ms` } : S.edgeLayer,
						// 018：新子节点出现时连线同步浮现（延迟 = 最早新子节点的错峰）。
						className: edgeRevealDelay !== undefined ? "dsh-mm-edge-reveal" : undefined,
						children: layout.edges.map((d, i) => (0, react_jsx_runtime.jsx)("path", {
							key: i,
							d,
							stroke: connectorColor,
							strokeWidth: connectorWidth,
							fill: "none",
							// 016：CSS zoom 缩放下 strokeWidth 会被一并缩放，缩小后线变
							// 亚像素、模糊看不清；vectorEffect=non-scaling-stroke 让线宽
							// 保持不变（任何缩放下都是 1.5px 视觉宽度）。
							vectorEffect: "non-scaling-stroke",
						}, i)),
					})
					: null,
				(0, react_jsx_runtime.jsx)("div", {
					ref: boxWrapRef,
					"data-mindmap-node": "",
					// 019：节点 id 挂在盒包裹上，画布点击聚焦时据此记选中态。
					"data-mindmap-node-id": node.id,
					style: { flex: "0 0 auto", cursor: "pointer" },
					// 017 节点右键：弹「复制/导出为图片」菜单；stopPropagation 免触
					// 画布空白拦截（空白处只拦默认菜单、不弹自己的）。
					onContextMenu: onNodeContextMenu ? (e) => {
						e.preventDefault();
						e.stopPropagation();
						onNodeContextMenu(e, node);
					} : undefined,
					children: (0, react_jsx_runtime.jsx)(NodeBox, { node, theme, revealDelay, selectedId, onCodePanel }),
				}),
				node.children && node.children.length > 0
					? (0, react_jsx_runtime.jsx)("div", { style: S.childrenColumn, children: node.children.map((child, idx) => (0, react_jsx_runtime.jsx)("div", {
						key: child.id,
						ref: (el) => {
							childRefs.current[idx] = el;
						},
						children: (0, react_jsx_runtime.jsx)(TreeRow, { node: child, theme, onNodeContextMenu, reveal, selectedId, onCodePanel }),
					}, child.id)) })
					: null,
				] });
				}

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
					(0, react_jsx_runtime.jsx)("div", { ref: scrollRef, style: S.canvasScroll, onClick: onCanvasClick, children: 
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

		function MindmapDetailsPanel(props) {
			// 014：面板与 M 按钮同槽位（conversation.session.header.actions），
			// 会话能力（sessionId/inputActions/nodes）与开合回调全部由 MindmapSlot
			// 经 props 直给（无桥、无 useSyncExternalStore）。
			const { mindmapFace, open, sessionId, inputActions, nodes, nodesVersion, onOpen, onClose } = props;
			// 016：nodesVersion（结构指纹）作副依赖——nodes 引用不变但内容已变
			// （新工具结果原地落地）时强制重算；docs 新引用带动 merged →
			// auto-open effect 重跑（对已消费事件幂等 no-op），面板必达展开。
			const docs = react.useMemo(() => reduceDocuments(nodes), [nodes, nodesVersion]);
			// 013：本地加载占位文档（左键点 .md 秒建 tab、内容为空），与快照文档
			// 合并显示；快照优先（AI 结果覆盖占位）。
			const [localDocs, setLocalDocs] = react.useState({});
			const merged = react.useMemo(() => mergeDocuments(docs, localDocs), [docs, localDocs]);
			// 016 加载态恢复（S2/S3 成因）：openMindmap 点击时刻记录错误事件键
			// 基线——只有其后新出现的错误才归因到该次打开（matchDocError 的
			// sinceKeys）；重试时基线随新占位重建（当前错误已含其中，不重复弹）。
			const localErrorBaseRef = react.useRef(null);
			// 016 看门狗：本地占位约 30s 无结果 → 超时态（提示 + 重试）。
			// AI 没调工具（S3）或任何未知成因卡住时的兜底恢复路径。
			const OPEN_TIMEOUT_MS = 30000;
			const [openTimedOut, setOpenTimedOut] = react.useState(false);
			// 014 overlay 宽度：localStorage 持久化，拖拽钳制 [280, 视口 80%]。
			// 窗口尺寸变化时持续钳制——只在挂载时压一次的话，窗口先放大→拖宽
			// 面板→再缩小会让面板保持旧像素宽，聊天区被挤没。
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
				const clamp = () => {
					setPanelWidth((prev) => {
						const max = Math.round(window.innerWidth * 0.8);
						return prev > max ? max : prev;
					});
				};
				clamp();
				window.addEventListener("resize", clamp);
				return () => window.removeEventListener("resize", clamp);
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
			const [theme, setTheme] = react.useState({ lineStyle: "elbow", cardStyle: "rounded", colorTheme: "ocean", growthAnimation: true });
			react.useEffect(() => {
				if (!open) return;
				if (!mindmapFace || typeof mindmapFace.readSettings !== "function") return;
				mindmapFace.readSettings().then((v) => {
					if (!v) return;
					setTheme({
						lineStyle: v.lineStyle === "curve" ? "curve" : "elbow",
						cardStyle: v.cardStyle === "square" ? "square" : "rounded",
						colorTheme: COLOR_THEMES[v.colorTheme] ? v.colorTheme : "ocean",
						// 018 生长动画开关：旧设置/读不到都默认开（!== false 语义）。
						growthAnimation: v.growthAnimation !== false,
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

			// 018 生长动画调度：新树与上一版（同 path）的稳定 id 集做 diff，只对新增/
			// 变化节点出渐显计划（planGrowthReveal 广度优先错峰、总时长 ≤ 2s）；播完定时清空，
			// 节点转静态渲染——之后切 tab/重挂载不重播；连续更新时 cleanup 清旧定时器、
			// 新计划直接替换，不堆积。跨文档/首屏（prev path 不同或无旧集）= 全量生长。
			const prevIdsRef = react.useRef({ path: null, ids: null });
			const [reveal, setReveal] = react.useState(null);
			react.useEffect(() => {
				const path = doc ? doc.path : null;
				const prev = prevIdsRef.current;
				const prevIds = prev.path === path ? prev.ids : null;
				prevIdsRef.current = { path, ids: tree ? collectTreeIds(tree) : null };
				if (!tree || !theme.growthAnimation) {
					setReveal(null);
					return;
				}
				const plan = planGrowthReveal(tree, prevIds);
				setReveal(plan);
				if (!plan) return;
				const timer = setTimeout(() => setReveal(null), plan.totalMs + 50);
				return () => clearTimeout(timer);
			}, [tree, doc && doc.path, theme.growthAnimation]);

			// 016 看门狗：当前显示本地占位（等待 AI 打开结果）时计时；doc 被快照
			// 结果覆盖 / 切走 / 重开（openMindmap 重建占位 → 新 doc 引用）时自动
			// 重置。超时转超时态，渲染重试入口。
			react.useEffect(() => {
				if (!doc || doc.op !== "local") {
					setOpenTimedOut(false);
					return;
				}
				setOpenTimedOut(false);
				const id = setTimeout(() => setOpenTimedOut(true), OPEN_TIMEOUT_MS);
				return () => clearTimeout(id);
			}, [doc]);

			// 016：当前加载占位的归因错误（精确/小写路径匹配优先，点击时刻基线
			// 之后新出现的 latestError 兜底——host 抛错结果常无路径可归因）。
			const docError = doc && doc.op === "local" && localErrorBaseRef.current
				? matchDocError(merged, doc.path, localErrorBaseRef.current)
				: null;

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
					await exportPng(tree, doc.rootTitle, theme && theme.colorTheme);
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
				// 016：记录点击时刻的错误基线（errorByPath 与 latestError 的全部
				// 事件键）——只有其后新出现的错误才归因本次打开，旧错误不打扰。
				localErrorBaseRef.current = errorEventKeys(merged);
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
					return true;
				} catch (error) {
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

			// 018 生长动画：新增/变化节点错峰渐显（节点盒 = 淡入 + 左移浮现，
			// 连线 = 淡入；延迟由内联 animationDelay 提供）。fill mode both 保证
			// 延迟期间保持隐藏；动画只挂新节点，旧节点不受影响。尊重系统减弱动效。
			if (typeof document !== "undefined") {
				const animStyle = document.createElement("style");
				animStyle.setAttribute("data-dsh-mindmap", "growth-anim");
				animStyle.textContent = [
					"@keyframes dsh-mm-node-in{from{opacity:0;transform:translateX(-10px)}to{opacity:1;transform:none}}",
					".dsh-mm-reveal{opacity:0;animation:dsh-mm-node-in 320ms ease-out both}",
					"@keyframes dsh-mm-fade-in{from{opacity:0}to{opacity:1}}",
					".dsh-mm-edge-reveal{opacity:0;animation:dsh-mm-fade-in 320ms ease-out both}",
					"@media (prefers-reduced-motion: reduce){.dsh-mm-reveal,.dsh-mm-edge-reveal{animation:none;opacity:1}}",
				].join("");
				document.head.appendChild(animStyle);
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
			nodesFingerprint,
			matchDocError,
			errorEventKeys,
			resultTextOfBlocks,
			stemOf,
			buildExportSvg,
			createIdFactory,
			collectTreeIds,
			planGrowthReveal,
			relPathWithin,
			visibleTreeRows,
			// 019 皮肤层与血肉层纯函数（供测试）。
			resolveToken,
			resolveNodeStyle,
			exportPalette,
			hasInlineFormat,
			isTableSeparator,
			parseTableRow,
			nodeFullText,
			renderInline,
			stripInlineForExport,
			wrapExportText,
			COLOR_THEMES,
			TOKEN_REGISTRY,
			clampZoom,
			stepZoom,
			fitZoom,
			focusZoom,
			TOOL_NAMES,
			OPENING_OPS,
		});
		return module.exports;
	}
});

// Generated source fragment. Edit this file, then run npm run build:client.
		//#region PNG 导出（SVG 序列化 → canvas → 下载 / 剪贴板）
		// 019 可变盒高布局：盒高按内容估行数（全量换行的导出形态），表格节点加宽；
		// 布局契约不变——叶子自上而下占行、父节点垂直居中于其子块。
		// 导出拥有独立的 SVG 度量：13px 正文、12px 表格、18px 行高；不随画布
		// 的 NODE_FONT_SIZE 或 CSS zoom 改动，否则预估盒高与导出绘制会失配。
		// 039 导出版式修复（断词 / 贴边 / 疏密失衡）：
		//  - 度量：改用真实字体宽度（canvas measureText，与绘制同一字体串）；
		//    无 canvas 的环境退回字符估算兜底。测量与绘制共用同一套宽度，
		//    文字不再贴边或溢出卡片。
		//  - 折行：按词优先——英文/数字词不从中间拆开；超长词（长 URL）才逐字
		//    硬断，全量文字不缩减、不截断（003 §5.5 / §7 契约不变）。
		//  - 盒宽：按内容自适应（min/max 钳制）；同层左缘对齐、按层成列——
		//    短标题不再空一大块，长正文不再被挤成多行。
		const EXPORT = {
			// 039 节点宽度按内容自适应：短标题收窄、长正文放宽。
			minNodeW: 72,
			maxNodeW: 380,
			padX: 12, padY: 8, hGap: 48, vGap: 12, pad: 20,
			fontSize: 13, lineHeight: 18,
			// 测量与绘制共用同一字体串：估宽与实际字形一致。
			fontFamily: "-apple-system, 'PingFang SC', 'Microsoft YaHei', 'Hiragino Sans GB', sans-serif",
			monoFamily: "Menlo, Consolas, 'Courier New', monospace",
			tableCellW: 110, tableCellPad: 8, tableMinW: 140, tableMaxW: 480,
			// 单元格折行宽下限 = 导出字号 12px 的全角宽：极宽表（如 60 列）
			// 列盒窄于内距时 cellInner 可能为负，钳到至少容纳一个全角字符；
			// 测量与渲染必须共用同一钳制值（022 契约）。
			tableCellMinInner: 12,
			maxCanvasDimension: 8192,
			maxCanvasPixels: 16 * 1024 * 1024,
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
			// 链接 URL 的嵌套括号亲缘度见 markdown.js 的 LINK_URL（四处同源）。
			return String(text ?? "")
				.replace(new RegExp("!\\[([^\\]]*)\\]\\((" + LINK_URL + ")\\)", "g"), "$2")
				.replace(new RegExp("\\[([^\\]]*)\\]\\((" + LINK_URL + ")\\)", "g"), (m, label, url) => (label ? `${label}(${url})` : url))
				.replace(/`([^`]+)`/g, "$1")
				.replace(/\*\*([^*]+)\*\*/g, "$1")
				.replace(/~~([^~]+)~~/g, "$1")
				.replace(/\*([^*\n]+)\*/g, "$1");
		}

		/** 导出字体串：测量（canvas）与绘制（SVG）共用，字宽与字形一致。 */
		function exportFontSpec(fontSize, weight, mono) {
			return `${weight} ${fontSize}px ${mono ? EXPORT.monoFamily : EXPORT.fontFamily}`;
		}

		let exportMeasureCtx;
		let exportMeasureReady = false;

		/** 惰性取 canvas 2d 上下文：有则用真实字形度量，没有则走字符估算兜底。 */
		function exportMeasureContext() {
			if (!exportMeasureReady) {
				exportMeasureReady = true;
				try {
					if (typeof document !== "undefined" && document && typeof document.createElement === "function") {
						const canvas = document.createElement("canvas");
						const ctx = canvas && typeof canvas.getContext === "function" ? canvas.getContext("2d") : null;
						if (ctx && typeof ctx.measureText === "function") exportMeasureCtx = ctx;
					}
				} catch (error) {
					// 度量不可用不是致命错误：退回字符估算，导出照常出图。
				}
			}
			return exportMeasureCtx;
		}

		/** 字符宽度估算（无 canvas 时的兜底）：CJK 按一个字号宽，其余按 0.55 折算。 */
		function charW(ch, fontSize) {
			return ch.charCodeAt(0) > 0x2e7f ? fontSize : fontSize * 0.55;
		}

		function estimateExportText(text, fontSize, mono) {
			const s = String(text ?? "");
			if (mono) return [...s].length * fontSize * 0.6;
			let w = 0;
			for (const ch of s) w += charW(ch, fontSize);
			return w;
		}

		/** 文字宽度：浏览器走真实字形，其余走估算兜底。 */
		function measureExportText(text, fontSize, weight = 400, mono = false) {
			const ctx = exportMeasureContext();
			if (ctx) {
				try {
					ctx.font = exportFontSpec(fontSize, weight, mono);
					return ctx.measureText(String(text ?? "")).width;
				} catch (error) {
					// 落回字符估算。
				}
			}
			return estimateExportText(text, fontSize, mono);
		}

		const EXPORT_WORD_CHAR = /[0-9A-Za-z]/;
		const EXPORT_WORD_JOIN = /[-_.+/#@&']/;

		/**
		 * 039 折行原子：CJK 逐字可断；拉丁/数字词整体不可断（不从中间拆词）；
		 * 空白单独成块（行尾空白保留在行末，渲染时被折叠、字符不丢）。
		 */
		function exportAtoms(segment) {
			const chars = [...String(segment ?? "")];
			const atoms = [];
			let i = 0;
			while (i < chars.length) {
				const ch = chars[i];
				if (ch === " " || ch === "\t") {
					atoms.push({ text: ch, space: true });
					i += 1;
					continue;
				}
				if (ch.charCodeAt(0) > 0x2e7f) {
					atoms.push({ text: ch, space: false });
					i += 1;
					continue;
				}
				if (EXPORT_WORD_CHAR.test(ch)) {
					let j = i + 1;
					while (j < chars.length) {
						const c = chars[j];
						if (EXPORT_WORD_CHAR.test(c)) { j += 1; continue; }
						// 词内连接符（- _ . / # + @ & '）跟随后面的词字符一起算一个词。
						if (EXPORT_WORD_JOIN.test(c) && j + 1 < chars.length && EXPORT_WORD_CHAR.test(chars[j + 1])) { j += 1; continue; }
						break;
					}
					atoms.push({ text: chars.slice(i, j).join(""), space: false });
					i = j;
					continue;
				}
				atoms.push({ text: ch, space: false });
				i += 1;
			}
			return atoms;
		}

		/**
		 * 按可用宽度折行（尊重显式换行；优先按词断行，英文词不从中间拆开；
		 * 超长词/长 URL 才逐字硬断——长串完整呈现不截断）。
		 *
		 * 空白契约（039 复查修正）：
		 *  - 原文顺序不变：行首空白留在行首、行尾空白留在行末，中间空白留在词间；
		 *    逐行拼回恒等于原文（字符一个不丢、不搬家）。
		 *  - 断行决策必须把「即将插入的空白」算进去：词本身放得下、连同词间空白
		 *    放不下时照样要断，否则这一行会顶破内容区、吃掉右内距。
		 *  - 宽度口径与渲染一致：行首空白渲染时被裁掉、不占宽度；词间空白在行内
		 *    可见，按实宽计入（保守，宁可早断不越界）。
		 */
		function wrapExportText(text, maxWidth, fontSize, options = {}) {
			const weight = options.weight || 400;
			const mono = options.mono === true;
			const measure = (value) => measureExportText(value, fontSize, weight, mono);
			const lines = [];
			for (const segment of String(text ?? "").split("\n")) {
				const atoms = exportAtoms(segment);
				let cur = "";       // 本行已定稿的文字（不含行首空白）
				let curW = 0;       // 本行宽度（不含行首空白）
				let lead = "";      // 行首空白：渲染时被裁掉，不占宽度
				let pending = "";   // 词间空白：尚未插入下一个词
				let pendingW = 0;
				const flush = () => {
					lines.push(lead + cur + pending);
					cur = "";
					curW = 0;
					lead = "";
					pending = "";
					pendingW = 0;
				};
				for (const atom of atoms) {
					if (atom.space) {
						if (cur) {
							pending += atom.text;
							pendingW += measure(atom.text);
						} else {
							lead += atom.text;
						}
						continue;
					}
					const aw = measure(atom.text);
					// 断行决策要算上即将插入的词间空白。
					if (cur && curW + pendingW + aw > maxWidth) flush();
					if (!cur && aw > maxWidth) {
						// 超长词（长 URL 等）：逐字硬断，字符一个不丢。
						// 先于该词的空白属于第一片（保持原文顺序）。
						const pieces = [];
						let piece = "";
						let pieceW = 0;
						for (const ch of atom.text) {
							const cw = measure(ch);
							if (pieceW > 0 && pieceW + cw > maxWidth) {
								pieces.push(piece);
								piece = "";
								pieceW = 0;
							}
							piece += ch;
							pieceW += cw;
						}
						if (piece) pieces.push(piece);
						for (let i = 0; i < pieces.length - 1; i += 1) {
							lines.push(i === 0 ? lead + pieces[0] : pieces[i]);
						}
						cur = pieces.length ? pieces[pieces.length - 1] : "";
						curW = measure(cur);
						lead = "";
						pending = "";
						pendingW = 0;
						continue;
					}
					cur += pending + atom.text;
					curW += pendingW + aw;
					pending = "";
					pendingW = 0;
				}
				lines.push(lead + cur + pending);
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

		/** 039 导出字形样式：字重/等宽与绘制一致，测量必须按同一套样式算宽度。 */
		function exportTextStyle(node, isRoot) {
			return {
				weight: isRoot ? 700 : node.kind === "heading" ? 600 : 400,
				mono: node.kind === "code",
			};
		}

		/**
		 * 019/039 盒尺寸：宽度按内容自适应（短标题收窄、长正文放宽），
		 * 文本按该宽度折行后定高。
		 * 022：测量与渲染必须共用钳制后的列宽——先算盒宽再按 w/cols 折行，
		 * 否则宽表（钳到 tableMaxW）按 110px 估行、渲染按更窄列宽折行，盒高不足。
		 */
		function exportBoxSize(node, options = {}) {
			const style = exportTextStyle(node, options.root === true);
			if (node.kind === "table") {
				const rows = (node.data && node.data.rows) || [];
				const cols = rows.reduce((mx, row) => Math.max(mx, row.length), 0) || 1;
				const w = Math.min(EXPORT.tableMaxW, Math.max(EXPORT.tableMinW, cols * EXPORT.tableCellW));
				const cellInner = Math.max(w / cols - EXPORT.tableCellPad * 2, EXPORT.tableCellMinInner);
				const cellLines = rows.map((row, ri) => row.map((cell) => wrapExportText(stripInlineForExport(cell), cellInner, EXPORT.fontSize - 1, { weight: ri === 0 ? 600 : 400 })));
				const rowH = cellLines.map((cells) => Math.max(1, ...cells.map((lines) => lines.length)) * EXPORT.lineHeight);
				const h = Math.max(EXPORT.lineHeight, rowH.reduce((a, b) => a + b, 0));
				return { w, h, style, table: { rows, cols, cellInner, cellLines, rowH } };
			}
			const label = node.kind === "placeholder" ? "待填写" : exportBlock(node).text;
			const widest = Math.max(0, ...String(label).split("\n").map((line) => measureExportText(line, EXPORT.fontSize, style.weight, style.mono)));
			// 左右内距 + 引用块的竖条；+2 是测量与光栅化的安全余量。
			const chrome = EXPORT.padX * 2 + (node.kind === "quote" ? 3 : 0);
			const w = Math.min(EXPORT.maxNodeW, Math.max(EXPORT.minNodeW, Math.ceil(widest) + chrome + 2));
			const inner = w - chrome;
			const lines = wrapExportText(label, inner, EXPORT.fontSize, { weight: style.weight, mono: style.mono });
			return { w, h: EXPORT.padY * 2 + lines.length * EXPORT.lineHeight, style, lines };
		}

		/** 019 盒尺寸估算（对外只暴露尺寸，测量与渲染同源）。 */
		function measureExportBox(node, options = {}) {
			const size = exportBoxSize(node, options);
			return { w: size.w, h: size.h };
		}

		/** 导出节点条目：一次算好样式、盒尺寸与子树，后续布局/绘制共用。 */
		function exportEntryOf(node, depth, parent) {
			const size = exportBoxSize(node, { root: depth === 0 });
			const entry = {
				node,
				depth,
				parent,
				style: size.style,
				table: size.table,
				lines: size.lines,
				text: node.kind === "placeholder" ? "待填写" : exportBlock(node).text,
				w: size.w,
				h: size.h,
				children: [],
			};
			entry.children = (node.children || []).map((child) => exportEntryOf(child, depth + 1, entry));
			return entry;
		}

		/**
		 * 布局 + 生成导出用 SVG 字符串。左→右分层：同层节点左缘对齐成列
		 * （列位由层号决定，盒宽仍按内容自适应），叶子自上而下占行，
		 * 父节点垂直居中于其子块；连线为水平贝塞尔。
		 * 019：盒高随内容生长（表格/引用画专属形态）；色值取主题静态亮色快照
		 *（导出 SVG 走 data-URL，宿主 CSS 变量不可用）。
		 */
		function buildExportSvg(tree, themeName) {
			const palette = exportPalette(themeName);
			const entries = [];
			const root = exportEntryOf(tree, 0, null);
			const collect = (entry) => {
				entries.push(entry);
				for (const child of entry.children) collect(child);
			};
			collect(root);
			// 列宽：同层取最宽者；列位由层号决定——各层左缘对齐，盒宽可各不相同。
			const colW = [];
			for (const entry of entries) colW[entry.depth] = Math.max(colW[entry.depth] || 0, entry.w);
			const colX = [];
			let cursorX = EXPORT.pad;
			for (let depth = 0; depth < colW.length; depth += 1) {
				colX[depth] = cursorX;
				cursorX += colW[depth] + EXPORT.hGap;
			}
			// 高度：自底向上算块高（子块叠放 + 间距）；父盒比子块高时以父盒为准。
			const computeBlock = (entry) => {
				let stack = 0;
				for (const child of entry.children) stack += computeBlock(child);
				if (entry.children.length) stack += EXPORT.vGap * (entry.children.length - 1);
				entry.stackH = stack;
				entry.blockH = Math.max(stack, entry.h);
				return entry.blockH;
			};
			computeBlock(root);
			// 放置：自顶向下分块顶，节点竖直居中于自己的块。
			const place = (entry, blockTop) => {
				entry.x = colX[entry.depth];
				entry.y = blockTop + entry.blockH / 2;
				if (!entry.children.length) return;
				const offset = (entry.blockH - entry.stackH) / 2;
				let top = blockTop + offset;
				for (const child of entry.children) {
					place(child, top);
					top += child.blockH + EXPORT.vGap;
				}
			};
			place(root, EXPORT.pad);
			const width = colX[colX.length - 1] + colW[colW.length - 1] + EXPORT.pad;
			const height = root.blockH + EXPORT.pad * 2;
			const parts = [];
			parts.push(`<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" font-family="${EXPORT.fontFamily}">`);
			parts.push(`<rect x="0" y="0" width="${width}" height="${height}" fill="${palette.canvasBg}"/>`);
			for (const entry of entries) {
				if (!entry.parent) continue;
				const x1 = entry.parent.x + entry.parent.w;
				const y1 = entry.parent.y;
				const x2 = entry.x;
				const y2 = entry.y;
				const mid = (x1 + x2) / 2;
				parts.push(`<path d="M ${x1} ${y1} C ${mid} ${y1}, ${mid} ${y2}, ${x2} ${y2}" fill="none" stroke="${palette.connector}" stroke-width="1.5"/>`);
			}
			for (const entry of entries) {
				const node = entry.node;
				const kind = node.kind;
				const isRoot = entry.depth === 0;
				const isPlaceholder = kind === "placeholder";
				const isCode = kind === "code";
				const isQuote = kind === "quote";
				const isTable = kind === "table";
				const boxY = entry.y - entry.h / 2;
				const fill = isRoot ? palette.rootBg : isCode ? palette.surfaceCode : palette.surface;
				parts.push(`<rect x="${entry.x}" y="${boxY}" width="${entry.w}" height="${entry.h}" rx="7" fill="${isPlaceholder ? "none" : fill}" stroke="${isRoot ? palette.rootBorder : palette.border}" stroke-width="${isRoot ? 1.6 : 1}"${isPlaceholder ? ' stroke-dasharray="5,4"' : ""}/>`);
				if (isQuote) {
					parts.push(`<rect x="${entry.x}" y="${boxY}" width="3" height="${entry.h}" fill="${palette.quote}"/>`);
				}
				if (isTable) {
					// 表格块：完整网格（全量行列、单元格换行、不缩减，003 §5.5）。
					const table = entry.table;
					const cellBoxW = entry.w / table.cols;
					let ry = boxY;
					table.rows.forEach((row, ri) => {
						row.forEach((cell, ci) => {
							const cx = entry.x + ci * cellBoxW;
							parts.push(`<rect x="${cx}" y="${ry}" width="${cellBoxW}" height="${table.rowH[ri]}" fill="${ri === 0 ? palette.surfaceCode : "none"}" stroke="${palette.borderSubtle}" stroke-width="1"/>`);
							table.cellLines[ri][ci].forEach((ln, li) => {
								const ty = ry + (li + 0.5) * EXPORT.lineHeight + (EXPORT.fontSize - 1) * 0.35;
								parts.push(`<text x="${cx + EXPORT.tableCellPad}" y="${ty.toFixed(1)}" font-size="${EXPORT.fontSize - 1}" font-weight="${ri === 0 ? 600 : 400}" fill="${palette.text}">${escapeXml(ln)}</text>`);
							});
						});
						ry += table.rowH[ri];
					});
					continue;
				}
				const color = isPlaceholder ? palette.muted : isRoot ? palette.rootText : kind === "heading" ? palette.heading : palette.text;
				const lines = entry.lines;
				const textX = entry.x + EXPORT.padX + (isQuote ? 3 : 0);
				const startY = entry.y - (lines.length - 1) * EXPORT.lineHeight / 2 + EXPORT.fontSize * 0.35;
				lines.forEach((ln, li) => {
					parts.push(`<text x="${textX}" y="${(startY + li * EXPORT.lineHeight).toFixed(1)}" font-size="${EXPORT.fontSize}" font-weight="${entry.style.weight}" font-family="${isCode ? EXPORT.monoFamily : EXPORT.fontFamily}" fill="${color}">${escapeXml(ln)}</text>`);
				});
			}
			parts.push("</svg>");
			return { svg: parts.join(""), width, height };
		}

		/** Canvas 分配前的硬上限，避免合法但超长的脑图耗尽浏览器内存。 */
		function exportCanvasSize(width, height) {
			const w = Math.max(1, Math.ceil(width));
			const h = Math.max(1, Math.ceil(height));
			if (!Number.isFinite(w) || !Number.isFinite(h) || w > EXPORT.maxCanvasDimension || h > EXPORT.maxCanvasDimension || w * h > EXPORT.maxCanvasPixels) {
				throw new Error("脑图图片过大，请缩小导出范围后重试");
			}
			return { width: w, height: h };
		}

		/** SVG → Image → 白底 canvas（下载 / 剪贴板共用，017 抽出）。 */
		async function renderSvgToCanvas(svg, width, height) {
			const size = exportCanvasSize(width, height);
			const url = `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`;
			const img = new Image();
			await new Promise((resolve, reject) => {
				img.onload = () => resolve();
				img.onerror = () => reject(new Error("脑图 SVG 渲染失败"));
				img.src = url;
			});
			const canvas = document.createElement("canvas");
			canvas.width = size.width;
			canvas.height = size.height;
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

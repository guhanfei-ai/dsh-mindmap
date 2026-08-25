// Generated source fragment. Edit this file, then run npm run build:client.
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

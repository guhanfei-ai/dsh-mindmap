// Generated source fragment. Edit this file, then run npm run build:client.
		//#region PNG 导出（SVG 序列化 → canvas → 下载 / 剪贴板）
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
		async function exportPng(tree, rootTitle) {
			const { svg, width, height } = buildExportSvg(tree);
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
		 * 浏览器侧复制（017 节点右键菜单）：tree 渲染成 PNG 写入系统剪贴板，
		 * 可直接粘贴到聊天 / 文档 / 微信等。ClipboardItem 携带 Blob Promise——
		 * 异步渲染期间保持用户激活态（Chrome 契约）；环境不支持（非安全
		 * 上下文等）或写入被拒时抛错，由菜单提示改用「导出为图片」。
		 */
		async function copyPng(tree) {
			if (typeof ClipboardItem === "undefined" || !navigator.clipboard || typeof navigator.clipboard.write !== "function") {
				throw new Error("当前环境不支持复制图片，请改用「导出为图片」");
			}
			const { svg, width, height } = buildExportSvg(tree);
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



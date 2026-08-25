// Generated source fragment. Edit this file, then run npm run build:client.
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
			tableCell: { border: "1px solid var(--dsw-alias-border-l2)", padding: "3px 8px", whiteSpace: "pre-wrap", overflowWrap: "anywhere", verticalAlign: "top", textAlign: "left", maxWidth: "200px" },
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




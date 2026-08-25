// Generated source fragment. Edit this file, then run npm run build:client.
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

// Generated source fragment. Edit this file, then run npm run build:client.
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



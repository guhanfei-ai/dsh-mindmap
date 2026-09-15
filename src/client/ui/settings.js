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
		 * 写入确认策略在这里可见；当前会话的授权状态由脑图工作区显示。
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
							approvalMode: v && v.requireApproval === false ? "off" : v && ["per-operation", "session", "off"].includes(v.approvalMode) ? v.approvalMode : "session",
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
					return true;
				} catch (err) {
					setError(String(err?.message ?? err));
					return false;
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
				(0, react_jsx_runtime.jsx)("p", { style: S.settingsGroupTitle, children: "写入确认" }),
				(0, react_jsx_runtime.jsxs)("div", { style: S.settingsGroup, children: [
					(0, react_jsx_runtime.jsxs)("div", { style: S.settingsRow, children: [
						(0, react_jsx_runtime.jsx)("span", { style: S.settingsLabel, children: "确认频率" }),
						(0, react_jsx_runtime.jsx)(Segmented, {
							options: [
								{ value: "per-operation", label: "每次确认" },
								{ value: "session", label: "本会话一次" },
								{ value: "off", label: "关闭普通确认" },
							],
							value: value.approvalMode,
							disabled: saving,
							onChange: (v) => setField({ approvalMode: v }),
						}),
					] }),
					(0, react_jsx_runtime.jsx)("p", { style: S.settingsHint, children: value.approvalMode === "session" ? "本会话首次写入当前脑图后，后续普通更新无需重复确认。切换文件或会话会重新确认。" : value.approvalMode === "off" ? "普通更新不再弹窗；重命名、删除和大范围重写仍需确认。" : "每次写入都会弹窗确认。" }),
					value.approvalMode === "session" ? (0, react_jsx_runtime.jsx)("p", { style: S.settingsHint, children: "授权状态显示在当前脑图工作区；可在那里撤销当前会话的普通写入授权。" }) : null,
				] }),
				saving ? (0, react_jsx_runtime.jsx)("p", { style: S.settingsHint, children: "保存中…" }) : null,
				notice ? (0, react_jsx_runtime.jsx)("p", { style: S.settingsNotice, children: notice }) : null,
				error ? (0, react_jsx_runtime.jsx)("p", { style: S.settingsError, children: error }) : null,
			] });
		}

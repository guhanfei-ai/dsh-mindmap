// Generated source fragment. Edit this file, then run npm run build:client.
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



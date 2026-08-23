// Generated source fragment. Edit this file, then run npm run build:client.
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



// Generated source fragment. Edit this file, then run npm run build:client.
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
			const visited = new WeakSet();
			const MAX_SUBCALL_DEPTH = 100;

			function replayNode(node, eventPath, depth) {
				if (!node || typeof node !== "object" || visited.has(node)) return;
				visited.add(node);

				if (node.kind === "tool-result" && !node.isError) {
					const name = node.call?.name;
					if (typeof name === "string" && TOOL_NAMES.has(name)) {
						let parsed;
						try {
							parsed = JSON.parse(resultTextOfBlocks(node.content));
						} catch {
							parsed = null;
						}
						if (parsed && parsed.ok === true && typeof parsed.path === "string" && parsed.path) {
							const op = typeof parsed.op === "string" ? parsed.op : name;
							// callId 是实际调用的事件身份；eventPath 是无 callId 时按会话
							// 遍历顺序生成的稳定兜底，避免重复 open 被合并成一个事件。
							const callId = node.callId != null && String(node.callId)
								? node.callId
								: node.call?.callId;
							const eventKey = callId != null && String(callId)
								? `call:${String(callId)}`
								: `node:${eventPath}`;
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
			return { order, byPath, latestOpeningPath, latestOpeningEventKey };
		}

		/**
		 * 快照文档集（AI 工具结果）与本地直读文档集（read 路由即时打开）合并：
		 * - 快照优先（同 path 覆盖本地占位）；
		 * - 本地文档追加在快照 order 之后；
		 * - 快照里有 renamedFrom 指向某本地路径时，丢弃该本地条目（文件已改名）。
		 */
		function mergeDocuments(snapshot, localDocs) {
			const byPath = { ...localDocs, ...snapshot.byPath };
			const dropped = new Set();
			for (const doc of Object.values(snapshot.byPath)) {
				if (typeof doc.renamedFrom === "string" && doc.renamedFrom && localDocs[doc.renamedFrom]) {
					dropped.add(doc.renamedFrom);
				}
			}
			for (const p of dropped) delete byPath[p];
			const order = [...snapshot.order];
			for (const p of Object.keys(localDocs)) {
				if (!snapshot.byPath[p] && !dropped.has(p)) order.push(p);
			}
			return {
				order,
				byPath,
				latestOpeningPath: snapshot.latestOpeningPath ?? null,
				latestOpeningEventKey: snapshot.latestOpeningEventKey ?? null,
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
		//#endregion

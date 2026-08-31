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

		// 016 起 reduceDocuments 与 nodesFingerprint 共用（从函数体提升到模块层）。
		const MAX_SUBCALL_DEPTH = 100;

		/**
		 * 会话节点的结构指纹（016 可靠性加固）：数组长度 + 逐节点结构身份
		 * （kind / callId / call.name / isError / subCalls 数，递归子树，深度
		 * 上限与 reduceDocuments 一致）。只含结构身份、不含 content 文本——
		 * 流式 token 增长不改变指纹，只有新工具结果节点出现才变。
		 * 用作 useSession 的第二 selector 返回值：字符串按值比较，天然绕过
		 * 「store 原地改数组、引用不变」的相等短路，驱动面板重算快照。
		 */
		function nodesFingerprint(nodes) {
			if (!Array.isArray(nodes)) return "[]";
			const parts = [String(nodes.length)];
			const visit = (node, depth) => {
				if (!node || typeof node !== "object") {
					parts.push("·");
					return;
				}
				parts.push(
					String(node.kind ?? ""),
					String(node.callId ?? ""),
					String(node.call?.name ?? ""),
					node.isError ? "E" : "-",
				);
				const subCalls = Array.isArray(node.subCalls) ? node.subCalls : null;
				parts.push(String(subCalls ? subCalls.length : 0));
				if (subCalls && subCalls.length > 0 && depth < MAX_SUBCALL_DEPTH) {
					for (const subCall of subCalls) visit(subCall, depth + 1);
				}
			};
			for (const node of nodes) visit(node, 0);
			return parts.join("|");
		}

		/** 工具错误消息提取（016）：JSON 信封的 error/message 字段优先，回落原始文本。 */
		function extractErrorMessage(parsed, text) {
			if (parsed && typeof parsed === "object") {
				if (typeof parsed.error?.message === "string" && parsed.error.message) return parsed.error.message;
				if (typeof parsed.error === "string" && parsed.error) return parsed.error;
				if (typeof parsed.message === "string" && parsed.message) return parsed.message;
			}
			const raw = String(text ?? "").trim();
			return raw || "mindmap tool failed";
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
			// 016 错误捕获（S2 成因）：isError / ok!==true 的 mindmap_* 结果不进
			// 文档集（语义不变），但记录为错误信号——errorByPath（可归因路径的
			// 最近错误）+ latestError（最近一次 mindmap 错误，含无路径归因的）。
			const errorByPath = Object.create(null);
			let latestError = null;
			const visited = new WeakSet();

			function replayNode(node, eventPath, depth) {
				if (!node || typeof node !== "object" || visited.has(node)) return;
				visited.add(node);

				if (node.kind === "tool-result") {
					const name = node.call?.name;
					if (typeof name === "string" && TOOL_NAMES.has(name)) {
						const text = resultTextOfBlocks(node.content);
						let parsed;
						try {
							parsed = JSON.parse(text);
						} catch {
							parsed = null;
						}
						// callId 是实际调用的事件身份；eventPath 是无 callId 时按会话
						// 遍历顺序生成的稳定兜底，避免重复 open 被合并成一个事件。
						const callId = node.callId != null && String(node.callId)
							? node.callId
							: node.call?.callId;
						const eventKey = callId != null && String(callId)
							? `call:${String(callId)}`
							: `node:${eventPath}`;
						if (!node.isError && parsed && parsed.ok === true && typeof parsed.path === "string" && parsed.path) {
							const op = typeof parsed.op === "string" ? parsed.op : name;
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
							// 016：成功结果清除同路径历史错误（含 rename 旧路径）。
							delete errorByPath[parsed.path];
							if (renamedFrom && renamedFrom !== parsed.path) delete errorByPath[renamedFrom];
						} else if (node.isError || (parsed && typeof parsed === "object" && parsed.ok !== true)) {
							// 016 错误捕获：host 工具抛错时结果通常是纯文本（无 JSON 信封），
							// 有信封但 ok!==true 的同样收集。可归因路径的进 errorByPath；
							// latestError 恒记录最近一次——无路径错误由面板用「点击时刻
							// 基线」（errorEventKeys）归因到在途的打开请求。
							const errPath = parsed && typeof parsed === "object" && typeof parsed.path === "string" && parsed.path
								? parsed.path
								: null;
							const entry = {
								op: parsed && typeof parsed.op === "string" ? parsed.op : name,
								message: extractErrorMessage(parsed, text),
								callId,
								eventKey,
							};
							if (errPath) errorByPath[errPath] = entry;
							latestError = entry;
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
			return { order, byPath, latestOpeningPath, latestOpeningEventKey, errorByPath, latestError };
		}

		/**
		 * 快照文档集（AI 工具结果）与本地直读文档集（read 路由即时打开）合并：
		 * - 快照优先（同 path 覆盖本地占位）；
		 * - 本地文档追加在快照 order 之后；
		 * - 快照里有 renamedFrom 指向某本地路径时，丢弃该本地条目（文件已改名）；
		 * - 016 大小写 fallback（S5 成因）：本地占位（op:"local"）与快照文档仅
		 *   大小写不一致时（macOS 大小写不敏感 FS 上，AI 回传的规范 path 与树
		 *   点击 key 不同），丢弃占位键、保留快照规范 path——加载态随之解除，
		 *   既有 auto-open / 焦点同步机制照常接管。
		 * 错误信号（errorByPath / latestError）原样透传，容缺（旧快照无此字段）。
		 */
		function mergeDocuments(snapshot, localDocs) {
			const snapByPath = (snapshot && snapshot.byPath) || {};
			const byPath = { ...localDocs, ...snapByPath };
			const dropped = new Set();
			for (const doc of Object.values(snapByPath)) {
				if (typeof doc.renamedFrom === "string" && doc.renamedFrom && localDocs[doc.renamedFrom]) {
					dropped.add(doc.renamedFrom);
				}
			}
			const snapPaths = Object.keys(snapByPath);
			for (const p of Object.keys(localDocs)) {
				if (snapByPath[p] || dropped.has(p)) continue;
				if (!localDocs[p] || localDocs[p].op !== "local") continue;
				const lower = p.toLowerCase();
				if (snapPaths.some((sp) => sp.toLowerCase() === lower)) dropped.add(p);
			}
			// 只删本地条目；若该路径同时是存活快照文档
			// （改名后又重建），快照保留，面板照常打开。
			for (const p of dropped) if (!snapByPath[p]) delete byPath[p];
			const order = [...(snapshot?.order ?? [])];
			for (const p of Object.keys(localDocs)) {
				if (!snapByPath[p] && !dropped.has(p)) order.push(p);
			}
			return {
				order,
				byPath,
				latestOpeningPath: snapshot?.latestOpeningPath ?? null,
				latestOpeningEventKey: snapshot?.latestOpeningEventKey ?? null,
				errorByPath: snapshot?.errorByPath ?? {},
				latestError: snapshot?.latestError ?? null,
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

		/**
		 * 找到可归因到某文档路径的错误（016 加载态恢复）：优先 errorByPath
		 * 精确匹配，其次小写全路径匹配（S5 同源）；sinceKeys（openMindmap
		 * 点击时刻的错误基线，见 errorEventKeys）提供时只认其后新出现的错误，
		 * 且无新路径错误时回落 latestError（无路径归因的最近错误）。
		 */
		function matchDocError(snapshot, path, sinceKeys) {
			if (!snapshot || typeof path !== "string" || !path) return null;
			const errors = snapshot.errorByPath ?? {};
			let matched = errors[path] ?? null;
			if (!matched) {
				const lower = path.toLowerCase();
				for (const key of Object.keys(errors)) {
					if (key.toLowerCase() === lower) {
						matched = errors[key];
						break;
					}
				}
			}
			if (sinceKeys) {
				if (matched && sinceKeys.has(matched.eventKey)) matched = null;
				const latest = snapshot.latestError ?? null;
				if (!matched && latest && !sinceKeys.has(latest.eventKey)) matched = latest;
			}
			return matched;
		}

		/** 当前快照的全部错误事件键（errorByPath + latestError），作「点击时刻基线」。 */
		function errorEventKeys(snapshot) {
			const keys = new Set();
			if (!snapshot) return keys;
			for (const entry of Object.values(snapshot.errorByPath ?? {})) {
				if (entry && entry.eventKey != null) keys.add(entry.eventKey);
			}
			const latest = snapshot.latestError;
			if (latest && latest.eventKey != null) keys.add(latest.eventKey);
			return keys;
		}
		//#endregion

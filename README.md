# dsh-mindmap

[简体中文](./README.zh-CN.md)

A DeepSeek Harness plugin that turns a plain Markdown file into a live mindmap. The working directory is the document: the chat is the editor, the AI edits the `.md` step by step, and the right-side floating panel re-renders the mindmap in real time.

> Project status: pre-1.0. The current feature set (see [CHANGELOG](./CHANGELOG.md)) is implemented and covered by unit tests, but cross-version compatibility beyond the development environment is not yet certified.

## The core idea

- Open a Markdown file — it **is** a mindmap.
- The chat is not the main character; it is the assistant that edits the mindmap next to you.
- You say one sentence, the AI edits the `.md` one step, the panel follows instantly.
- Mindmap = Markdown: diffable, shareable, and git-friendly by nature.

## Features

- **Four tools** (`mindmap_create` / `mindmap_open` / `mindmap_get` / `mindmap_update`) — plain Markdown files in the session working directory; the root node title is the filename and stays in sync both ways (`renameRoot` renames the file, collisions are rejected).
- **Live panel with zero extra channels** — the panel consumes the session snapshot (`mindmap_*` tool results), so every AI edit re-renders immediately.
- **Reliable open, recoverable loading state** — AI create/open results always expand the panel (a structural-fingerprint selector drives snapshot recomputation even when the host reuses the nodes array reference); clicking a `.md` first reads it through the local read-only route, while AI fallback loading still recovers from case-only path mismatches, inline tool errors, and a ~30s watchdog timeout with one-click retry.
- **Refresh from disk** — 刷新脑图 reloads the current file while preserving drafts and attachments, without submitting a model request. Fresh disk content stays visible until a later tool result arrives; overlapping reads, closing, and session changes cannot let an old request replace the new view. Failed refreshes retain the canvas and show a retryable error.
- **Draft protection** — uses the host's published input snapshot for text, references, and attachments. Pending or unreadable input is preserved; files still open through the read-only route and editing commands remain available for manual submission.
- **Graceful parse failure** — if a document's Markdown ever breaks the parser, the panel never crashes: the mindmap area shows an explicit parse-failed state with the error, the original file is left untouched, and you can switch back to the directory tab or let the AI fix the content and reopen. Normal documents never reach this path.
- **Floating right panel or native sidebar tab** — when `dsh-better-sidebar` is installed, the mindmap registers as a native single-instance tab (`dsh-mindmap:mindmap`) inside Better Sidebar, with a compact one-row toolbar (mindmap list, current mindmap, and export on the same line); the header 思维脑图 button opens or focuses that tab. When Better Sidebar is absent, the panel falls back to a standalone floating right panel toggled by the 思维脑图 button — drag-resizable (280px ~ 80% viewport), persisted, and pushing the chat left (layout-push) so the two never overlap. AI create/open/view intents always open or focus the panel/tab and switch to the target document, including when it is currently closed or the same document is opened again. The mode switch is fully reversible: if Better Sidebar is unloaded mid-session, the standalone panel and layout-push CSS are restored automatically.
- **Directory tree tab** — a persistent tree of the session working directory (served by plugin-owned read-only routes), lazy-loaded per directory; right-click to create a mindmap in the inbox or inside a directory; left-click a `.md` renders it through the read-only route first, then hands it to the AI for editing when the draft is empty. Labeled 目录 in standalone mode and 脑图列表 in sidebar mode.
- **Single-mindmap mode** — two tabs only: the tree/list tab and 脑图 (the current mindmap); opening another `.md` replaces the previous one.
- **"What you see is what the AI edits"** — when the visible mindmap differs from the AI's working document, the panel automatically asks the AI to open it, keeping the chat focus in sync.
- **MarkGrove-style mapping** — heading hierarchy, nested lists (empty items become placeholder nodes), code blocks as leaf nodes, paragraphs promoted to their own nodes (019 block concept), stable structural IDs, and orthogonal connector lines between nodes.
- **Centered canvas with zoom and pan** — the mindmap opens centered in the canvas; the top-right zoom bar (out / percent / in / 适配 / 全图) auto-fits on open without shrinking 13px node text below an effective 12px. Larger maps remain scrollable. 全图 instead tries to frame the entire tree, even below the readable floor, but stops at 25%: exceptionally large maps can still overflow. Manual zoom spans 25%–300%, and automatic re-fitting after AI edits pauses when you choose a zoom or 全图; 适配 restores it.
  Clicking a node focuses it at a readable scale near the left-quarter anchor; large subtrees may extend beyond the viewport. The ≤250 ms transition has no first-frame jump, normally changes zoom by at most ×2/÷2 per click (except when restoring readability after manual zoom below 12px), and writes frames directly to the canvas DOM without re-rendering the tree. New interactions interrupt it; when an AI edit pushes a selected node completely out of view, the canvas minimally scrolls it back without changing your zoom.
  Narrow panels fit by height instead of width and reserve a stable scrollbar gutter. Pan with the **middle button** anywhere, the **left button on blank canvas** (including Mac trackpad click-and-drag), or **Space + left button** on a card. Dragging follows the pointer even at scroll edges; a 4px threshold keeps clicks and the selection ring distinct from pans.
- **Collapsible subtrees** — every node with children carries a small toggle on its connector: collapsing hides the whole subtree and reports how many nodes are hidden, so large maps stay navigable. It is view state only — the markdown file is untouched, image export still covers the full subtree, and switching documents expands everything again.
- **PNG export** — one click on 导出图片 exports the current mindmap.
- **Copy as markdown** — one click on 复制全文 (left of 导出图片) copies the current mindmap's raw markdown source to the system clipboard, so pasting into markdown-aware editors restores headings, nested lists, and tables, while plain-text targets keep the literal `#`/`-` source. The button shows 已复制 ✓ for about two seconds on success; failures reuse the export error slot.
- **Node search and quick navigation** — search the current mindmap by text (⌘/Ctrl+F, or the 🔍 in the zoom bar), jump through matches with Enter / ↑ ↓ (wrap-around), and automatically reveal matches inside collapsed subtrees. Jumping keeps your zoom and only scrolls; search is view-only, so the markdown never changes.
- **Safety** — write approval defaults to “once per session/document”: after the first confirmation, ordinary `mindmap_update` calls for that document in the same session do not interrupt the flow. The settings page also offers “every write” and “disable ordinary confirmations”. Renames, deletes, and broad rewrites still require a separate confirmation; the current workspace shows and can revoke the current-session grant. Trusted automation can explicitly set `requireApproval: false` to skip ordinary confirmations; high-risk writes remain gated. The client has **no write path** to the filesystem — every edit goes through the AI tools.

Inside Better Sidebar, the mindmap list uses the host's 14px body typography. Markdown files carry a compact M badge; folders and other files use 14px outline icons. Other file formats are display-only, without hover feedback, opening, dragging, or context menus; folders remain expandable. Tabs, actions, and hints use the host's 12px typography role. Standalone mode retains its original appearance, and mindmap node typography, zoom, and image export are unchanged.

The embedded M badge uses a transparent background and inherits the filename's theme color for both its bold letter and outline, so it follows light/dark themes and custom skins without relying on accent-color contrast.

## Where new mindmaps go

When you ask for a mindmap without naming a location — "创建一个脑图", "把刚才的讨论整理成脑图", "盘点一下这个问题" — the file lands in **`.mindmaps/`**, the mindmap inbox:

```text
.mindmaps/20260918-155230-项目盘点.md
```

- The `YYYYMMDD-HHmmss` stamp is read by the host from the real clock; the model only supplies the short description (cleaned and truncated to 24 characters). Two captures in the same second get `-2`, `-3`, … suffixes — an existing file is never overwritten, and the write-confirmation names the exact file it is about to create.
- The path is checked twice: once when the confirmation is drawn, and again against the filesystem right before the write. If the target directory moved or was swapped for a symlink while you were reading the confirmation, the create is refused instead of writing outside the session working directory.
- `.mindmaps/` is created on first use, not at install time. The directory tree shows it as **脑图收件箱（.mindmaps）**, because a dotted folder otherwise reads as tool residue.
- Nothing is added to `.gitignore` for you. A mindmap stays an ordinary Markdown file: review it, diff it, commit it, or move it somewhere permanent.
- Say the location instead and it is respected: `docs/架构脑图.md`, `planning/迭代计划.md`, or right-click a folder in the tree and choose 在此目录新建 Markdown 脑图. An explicit directory is never rewritten into the inbox (and still has to stay inside the session working directory).
- Because the root node title *is* the filename, a default-created mindmap shows its own timestamp as the root title for now. Splitting filename from display title is a separate decision, so rename the root when you want a clean title.

## Requirements

| Component | Baseline |
| --- | --- |
| Node.js | 20.11 or newer |
| DeepSeek Harness | tested against `0.1.1-rc.2`, `0.1.2-rc.1`, and `0.1.5-rc.1` |

Input, settings, and conversation contracts from `0.2.0-rc.2` / `0.2.1-alpha.1` have offline regression coverage; this does not certify every host workflow. API requests retain the page's base path for reverse-proxy deployments and enforce the page's origin.

## Installation

Development (link install, live source):

```bash
dsh plugin --profile web add link:/path/to/dsh-mindmap
```

Released tag:

```bash
dsh plugin --profile <profile> add <pkg>#v<version>
```

Exact npm version:

```bash
dsh plugin --profile <profile> add dsh-mindmap@<version>
```

New-version cooldown policies can affect package selection shortly after publication. Check the actual installed version in plugin management; use an exact version when needed.

## Tools

| Tool | Description |
| --- | --- |
| `mindmap_create(name? \| description, directory?)` | Create a mindmap and show it in the panel (fails if the file already exists). With `name`, the file is `<name>.md`; without it, pass a short `description` and the host names the file `YYYYMMDD-HHmmss-<description>.md` inside the `.mindmaps/` inbox. Pass `directory` only when the user chose a location. |
| `mindmap_open(path)` | Open an existing `.md` as a mindmap in the panel. |
| `mindmap_get(path)` | Read the current Markdown content and revision of a mindmap document. |
| `mindmap_update(path, content, renameRoot?, expectedRevision?)` | Write the full Markdown; pass the read revision to reject stale writes; optionally rename the root node (renames the file, collisions rejected). |

## Development

```bash
npm run build:client  # assemble the runtime client.js from src/client fragments
npm run verify        # rebuild + syntax check + node --test
npm run bench:client  # pure-computation long-conversation replay benchmark
npm pack --dry-run    # inspect the files that will enter the npm package
```

The browser implementation is maintained under `src/client/` and assembled into the single `client.js` entry required by DeepSeek Harness. Edit the source fragments, then run `npm run build:client`; do not hand-edit the generated entry.

Document replay shares a session-local parse cache, invalidates changed text, and starts fresh after session changes. The benchmark uses 3000 fictional conversation nodes and 200 mindmap results, verifies cached and full replay equivalence, then measures their time. It measures replay cost, not browser frame rates or overall UI performance.

## License

MIT License. See [LICENSE](LICENSE) for details.

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
- **Graceful parse failure** — if a document's Markdown ever breaks the parser, the panel never crashes: the mindmap area shows an explicit parse-failed state with the error, the original file is left untouched, and you can switch back to the directory tab or let the AI fix the content and reopen. Normal documents never reach this path.
- **Floating right panel or native sidebar tab** — when `dsh-better-sidebar` is installed, the mindmap registers as a native single-instance tab (`dsh-mindmap:mindmap`) inside Better Sidebar, with a compact one-row toolbar (mindmap list, current mindmap, and export on the same line); the header 思维脑图 button opens or focuses that tab. When Better Sidebar is absent, the panel falls back to a standalone floating right panel toggled by the 思维脑图 button — drag-resizable (280px ~ 80% viewport), persisted, and pushing the chat left (layout-push) so the two never overlap. AI create/open/view intents always open or focus the panel/tab and switch to the target document, including when it is currently closed or the same document is opened again. The mode switch is fully reversible: if Better Sidebar is unloaded mid-session, the standalone panel and layout-push CSS are restored automatically.
- **Directory tree tab** — a persistent tree of the session working directory (served by plugin-owned read-only routes), lazy-loaded per directory; right-click to create a mindmap in the inbox or inside a directory; left-click a `.md` renders it through the read-only route first, then hands it to the AI for editing when the draft is empty. Labeled 目录 in standalone mode and 脑图列表 in sidebar mode.
- **Single-mindmap mode** — two tabs only: the tree/list tab and 脑图 (the current mindmap); opening another `.md` replaces the previous one.
- **"What you see is what the AI edits"** — when the visible mindmap differs from the AI's working document, the panel automatically asks the AI to open it, keeping the chat focus in sync.
- **MarkGrove-style mapping** — heading hierarchy, nested lists (empty items become placeholder nodes), code blocks as leaf nodes, paragraphs promoted to their own nodes (019 block concept), stable structural IDs, and orthogonal connector lines between nodes.
- **Centered canvas with zoom and pan** — the mindmap opens centered in the canvas (scrollable without edge clipping when larger); a floating zoom bar at the canvas top-right (zoom out / percent / zoom in / fit) applies auto fit-to-view on open (small maps stay at 100%), steps through 25%–300% with a stable view center, and keeps re-fitting as the AI edits — until you zoom manually. Click any node to zoom in on it and its whole subtree, with the node pinned at the left-center of the canvas. The focus transition glides the node from its clicked position to the left-quarter anchor with no first-frame jump, animates the zoom over ≤250 ms (capped at ×2/÷2 per click, so a huge map drills down progressively instead of jumping 4× in one step), and writes frames directly to the canvas DOM layer without re-rendering the tree per frame; any new interaction interrupts it instantly. When an AI edit pushes the selected node fully out of view, the canvas performs a minimal scroll to bring it back to the edge without touching your chosen zoom. Narrow panels (sidebar mode) fit by height instead of width — the overflowing part is reachable by panning — and the scrollbar gutter is reserved, so the fit ratio no longer oscillates as scrollbars appear. The canvas also pans by drag: the **middle button** anywhere (even over a node), the **left button on blank canvas** (the Mac trackpad「click and drag」path), or **Space + left button** when the drag must start on a card. Panning works in both directions even when content does not overflow; content follows the pointer 1:1, blank space shows a grab hand, and a 4px threshold separates drag from click — so clicking blank space still clears the selection and clicking a node still focuses it, while a real drag never wipes the selection ring.
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

## Installation

Development (link install, live source):

```bash
dsh plugin --profile web add link:/path/to/dsh-mindmap
```

Released tag:

```bash
dsh plugin --profile <profile> add <pkg>#v<version>
```

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
npm pack --dry-run    # inspect the files that will enter the npm package
```

The browser implementation is maintained under `src/client/` and assembled into the single `client.js` entry required by DeepSeek Harness. Edit the source fragments, then run `npm run build:client`; do not hand-edit the generated entry.

## License

MIT License. See [LICENSE](LICENSE) for details.

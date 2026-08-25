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
- **Floating right panel** — toggled by the 思维脑图 button in the session header; AI create/open/view intents also expand it and switch to the target document, including when the panel is currently closed or the same document is opened again. Opening the panel pushes the chat to the left (layout-push, the chat is never covered); width is drag-resizable (280px ~ 80% viewport) and persisted.
- **Directory tree tab** — a persistent tree of the session working directory (served by a plugin-owned read-only route), lazy-loaded per directory; right-click to create a mindmap (at the root or inside a directory); left-click a `.md` to open it instantly and hand it to the AI for editing.
- **Single-mindmap mode** — two tabs only: 目录 (tree) and 脑图 (the current mindmap); opening another `.md` replaces the previous one.
- **"What you see is what the AI edits"** — when the visible mindmap differs from the AI's working document, the panel automatically asks the AI to open it, keeping the chat focus in sync.
- **MarkGrove-style mapping** — heading hierarchy, nested lists (empty items become placeholder nodes), code blocks as leaf nodes, paragraphs as node notes, stable structural IDs, and orthogonal connector lines between nodes.
- **Centered canvas with zoom** — the mindmap opens centered in the canvas (scrollable without edge clipping when larger); a floating zoom bar at the canvas top-right (zoom out / percent / zoom in / fit) applies auto fit-to-view on open (small maps stay at 100%), steps through 25%–300% with a stable view center, and keeps re-fitting as the AI edits — until you zoom manually. Click any node to zoom in on it and its whole subtree, with the node pinned at the left-center of the canvas.
- **PNG export** — one click on 导出图片 exports the current mindmap.
- **Safety** — `mindmap_update` is approval-free by default (files are git-managed) with a `requireApproval` switch as an escape hatch; the client has **no write path** to the filesystem — every edit goes through the AI tools.

## Requirements

| Component | Baseline |
| --- | --- |
| Node.js | 20.11 or newer |
| DeepSeek Harness | tested against `0.1.1-rc.2` |

## Installation

Development (link install, live source):

```bash
dsh plugin --profile web add link:/path/to/dsh-mindmap
```

Released tag (once published):

```bash
dsh plugin --profile <profile> add <pkg>#v<version>
```

## Tools

| Tool | Description |
| --- | --- |
| `mindmap_create(name)` | Create `<name>.md` in the session working directory and show it in the panel (fails if it exists). |
| `mindmap_open(path)` | Open an existing `.md` as a mindmap in the panel. |
| `mindmap_get(path)` | Read the current Markdown content of a mindmap document. |
| `mindmap_update(path, content, renameRoot?)` | Write the full updated Markdown; optionally rename the root node (renames the file, collisions rejected). |

## Development

```bash
npm run build:client  # assemble the runtime client.js from src/client fragments
npm run verify        # rebuild + syntax check + node --test
npm pack --dry-run    # inspect the files that will enter the npm package
```

The browser implementation is maintained under `src/client/` and assembled into the single `client.js` entry required by DeepSeek Harness. Edit the source fragments, then run `npm run build:client`; do not hand-edit the generated entry.

## License

MIT License. See [LICENSE](LICENSE) for details.

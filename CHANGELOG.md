# Changelog

All notable changes to this project are documented here. Release-specific notes are also published on GitHub Releases.

## [Unreleased]

### Added

- Settings page section「思维脑图」in the left nav (`settings.section`), backed by a host settings namespace (`mindmap`): node theme (line style curve/elbow, card corners rounded/square, three color themes ocean/sunset/forest), default panel width (20-80%). The `requireApproval` switch stays functional (read at tool pre-execute time) but is hidden from the UI by design. Introduces a `@deepseek-ai/schemastery` dependency for the settings schema.

## [0.1.0] - 2026-08-23

First release of dsh-mindmap: a plain Markdown file in the session working directory becomes a live mindmap.

### Added

- **Tools**: `mindmap_create` / `mindmap_open` / `mindmap_get` / `mindmap_update` (host side). Root node title = filename, bidirectional sync via `renameRoot` (file rename, collision-safe); path escape protection; `requireApproval` switch (default off) with a `tools/pre-execute` ask hook.
- **Live panel**: consumes the session snapshot (`mindmap_*` tool results) and re-renders on every AI edit — no custom event channel needed.
- **Floating panel (overlay)**: registered in the session header slot with a fixed-position host layer (better-sidebar-style self-bootstrap); toggled by the 思维脑图 button, auto-opens on AI `mindmap_open`/`create`; **layout-push** squeezes `#root` so the chat shifts left instead of being covered; drag-resizable width (280px ~ 80% viewport) persisted in localStorage. The `details` slot is left to the official tool-details panel.
- **Directory tree tab**: persistent tree of the session working directory served by a plugin-owned read-only route (`POST /mindmap/api/tree`, Node fs, same-origin fence, path containment); lazy per-directory loading, dirs-first sorting, hidden entries; right-click to create a mindmap (root or inside a directory); `.md` click opens the tab instantly (placeholder + loading spinner) and auto-sends `mindmap_open` to the AI; the tab renders nodes only after the AI result lands.
- **Single-mindmap mode**: two tabs (目录 / 脑图), opening a new `.md` replaces the current mindmap; close button + right-click menus.
- **Focus sync ("what you see is what the AI edits")**: when the visible mindmap differs from the AI's working document, the panel fills and submits `mindmap_open` automatically (suppressed while the panel is closed).
- **MarkGrove-style rendering**: heading hierarchy (H1 under root, H2 under the preceding H1), nested lists with 2-space indentation, empty list items as placeholder nodes, code blocks as `[lang] first-line` leaf nodes, paragraphs as node notes, stable structural IDs; **orthogonal connector lines** between nodes (measured SVG layer); first H1 that echoes the root title merges into the root node.
- **PNG export**: SVG serialization → canvas → PNG download.
- **Visual system**: emoji folder icons, `.md` "M" badge, hover highlights, active-tab indicator, spaced layout aligned to the tab edge.
- **Project hygiene**: numbered record documents live in `docs/` (gitignored); README (en/zh) and CHANGELOG.
- **Tests**: 42 cases via the Node built-in test runner (`npm run verify`), covering tools, path safety, approval hook, markdown parsing, document replay/merge, tree rows, HTTP route guards, and slot registration.

### Known limitations

- Manual edits to a `.md` outside the AI tools are only picked up on the next AI `mindmap_*` touch of that file.
- The panel is unavailable in a blank (no-session) state, since it lives in a session-scoped slot.
- Running two layout-push plugins (e.g. dsh-better-sidebar) with both panels open at once is a known boundary: both target `#root` and the later-injected rule wins.

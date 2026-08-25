# Contributing

Thank you for helping improve dsh-mindmap.

## Development setup

Requirements: Node.js 20.11 or newer and a compatible DeepSeek Harness installation.

```bash
npm ci
npm run verify
```

Use a local plugin link for manual testing:

```bash
dsh plugin --profile <profile> add link:/absolute/path/to/dsh-mindmap
```

## Working with the client source

The browser implementation lives under `src/client/` and is assembled into the single `client.js` entry required by DeepSeek Harness. Always edit the source fragments and run `npm run build:client` afterwards — do not hand-edit the generated `client.js`.

## Pull requests

- Keep changes focused and preserve the existing no-build runtime format.
- Add or update tests for behavioral changes.
- Never include personal data, private markdown documents, or internal URLs.
- Treat every write-path change as safety-sensitive: preserve approval and identity checks.
- Update both `README.md` and `README.zh-CN.md` when user-facing behavior changes.
- Run `npm run verify` and `npm pack --dry-run --ignore-scripts` before opening a pull request.

Use clear commit messages. Releases are created only through `deploy.sh`; ordinary pushes must not create tags or Releases.

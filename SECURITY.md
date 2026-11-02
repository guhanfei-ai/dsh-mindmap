# Security policy

## Supported versions

Security fixes are provided for the latest released pre-1.0 version only. Users should install an immutable Git tag and upgrade promptly when a new release is published.

## Reporting a vulnerability

Do not open a public issue for a suspected vulnerability, credential leak, or unsafe document write.

Use GitHub's private vulnerability reporting or a private Security Advisory for `guhanfei-ai/dsh-mindmap`. Include:

- affected version and DSH version;
- reproduction steps or a minimal proof of concept;
- expected impact;
- suggested remediation, if available.

If private reporting is unavailable, contact the repository owner privately before disclosing details. Please allow a reasonable remediation window before public disclosure.

## Security model

- The plugin edits plain markdown files inside the DSH working directory only; it refuses all file access when that working directory is unavailable.
- Native approval is enabled by default with a session/document grant: the first ordinary write asks once, then later updates to the same document in that session reuse the grant. `approvalMode` supports `per-operation`, `session` (default), and `off` (ordinary confirmations only). Only an explicit `danger-full-access` result from the host's live session file policy skips all plugin write confirmations, including root renames, clearing content, and broad rewrites; upstream approval decisions and all file validation still apply. Full access creates no reusable document grant and switching back restores the configured confirmation behavior. Without full file access, high-risk writes remain approval-gated even with `requireApproval: false` or `approvalMode: off`. Disabled approval prompts, missing policy APIs, failed policy resolution, and unknown modes never grant full file access.
- Document paths are resolved and contained within the working directory before any write.
- Operators remain responsible for file permissions, network routing, and model-provider data policy.

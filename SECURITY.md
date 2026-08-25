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

- The plugin edits plain markdown files inside the DSH working directory only; it never writes outside the allowed workspace.
- Every tool call that writes or deletes a file enters DSH's native approval flow and fails closed when approval is unavailable.
- Document paths are resolved and contained within the working directory before any write.
- Operators remain responsible for file permissions, network routing, and model-provider data policy.

# Security policy

Prowl holds a GitHub token in your browser, so we take reports seriously.

## Reporting a vulnerability

Please report privately through GitHub: **Security → Report a vulnerability** on
[aemard/prowl](https://github.com/aemard/prowl/security/advisories/new). Do not open a public
issue. Include steps to reproduce and the version (`chrome://extensions` shows it).

You should get an answer within 7 days. Fixes ship in a patch release with a GitHub security
advisory crediting you, unless you prefer otherwise.

## Supported versions

Only the latest release receives security fixes.

## Scope

In scope: the extension (`src/`), its build and release workflows, and the website. The design
and its known residual risks are in [docs/security/threat-model.md](docs/security/threat-model.md).

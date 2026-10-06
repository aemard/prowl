# Prowl

Minimalist Chrome side panel to follow your GitHub pull requests at a glance: live CI,
review and merge state, notifications when something changes, and one-click actions
(approve, merge, re-run checks...) without leaving your tab.

100% client-side. No backend, no telemetry. The only remote host is GitHub.

> Status: under active development towards v1.0.0. See [`prd.json`](prd.json) and
> [`progress.txt`](progress.txt).

## Development

```sh
pnpm install
pnpm verify      # lint, types, unit + coverage, build, size budget, E2E
pnpm build       # production build in dist/
```

Load `dist/` via `chrome://extensions` → Developer mode → Load unpacked.

## License

[MIT](LICENSE)

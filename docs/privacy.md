# Privacy

Prowl is a browser extension that runs on your device. It has no backend and collects no data.

## What stays on your device

Your GitHub token, your settings and the last pull request data Prowl fetched are stored in the
browser's extension storage (`chrome.storage.local`). The token is sent only to GitHub, to
authenticate its API requests. Settings and pull request data are not sent anywhere. Signing out
removes the token and the fetched data; uninstalling Prowl removes everything.

## Who Prowl talks to

Only GitHub: the GitHub API, with your token, to read and act on your pull requests, `github.com`
for the sign-in with GitHub flow, and GitHub's avatar images. There are no analytics, no
telemetry, no ads and no other servers.

## Questions

Prowl is open source. Read the code or open an issue in this repository. The same text is on the
website's privacy page.

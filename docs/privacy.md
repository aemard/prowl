# Privacy

*Last updated 6 October 2026.*

Prowl is a browser extension that runs on your device. It has no server of its own, no account
and no analytics. The only service it talks to is GitHub.

## What stays on your device

Prowl keeps its data in the extension storage of your browser profile (`chrome.storage.local`),
which Chrome does not sync to other devices. Prowl does not encrypt it, so anyone who can read
your browser profile can read your token.

- **Account:** your GitHub token, its type and scopes, and your login, name and avatar address.
  Removed when you sign out.
- **Pull requests:** the pull requests last fetched, with title, author, labels, branches, CI,
  review and merge state. Removed when you sign out.
- **Poll state:** when Prowl last polled, and any error or rate-limit wait. Removed when you
  sign out.
- **Notification record:** the ids of events already reported, in `chrome.storage.session`.
  Removed when you sign out or Chrome closes.
- **Settings:** your sections and search queries, repository filters, poll interval,
  notification choices and quiet hours. Removed when you uninstall Prowl.
- **Local choices:** which pull requests you snoozed, muted or have seen, by pull request id.
  Removed when you uninstall Prowl.

Nothing is stored anywhere else, and none of it is sent to the Prowl project.

## Who Prowl talks to

- **`api.github.com`:** on every poll, and when you act on a pull request. Prowl sends your token
  in the `Authorization` header and the search queries built from your settings. An action you
  start, such as approving, is sent as you.
- **`github.com`:** only when you choose "Continue with GitHub". Prowl sends the OAuth App's public
  client id and the one-time device code, to get a token. Chrome asks you to allow this host
  first, and you can say no.
- **`avatars.githubusercontent.com`:** when the panel shows a picture. It is a plain image
  request, with no token.

Your token only ever goes to `api.github.com`. When you open a pull request, Prowl opens its
`github.com` page in a normal browser tab, and it opens nothing that is not on GitHub.

Prowl's content security policy lets its pages run scripts from the extension itself only, and
connect to `api.github.com` and `github.com` only. It cannot load code from, or send data to,
anywhere else. What GitHub does with the requests it receives is covered by the
[GitHub General Privacy Statement](https://docs.github.com/site-policy/privacy-policies/github-general-privacy-statement).

## What Prowl never does

- No analytics, telemetry, crash reports, advertising or tracking.
- No reading of the pages you browse: Prowl has no content scripts and no access to other sites.
- No selling or sharing of data. Prowl has no server that could receive it.
- No remote code. Everything it runs ships inside the extension.

## Permissions

| Permission | Why |
|---|---|
| `sidePanel` | Show Prowl in the browser side panel |
| `storage` | Keep your settings and the data above on your device |
| `alarms` | Check GitHub on a schedule, even when the panel is closed |
| `notifications` | Tell you when a pull request changes. Chrome shows them on your device. |
| `api.github.com` | Read your pull requests and act on them |
| `github.com` (optional) | Asked for only when you use "Continue with GitHub" |

## Your choices

- **Sign out** from the account menu in the panel. It deletes your token and the fetched data
  from your browser. It does not revoke the token at GitHub.
- **Revoke access at GitHub.** For "Continue with GitHub", remove Prowl under Settings,
  Applications, Authorized OAuth Apps. For a token you pasted, delete it under Settings,
  Developer settings, Personal access tokens.
- **Uninstall** Prowl on `chrome://extensions`. Chrome deletes everything Prowl stored.

## This website

The website is static. It sets no cookies, runs no scripts, uses system fonts and loads nothing
from other sites. It is hosted on GitHub Pages, which may keep server logs under GitHub's own
privacy statement.

## Changes and questions

Prowl is open source, so every change to this page is in the repository's history. Questions,
and corrections if something here does not match what Prowl does, are welcome as an
[issue on GitHub](https://github.com/aemard/prowl/issues).

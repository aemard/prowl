# Privacy

*Last updated 7 October 2026.*

Prowl is a browser extension that runs on your device. It has no server of its own, no account
and no analytics. The only service it talks to is GitHub.

**Prowl cannot see or change the pages you visit: it has no access to your tabs or their
content.** Chrome enforces that, not a promise: see [Permissions](#permissions).

## What stays on your device

Prowl keeps its data in the extension storage of your browser profile (`chrome.storage.local`),
which Chrome does not sync to other devices. Prowl does not encrypt it, so anyone who can read
your browser profile can read your token.

- **Account:** your GitHub token, its type and scopes, and your login, name and avatar address.
  Removed when you sign out.
- **Pull requests:** the pull requests last fetched, with title, author, labels, branches, CI,
  review and merge state. Removed when you sign out.
- **Teams:** the organizations and names of the GitHub teams you belong to, for Team reviews.
  Removed when you sign out.
- **Poll state:** when Prowl last polled, and any error or rate-limit wait. Removed when you
  sign out.
- **Notification record:** the ids of events already reported, in `chrome.storage.session`.
  Removed when you sign out or Chrome closes.
- **Settings:** your sections and search queries, the teams you unfollowed, repository filters, poll interval,
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
- No reading or changing of the pages you browse: Prowl has no content scripts and no access to
  other sites or to your tabs ([Permissions](#permissions)).
- No selling or sharing of data. Prowl has no server that could receive it.
- No remote code. Everything it runs ships inside the extension.

## Permissions

An extension can only touch a page if its manifest asks Chrome for that. Prowl's manifest asks for
the six things below and nothing else, so Chrome gives it no way to read or change the pages you
visit. The build fails if the manifest gains any other permission, site or capability, and a
second test checks the same on the built extension loaded in Chrome. To see the live list, open
**Privacy and permissions** in Prowl's Settings, or `chrome://extensions`, Prowl, Details.

| Permission | What it allows | What Chrome's install prompt shows |
|---|---|---|
| `sidePanel` | Show Prowl in the browser's side panel | Nothing |
| `storage` | Keep your settings and the data above on your device | Nothing |
| `alarms` | Wake Prowl on a schedule to check GitHub, even when the panel is closed | Nothing |
| `notifications` | Tell you when a pull request changes. Chrome shows them on your device. | "Display notifications" |
| `api.github.com` | Send requests to GitHub's API with your token, to read your pull requests and act on them | "Read and change your data on api.github.com" |
| `github.com` (optional) | Send the sign-in requests of "Continue with GitHub" | Nothing at install. Chrome asks when you choose "Continue with GitHub"; Prowl gives it back when the sign-in ends, and when you sign out. |

Chrome's sentence for site access is the same for every site: "Read and change your data on
api.github.com" does not mean your browsing. api.github.com answers programs with data, not web
pages, and a site permission cannot run code in a page without the `scripting` permission or a
declared content script, which Prowl does not have.

### What Prowl can never do

Prowl has none of the permissions that would let it, and the lock above keeps it that way.
It cannot:

- **Read, inject code into or change any web page.** No content scripts, no `scripting` and no
  `activeTab` permission, and no access to any site but GitHub's.
- **See which sites you visit or list your tabs.** No `tabs`, `history` or `webNavigation`
  permission.
- **Watch, block or rewrite the requests of other sites.** No `webRequest` or
  `declarativeNetRequest` permission.
- **Read your cookies or passwords.** No `cookies` permission and no access to the sites that
  set them.
- **Be driven by a web page or another extension.** The manifest has no `externally_connectable`,
  and Prowl ignores messages from any sender but itself.
- **Run code that did not ship with it.** The content security policy allows scripts from the
  extension only.

### The one thing a site permission still shows

Chrome lets an extension with access to a site read the address and title of that site's own
tabs. For Prowl that could only be a tab showing api.github.com, or github.com while you sign in.
Prowl never asks: its code only opens new tabs, and a test fails if it calls anything else on
`chrome.tabs`.

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

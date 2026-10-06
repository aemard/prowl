# Signing in to Prowl

Prowl talks to GitHub with a token that stays in your browser (`chrome.storage.local`) and is
only ever sent to GitHub. There are two ways to get one. Both end the same way: Prowl checks the
token, shows who you are and starts following your pull requests.

## Sign in with GitHub (recommended)

Choose **Continue with GitHub** in the side panel.

1. Chrome asks to let Prowl access `github.com`. Prowl needs it to ask GitHub for a code and to
   learn that you approved it. Nothing else on `github.com` is read. If you decline, Prowl says
   so and you can still use a token.
2. Prowl shows a code such as `WDJB-MJHT` and opens `github.com/login/device`. Type the code
   there and approve **Prowl** for the `repo` scope.
3. Prowl notices the approval within a few seconds and signs you in. The code is valid for 15
   minutes; the panel counts down. Cancel any time, or start again after it expired.

The sign-in only runs while the side panel is open. The `repo` scope is what GitHub requires to
read private repositories and to approve, merge and re-run checks.

To stop Prowl's access, revoke it under GitHub, Settings, Applications, Authorized OAuth Apps.
Signing out of Prowl removes the token from your browser but does not revoke it at GitHub.

### Not available in this build

Browser sign-in needs an OAuth App client id compiled into the extension. Builds without one (a
fork, a local build) show "Signing in from the browser is not available in this build" and a
link here. Use a token instead (below), or make your own client id:

1. On GitHub, Settings, Developer settings, OAuth Apps, **New OAuth App** (the callback URL is
   unused; any URL works).
2. Tick **Enable Device Flow** on the app's page.
3. Build with `PROWL_GITHUB_CLIENT_ID=<your client id> pnpm build`. The id is public; Prowl
   never uses a client secret.

## Sign in with a personal access token

Paste a token into the field on the same screen. The panel links to GitHub's token pages with
the form filled in.

| | Classic (recommended) | Fine-grained |
|---|---|---|
| Needs | `repo` | Pull requests, Contents and Actions (read and write), Commit statuses (read) |
| Sees | Every repository you can access | One account or organization and the repositories you pick |
| CI status | Yes | Can be missing: GitHub has no Checks permission for fine-grained tokens |

A classic token without `repo` still signs in but only sees public repositories, and Prowl
warns you.

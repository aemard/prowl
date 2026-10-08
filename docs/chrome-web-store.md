# Chrome Web Store

Every release goes to the Chrome Web Store on its own:

1. Merging the release pull request tags `vX.Y.Z`, creates the GitHub release and attaches the
   signed zip (`release-please.yml` → `release-assets.yml`; `release-tag.yml` for a hand-pushed tag).
2. `.github/workflows/chrome-web-store.yml` then runs in the `chrome-web-store` environment, which
   only `main` and `v*` tags may deploy to.
3. It downloads that exact zip (never a fresh build), checks its provenance
   attestation, gets a 15-minute Google token through Workload Identity Federation (no key is
   stored in GitHub) and runs `scripts/cws-publish.mjs`, which uploads the zip with the Chrome Web
   Store API v2 and submits it for review. Google's review publishes it, usually within a few days.

To publish an existing release again (for example after fixing the setup): **Actions → Chrome Web
Store → Run workflow**, with the tag. The store only takes a version higher than the one it has.

The job is skipped until the repository variable `CWS_ITEM_ID` exists, so releases keep working
before the store is set up. It uses API v2: v1 stops on 15 October 2026. The API only uploads and
submits packages; the listing text, images and privacy answers are edited in the dashboard.

## Listing text

**Summary** (132 characters at most): Follow your GitHub pull requests in the side panel: CI,
reviews, merge state, notifications and actions. No backend.

**Description**:

> Prowl follows your GitHub pull requests from Chrome's side panel.
>
> - See CI, reviews, conflicts and merge readiness on every card, for what you opened, what asks
>   for your review or your teams' review, where you are mentioned, or any GitHub search.
> - Get notified when CI fails or passes, a review arrives, or a PR is ready, merged or closed;
>   open or snooze it from the notification. Quiet hours and a toolbar badge.
> - Approve, request changes, comment, merge, turn on auto-merge, update a branch that is
>   behind, re-run failed checks, all without leaving your tab. Ctrl+Shift+P (⌘⇧P on Mac) opens the panel.
> - Hide stale, draft and bot PRs, and group them by repository.
>
> Private by design: no backend and no telemetry. Your token stays on your device, GitHub is the
> only server Prowl talks to, and it cannot read or change the pages you visit. Settings can
> sync through your Chrome profile if you turn it on; the token never does.

## One-time setup

### 1. Create the item by hand

The API cannot create items, so the first version is uploaded in the
[Developer Dashboard](https://chrome.google.com/webstore/devconsole).

1. Use a release with the current design (the first one after the mint logo, v1.1.0 or later).
   If you want "Continue with GitHub", set `PROWL_GITHUB_CLIENT_ID` (see `docs/releasing.md`)
   **before** that release: without it the store build only offers token sign-in, and
   screenshot 5 shows the GitHub sign-in flow.
2. Download `prowl-vX.Y.Z.zip` from the release, then **Items → New item** and upload it.
3. **Store listing**
   - Category: Developer Tools. Language: English.
   - The one-line summary comes from the manifest's `description`. Description, for example:
     "Prowl keeps your GitHub pull requests in Chrome's side panel: CI, reviews and merge state
     at a glance, notifications when something changes, and approve, comment, re-run or merge
     without leaving the page. No server, no tracking: your token stays in the browser."
   - Icon: `public/icons/icon-128.png`. Screenshots: `docs/store/screenshot-1-list.png` to
     `screenshot-5-sign-in.png`. Small promo tile: `docs/store/promo-small.png`. Marquee:
     `docs/store/promo-marquee.png`. `pnpm store-images` rebuilds them from `docs/screenshots/`
     (run `pnpm screenshots` first when the UI changed).
   - Homepage: <https://aemard.github.io/prowl/>. Support: <https://github.com/aemard/prowl/issues>.
4. **Privacy**
   - Single purpose: "Show the user's GitHub pull requests and their status in the side panel,
     notify about changes and let the user act on them."
   - Permission justifications (paste each in its dashboard field; they match the
     [privacy policy](privacy.md#permissions), and `tests/unit/siteAccess.test.ts` fails if the
     manifest asks for anything that is not in this table):

     | Permission | Justification | Install prompt |
     |---|---|---|
     | `sidePanel` | Prowl's whole interface is the browser side panel. | Nothing |
     | `storage` | Keeps the user's settings and the pull requests last fetched on their device. | Nothing |
     | `alarms` | Checks GitHub on a schedule while the panel is closed. | Nothing |
     | `notifications` | Tells the user when a pull request changes. | "Display notifications" |
     | host `api.github.com` | Reads the user's pull requests and acts on them, with the user's own token. It serves data, not pages. | "Read and change your data on api.github.com" |
     | optional host `github.com` | Asked for only when the user chooses "Continue with GitHub", for the OAuth device flow; given back afterwards. | Nothing at install |

     Say it plainly in the single-purpose and justification fields: Prowl has no content scripts,
     no `tabs`, `activeTab` or `scripting` permission and no site access beyond GitHub, so it
     cannot read or change the pages the user visits.
   - Remote code: no. Data usage: Prowl collects no user data (the token and pull requests stay
     on the device and are sent only to GitHub), then confirm the data-use certifications.
   - Privacy policy: <https://aemard.github.io/prowl/privacy/>.
5. **Distribution**: Public (or Unlisted to try it first), all regions.
6. **Submit for review.** Note the **item ID** (the 32 letters in the item's URL) and the
   **publisher ID** (dashboard **Publisher → Settings**).

### 2. Let GitHub Actions act for a Google service account

In [Cloud Shell](https://shell.cloud.google.com) or any shell with `gcloud`, in a Google Cloud
project you own:

```sh
PROJECT_ID=your-project-id
PROJECT_NUMBER=$(gcloud projects describe "$PROJECT_ID" --format='value(projectNumber)')
SA="prowl-publisher@$PROJECT_ID.iam.gserviceaccount.com"

gcloud services enable chromewebstore.googleapis.com iamcredentials.googleapis.com \
  sts.googleapis.com --project "$PROJECT_ID"

gcloud iam service-accounts create prowl-publisher --project "$PROJECT_ID" \
  --display-name "Prowl Chrome Web Store publisher"

gcloud iam workload-identity-pools create github --project "$PROJECT_ID" --location global \
  --display-name "GitHub Actions"

# Only jobs of this repository (by id, so a re-created repo with the same name does not match)
# running in the chrome-web-store environment, which only main and v* tags reach, get tokens.
gcloud iam workload-identity-pools providers create-oidc prowl --project "$PROJECT_ID" \
  --location global --workload-identity-pool github --display-name "aemard/prowl" \
  --issuer-uri https://token.actions.githubusercontent.com \
  --attribute-mapping "google.subject=assertion.sub,attribute.repository_id=assertion.repository_id,attribute.environment=assertion.environment" \
  --attribute-condition "assertion.repository_id == '1407192134' && assertion.environment == 'chrome-web-store'"

gcloud iam service-accounts add-iam-policy-binding "$SA" --project "$PROJECT_ID" \
  --role roles/iam.workloadIdentityUser \
  --member "principalSet://iam.googleapis.com/projects/$PROJECT_NUMBER/locations/global/workloadIdentityPools/github/attribute.repository_id/1407192134"

echo "CWS_SERVICE_ACCOUNT=$SA"
echo "CWS_WORKLOAD_IDENTITY_PROVIDER=projects/$PROJECT_NUMBER/locations/global/workloadIdentityPools/github/providers/prowl"
```

The service account needs no IAM role: the store decides what it may do (next step).

### 3. Give the service account access to the store

Developer Dashboard → **Account** → service account: add the `prowl-publisher@...` email. A
publisher can have one service account.

### 4. GitHub environment and variables

1. **Settings → Environments → New environment** `chrome-web-store`:
   - **Required reviewers**: none. Releases are reviewed as pull requests on `main`; add yourself
     here to approve each store submission by hand instead.
   - **Deployment branches and tags**: Selected, add the branch `main` and the tag pattern `v*`
     (release-please runs on `main`, a hand-pushed tag runs on the tag).
2. **Settings → Secrets and variables → Actions → Variables**, repository variables (none of them
   is a secret):

   | Variable | Value |
   |---|---|
   | `CWS_ITEM_ID` | The item ID from step 1. Turns the store job on. |
   | `CWS_PUBLISHER_ID` | The publisher ID from step 1 |
   | `CWS_SERVICE_ACCOUNT` | Printed by step 2 |
   | `CWS_WORKLOAD_IDENTITY_PROVIDER` | Printed by step 2 |

The next release is then submitted on its own.

## When it fails

The job log has the store's answer.

- **`Permission 'iam.serviceAccounts.getAccessToken' denied`** or an STS error: the provider's
  condition did not match (environment name, repository ID) or the `workloadIdentityUser`
  binding is missing.
- **403 on upload**: the service account is not added in the dashboard, or the publisher ID is
  wrong.
- **400 on upload about the version**: the zip's version is not higher than the store's.
- **Publish refused while a review is pending**: wait for the review, or cancel the pending
  submission in the dashboard, then run the workflow again for the tag.
- **`gh attestation verify` fails**: the zip on the release was not built by
  `release-assets.yml`. Do not publish it; rebuild the release assets.

# Chrome Web Store

Every release goes to the Chrome Web Store once a maintainer approves it:

1. Merging the release pull request tags `vX.Y.Z`, creates the GitHub release and attaches the
   signed zip (`release-please.yml` → `release-assets.yml`; `release-tag.yml` for a hand-pushed tag).
2. `.github/workflows/chrome-web-store.yml` then waits for approval in the `chrome-web-store`
   environment (Actions shows "Review deployments").
3. Once approved, it downloads that exact zip (never a fresh build), checks its provenance
   attestation, gets a 15-minute Google token through Workload Identity Federation (no key is
   stored in GitHub) and runs `scripts/cws-publish.mjs`, which uploads the zip with the Chrome Web
   Store API v2 and submits it for review. Google's review publishes it, usually within a few days.

To publish an existing release again (for example after fixing the setup): **Actions → Chrome Web
Store → Run workflow**, with the tag. The store only takes a version higher than the one it has.

The job is skipped until the repository variable `CWS_ITEM_ID` exists, so releases keep working
before the store is set up. It uses API v2: v1 stops on 15 October 2026. The API only uploads and
submits packages; the listing text, images and privacy answers are edited in the dashboard.

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
   - Permission justifications, as in the [privacy policy](privacy.md#permissions): `sidePanel`
     shows Prowl in the side panel; `storage` keeps settings and fetched data on the device;
     `alarms` checks GitHub on a schedule; `notifications` tells you when a pull request changes;
     host `api.github.com` reads and acts on your pull requests; optional host `github.com` is
     asked for only for "Continue with GitHub".
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
# running in the chrome-web-store environment, which needs your approval, get tokens.
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
   - **Required reviewers**: yourself. This is the approval gate.
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

The next release then stops at "Review deployments"; approve it and the job submits it.

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

# O.A. Investments — GitHub Pages Dashboard

A one-page portfolio dashboard that rebuilds itself every morning and is hosted
**free forever** on GitHub Pages. Anyone with the link can open it — no login.

## How it works

- A GitHub Action runs three times a day — 9am, noon and 3pm Central — pulls your Vanguard
  business account through Plaid (**read-only** — it can never move money),
  appends the new value to `data/history.json`, rebuilds the page, and publishes it.
- Your Plaid credentials live in GitHub's secret storage. They are never in the
  page or the code.
- The growth chart starts with 13 months of real history (Sep 2025 – Sep 2026,
  from your Vanguard statements) and grows one point per day.

## Setup (one time, ~20 minutes)

### Step 1 — Free Plaid developer account

1. Sign up at [plaid.com](https://plaid.com) (free Trial plan — free indefinitely
   for up to 10 linked accounts; you need 1).
2. In the Plaid dashboard go to **Keys** and copy your **Client ID** and **Secret**.
   Keep them private.

### Step 2 — Connect the Vanguard account (on your own computer)

You need Node.js 20+ installed ([nodejs.org](https://nodejs.org), one-time install).

1. Download this project folder to your computer and open a terminal in it.
2. Run `npm install`, then:
   ```
   PLAID_CLIENT_ID=... PLAID_SECRET=... node scripts/get-token-local.js
   ```
   (Or run it without the variables and type them when asked.)
3. Open **http://localhost:3000**, click **Connect Vanguard**, and log in to the
   Vanguard business account.
4. The terminal prints your **PLAID_ACCESS_TOKEN**. Copy it — this is the only
   time you'll see it.

### Step 3 — Put the project on GitHub

1. Create a new **public** repository (public = free Pages hosting).
2. Upload everything in this folder **except** `node_modules` and `dist`
   (GitHub's web UI: *Add file → Upload files* works fine).

### Step 4 — Add the secrets

In the repo: **Settings → Secrets and variables → Actions → New repository secret**.
Add these four:

| Secret | Value |
|---|---|
| `PLAID_CLIENT_ID` | from Step 1 |
| `PLAID_SECRET` | from Step 1 |
| `PLAID_ACCESS_TOKEN` | from Step 2 |
| `PLAID_ENV` | `production` |

### Step 5 — Turn on Pages and run it once

1. **Settings → Pages → Source**: choose **GitHub Actions**.
2. **Actions tab → "Daily portfolio refresh" → Run workflow** (runs it immediately
   so you don't wait for tomorrow morning).
3. After a minute or two, your link appears under **Settings → Pages** — it looks
   like `https://YOURNAME.github.io/REPO-NAME/`. Open it on your phone and use
   **Share → Add to Home Screen** for the app feel.

## Day to day

- **Auto-refresh** — the page updates itself three times a day.
- **Manual refresh** — Actions tab → Run workflow, any time.
- **History** — the chart gains one point per day, holding that day's latest value.
- **Appearance** — the page follows your device's light/dark setting automatically.

### Net deposits: `data/deposits.json` (automatic)

`history.json` records what the portfolio is *worth*, not money moving in or
out, so net deposits are tracked separately in `data/deposits.json`:

- **`base`** — the total deposited through `base_through` (Sep 29, 2026, per
  Vanguard statements). Plaid only shows Vanguard transactions from Aug 2026
  onward, so this fixed historical figure covers what it cannot see. It never
  changes.
- **`ledger`** — every deposit or withdrawal after that, added automatically
  on each run from Plaid's transactions. Vanguard's internal sweeps into and
  out of its VMFXX settlement fund ("Sweep in" / "Sweep out") are recognised
  and left out, since they are not money entering or leaving the account.
  Every transaction Plaid still shows is re-checked on each run, so a wrong
  entry corrects itself. Each run's log lists every cash flow and whether it
  was counted.

Net invested = base + ledger. **Total gains** and **Return** are derived from
it against the current value. You should not need to edit this file.

## Honest limits

- Data comes from Plaid and can lag Vanguard by minutes to hours.
- GitHub's scheduler is approximate, so a run can drift by up to an hour.
  The workflow lists six UTC times and admits only the three that are
  9am, noon or 3pm in Chicago; the gate judges the cron that fired rather
  than the current clock, so a delayed firing still runs instead of being
  skipped. The local hours stay correct through daylight saving changes
  without any edit.
- The page shows real dollar amounts to anyone with the link. That is the design;
  don't share the link beyond people you'd show the numbers to.
- If Plaid ever needs you to re-link the account (password change, etc.), repeat
  Step 2 and update the `PLAID_ACCESS_TOKEN` secret.

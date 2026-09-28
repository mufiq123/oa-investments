# O.A. Investments — GitHub Pages Dashboard

A one-page portfolio dashboard that rebuilds itself every morning and is hosted
**free forever** on GitHub Pages. Anyone with the link can open it — no login.

## How it works

- A GitHub Action wakes up daily at noon Central, pulls your Vanguard
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

- **Auto-refresh** — every morning the page updates itself with the new value.
- **Manual refresh** — Actions tab → Run workflow, any time.
- **History** — the chart gains one point per day from here on.
- **Appearance** — the page follows your device's light/dark setting automatically.

### The one number you maintain: `data/deposits.json`

`history.json` records what the portfolio is *worth*, not money moving in or out,
so net deposits cannot be derived from it — a jump from $9,183 to $12,539 could
be a deposit or a good month, and the data can't tell the difference.

So `data/deposits.json` holds that single figure:

```json
{ "net_deposits": 25910, "note": "per Vanguard" }
```

Edit it whenever you add or withdraw money (withdrawals lower it). **Investment
gains** and **gain on deposits** are then computed from it against the current
value, so they stay correct on their own as the portfolio moves. Gains show in
gold when positive and red when negative. If the file is missing or the number
isn't a positive number, the three stats are hidden rather than shown wrong. The
daily workflow never touches this file.

## Honest limits

- Data comes from Plaid and can lag Vanguard by minutes to hours.
- GitHub's scheduler is approximate — noon can drift by up to an hour or so.
  The workflow schedules two UTC times and skips the one that isn't noon locally,
  so the hour stays right through daylight saving changes.
- The page shows real dollar amounts to anyone with the link. That is the design;
  don't share the link beyond people you'd show the numbers to.
- If Plaid ever needs you to re-link the account (password change, etc.), repeat
  Step 2 and update the `PLAID_ACCESS_TOKEN` secret.

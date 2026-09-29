// scripts/fetch.js
// Pulls current holdings from Plaid (read-only) and appends today's snapshot
// to data/history.json. Credentials come from environment variables (GitHub
// Actions secrets in production). Never commit real credentials.
import { Configuration, PlaidApi, PlaidEnvironments } from 'plaid';
import { readFileSync, writeFileSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');

const {
  PLAID_CLIENT_ID,
  PLAID_SECRET,
  PLAID_ACCESS_TOKEN,
  PLAID_ENV = 'production',
} = process.env;

if (!PLAID_CLIENT_ID || !PLAID_SECRET || !PLAID_ACCESS_TOKEN) {
  console.error('Missing one of PLAID_CLIENT_ID, PLAID_SECRET, PLAID_ACCESS_TOKEN.');
  process.exit(1);
}

const envMap = {
  sandbox: PlaidEnvironments.sandbox,
  development: PlaidEnvironments.development,
  production: PlaidEnvironments.production,
};
const basePath = envMap[PLAID_ENV];
if (!basePath) {
  console.error(`Unknown PLAID_ENV "${PLAID_ENV}". Use sandbox, development, or production.`);
  process.exit(1);
}

const plaid = new PlaidApi(
  new Configuration({
    basePath,
    baseOptions: {
      headers: { 'PLAID-CLIENT-ID': PLAID_CLIENT_ID, 'PLAID-SECRET': PLAID_SECRET },
    },
  })
);

const round2 = (n) => Math.round((n + Number.EPSILON) * 100) / 100;

// Snapshot date in America/Chicago, so the daily point lands on the right day.
function chicagoDate() {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: 'America/Chicago',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(new Date());
}

// Ask Plaid to pull straight from Vanguard before we read holdings. Without
// this, /investments/holdings/get returns whatever Plaid last cached, which is
// refreshed on its own once-a-day cadence and may predate this morning's run.
// /investments/refresh is asynchronous — it returns immediately and the new
// data lands shortly after — so we give it a grace period before reading.
// Bundled free on Plaid's Trial plan; metered per call on paid plans, so set
// PLAID_REFRESH=false to turn it off if this account ever moves to one.
const REFRESH = (process.env.PLAID_REFRESH ?? 'true') !== 'false';
const REFRESH_WAIT_MS = Number(process.env.PLAID_REFRESH_WAIT_MS ?? 30000);

if (REFRESH) {
  try {
    await plaid.investmentsRefresh({ access_token: PLAID_ACCESS_TOKEN });
    console.log(`Requested a fresh pull from Vanguard; waiting ${REFRESH_WAIT_MS / 1000}s for it to land.`);
    await new Promise((resolve) => setTimeout(resolve, REFRESH_WAIT_MS));
  } catch (err) {
    // A refresh that fails is not fatal: we simply read Plaid's cached
    // holdings instead, which is exactly the old behaviour.
    const code = err?.response?.data?.error_code || err?.message || String(err);
    console.warn(`Refresh request failed (${code}) — falling back to Plaid's cached holdings.`);
  }
} else {
  console.log('PLAID_REFRESH=false — reading cached holdings without an on-demand refresh.');
}

const resp = await plaid.investmentsHoldingsGet({ access_token: PLAID_ACCESS_TOKEN });
const { holdings = [], securities = [] } = resp.data;
const secById = Object.fromEntries(securities.map((s) => [s.security_id, s]));

const positions = holdings
  .map((h) => {
    const sec = secById[h.security_id] || {};
    const value = round2(h.institution_value ?? (h.quantity ?? 0) * (h.institution_price ?? 0));
    return {
      ticker: sec.ticker_symbol || '—',
      name: sec.name || 'Unknown holding',
      value,
      quantity: h.quantity ?? null,
      price: h.institution_price ?? null,
    };
  })
  .filter((p) => p.value > 0)
  .sort((a, b) => b.value - a.value);

if (positions.length === 0) {
  console.error('Plaid returned no holdings — aborting so we never publish an empty page.');
  process.exit(1);
}

// Plaid refreshes investments roughly once a day, after market close, so the
// prices here can lag the live market by a session or more. Log how old they
// actually are, which is the difference between "the pipeline is broken" and
// "the upstream feed has not published yet".
const priceDates = [...new Set(holdings.map((h) => h.institution_price_as_of).filter(Boolean))].sort();
console.log(
  priceDates.length
    ? `Plaid prices are as of ${priceDates.join(', ')}.`
    : 'Plaid did not report institution_price_as_of for these holdings.'
);

const total = round2(positions.reduce((s, p) => s + p.value, 0));
const today = chicagoDate();

writeFileSync(
  join(root, 'data', 'latest.json'),
  JSON.stringify({ date: today, total, positions }, null, 2)
);

// ---- net deposits ledger ----
// Vanguard exposes only about three months of transactions through Plaid, so
// deposits.json carries a one-time `base` for the history Plaid cannot see plus
// a ledger of everything since. Entries are keyed by Plaid's transaction id, so
// a deposit that later ages out of Plaid's window is neither dropped nor
// counted twice. `base_through` guards the seam: anything dated on or before it
// is already inside `base` and must not be added again.
const CASH_IN = new Set(['deposit', 'contribution']);
const CASH_OUT = new Set(['withdrawal']);
const depPath = join(root, 'data', 'deposits.json');

try {
  const dep = JSON.parse(readFileSync(depPath, 'utf8'));
  if (!Number.isFinite(dep.base)) throw new Error('deposits.json has no numeric base');

  const day = 86400000;
  const isoDay = (ms) => new Date(ms).toISOString().slice(0, 10);
  let txns = [];
  for (let offset = 0; ; ) {
    const r = await plaid.investmentsTransactionsGet({
      access_token: PLAID_ACCESS_TOKEN,
      start_date: isoDay(Date.now() - 120 * day),
      end_date: isoDay(Date.now() + day),
      options: { count: 500, offset },
    });
    const batch = r.data.investment_transactions || [];
    txns = txns.concat(batch);
    if (!batch.length || txns.length >= (r.data.total_investment_transactions ?? txns.length)) break;
    offset = txns.length;
  }

  dep.ledger = Array.isArray(dep.ledger) ? dep.ledger : [];
  const seen = new Set(dep.ledger.map((e) => e.id));
  const cutoff = dep.base_through || '0000-00-00';
  let added = 0;

  for (const tx of txns) {
    if ((tx.type || '') !== 'cash') continue;
    const sub = (tx.subtype || '').toLowerCase();
    if (!CASH_IN.has(sub) && !CASH_OUT.has(sub)) continue; // dividends are income, not deposits
    if (tx.date <= cutoff) continue;                       // already inside base
    if (seen.has(tx.investment_transaction_id)) continue;
    // Plaid signs amount negative when cash enters the account, so negate it.
    dep.ledger.push({ id: tx.investment_transaction_id, date: tx.date, amount: round2(-(tx.amount || 0)) });
    seen.add(tx.investment_transaction_id);
    added += 1;
  }

  if (added) {
    dep.ledger.sort((a, b) => (a.date < b.date ? -1 : 1));
    writeFileSync(depPath, JSON.stringify(dep, null, 2));
  }
  const ledgerSum = round2(dep.ledger.reduce((sum, e) => sum + (Number(e.amount) || 0), 0));
  console.log(
    `Net deposits: base $${dep.base.toLocaleString('en-US')} + ledger $${ledgerSum.toLocaleString('en-US')}` +
      ` = $${round2(dep.base + ledgerSum).toLocaleString('en-US')} (${added} new).`
  );

  // Any cash subtype we do not classify is surfaced rather than silently
  // dropped, so a missed deposit type gets noticed.
  const unknown = [
    ...new Set(
      txns
        .filter((tx) => (tx.type || '') === 'cash')
        .map((tx) => (tx.subtype || '').toLowerCase())
        .filter((sub) => !CASH_IN.has(sub) && !CASH_OUT.has(sub) && sub !== 'dividend')
    ),
  ];
  if (unknown.length) console.warn(`Unclassified cash subtypes: ${unknown.join(', ')}`);
} catch (err) {
  const code = err?.response?.data?.error_code || err.message;
  console.warn(`Could not update the deposits ledger (${code}) — leaving it unchanged.`);
}

const histPath = join(root, 'data', 'history.json');
const history = JSON.parse(readFileSync(histPath, 'utf8'));
// Overwrite today's point rather than keeping only the first reading, so the
// day ends holding its latest value. This also keeps the chart's end label in
// step with the headline total: the page draws that label from the last
// history point but takes the headline from latest.json, and with several runs
// a day those two would otherwise disagree until midnight.
const existing = history.findIndex((p) => p.date === today);
if (existing === -1) {
  history.push({ date: today, value: total });
  history.sort((a, b) => (a.date < b.date ? -1 : 1));
  console.log(`Added today's point (${today}): $${total.toLocaleString('en-US')}`);
} else if (history[existing].value !== total) {
  const was = history[existing].value;
  history[existing].value = total;
  console.log(
    `Updated today's point (${today}): $${was.toLocaleString('en-US')} → $${total.toLocaleString('en-US')}`
  );
} else {
  console.log(`Today's point (${today}) is unchanged at $${total.toLocaleString('en-US')}.`);
}
writeFileSync(histPath, JSON.stringify(history));

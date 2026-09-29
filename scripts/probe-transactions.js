// scripts/probe-transactions.js
//
// TEMPORARY, READ-ONLY diagnostic. Answers one question: can Plaid tell us the
// net deposits for this Vanguard account, so data/deposits.json no longer has
// to be maintained by hand?
//
// Writes nothing and changes nothing. It prints aggregates only — counts and
// sums grouped by transaction type — never individual transactions, because
// this repository is public and so are its Actions logs.
import { Configuration, PlaidApi, PlaidEnvironments } from 'plaid';
import { readFileSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const { PLAID_CLIENT_ID, PLAID_SECRET, PLAID_ACCESS_TOKEN, PLAID_ENV = 'production' } = process.env;

if (!PLAID_CLIENT_ID || !PLAID_SECRET || !PLAID_ACCESS_TOKEN) {
  console.error('Missing Plaid credentials.');
  process.exit(1);
}

const plaid = new PlaidApi(
  new Configuration({
    basePath: PlaidEnvironments[PLAID_ENV],
    baseOptions: { headers: { 'PLAID-CLIENT-ID': PLAID_CLIENT_ID, 'PLAID-SECRET': PLAID_SECRET } },
  })
);

const iso = (d) => d.toISOString().slice(0, 10);
const money = (n) => (n < 0 ? '-' : '') + '$' + Math.abs(n).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

// Plaid keeps up to 24 months, measured from when the Item was first linked.
const end = new Date();
const start = new Date(end.getTime() - 730 * 86400000);

console.log(`Window requested: ${iso(start)} to ${iso(end)}\n`);

let all = [];
try {
  let offset = 0;
  for (;;) {
    const resp = await plaid.investmentsTransactionsGet({
      access_token: PLAID_ACCESS_TOKEN,
      start_date: iso(start),
      end_date: iso(end),
      options: { count: 500, offset },
    });
    const batch = resp.data.investment_transactions || [];
    all = all.concat(batch);
    const total = resp.data.total_investment_transactions ?? all.length;
    if (all.length >= total || batch.length === 0) break;
    offset = all.length;
  }
} catch (err) {
  const d = err?.response?.data || {};
  console.error('--- /investments/transactions/get FAILED ---');
  console.error(`error_code:    ${d.error_code || '(none)'}`);
  console.error(`error_type:    ${d.error_type || '(none)'}`);
  console.error(`message:       ${d.error_message || err.message}`);
  console.error('');
  if (d.error_code === 'PRODUCT_NOT_READY') {
    console.error('Plaid is still assembling history for this Item. Re-run in a few minutes.');
  } else if (d.error_code === 'PRODUCTS_NOT_SUPPORTED' || d.error_code === 'NO_INVESTMENT_ACCOUNTS') {
    console.error('This Item cannot serve investment transactions — Option A is not viable.');
  } else if (d.error_code === 'ADDITIONAL_CONSENT_REQUIRED' || d.error_code === 'INSUFFICIENT_CREDENTIALS') {
    console.error('The Item was not linked with this product authorised — Option A would need a re-link.');
  }
  process.exit(2);
}

if (all.length === 0) {
  console.log('Plaid returned ZERO investment transactions.');
  console.log('Vanguard supplies holdings but not transaction history -> Option A is not viable.');
  process.exit(0);
}

const dates = all.map((t) => t.date).sort();
console.log(`Returned ${all.length} transactions, covering ${dates[0]} to ${dates[dates.length - 1]}.\n`);

// Group by type/subtype. Plaid signs amount positive when cash LEAVES the
// account (a purchase) and negative when cash ENTERS it (a sale or deposit),
// so both signs are printed rather than assumed.
const groups = new Map();
for (const t of all) {
  const key = `${t.type || '?'} / ${t.subtype || '?'}`;
  const g = groups.get(key) || { n: 0, sum: 0 };
  g.n += 1;
  g.sum += t.amount || 0;
  groups.set(key, g);
}

console.log('By type / subtype:');
console.log('  ' + 'group'.padEnd(34) + 'count'.padStart(7) + 'sum(amount)'.padStart(16));
for (const [k, g] of [...groups.entries()].sort((a, b) => Math.abs(b[1].sum) - Math.abs(a[1].sum))) {
  console.log('  ' + k.padEnd(34) + String(g.n).padStart(7) + money(g.sum).padStart(16));
}

// Cash moving in or out of the account, which is what "net deposits" means.
// Dividends and reinvestments are income, not deposits, and are excluded.
const CASH_IN = new Set(['contribution', 'deposit', 'transfer', 'transfer in']);
const CASH_OUT = new Set(['withdrawal', 'transfer out', 'distribution']);
let cashIn = 0, cashOut = 0, inN = 0, outN = 0;
for (const t of all) {
  const st = (t.subtype || '').toLowerCase();
  if (CASH_IN.has(st)) { cashIn += Math.abs(t.amount || 0); inN += 1; }
  else if (CASH_OUT.has(st)) { cashOut += Math.abs(t.amount || 0); outN += 1; }
}

let manual = null;
try {
  manual = JSON.parse(readFileSync(join(root, 'data', 'deposits.json'), 'utf8')).net_deposits;
} catch {}

const net = cashIn - cashOut;
console.log('\n--- net deposits, computed ---');
console.log(`  cash in  (${inN} txns): ${money(cashIn)}`);
console.log(`  cash out (${outN} txns): ${money(cashOut)}`);
console.log(`  net:                  ${money(net)}`);
if (manual != null) {
  const diff = net - manual;
  console.log(`  deposits.json says:   ${money(manual)}`);
  console.log(`  difference:           ${money(diff)}`);
  console.log(
    Math.abs(diff) < 1
      ? '\nVERDICT: matches your hand-kept figure — Option A is viable.'
      : '\nVERDICT: does NOT match. Check the group table above for a subtype being counted or missed.'
  );
}

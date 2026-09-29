// TEMPORARY read-only probe. Prints aggregates only (public repo => public logs).
import { Configuration, PlaidApi, PlaidEnvironments } from 'plaid';
const { PLAID_CLIENT_ID, PLAID_SECRET, PLAID_ACCESS_TOKEN, PLAID_ENV = 'production' } = process.env;
const plaid = new PlaidApi(new Configuration({
  basePath: PlaidEnvironments[PLAID_ENV],
  baseOptions: { headers: { 'PLAID-CLIENT-ID': PLAID_CLIENT_ID, 'PLAID-SECRET': PLAID_SECRET } },
}));
const iso = (d) => d.toISOString().slice(0, 10);
const money = (n) => (n < 0 ? '-' : '') + '$' + Math.abs(n).toLocaleString('en-US', { minimumFractionDigits: 2 });
const end = new Date(), start = new Date(Date.now() - 730 * 86400000);

let all = [];
let offset = 0;
for (;;) {
  const r = await plaid.investmentsTransactionsGet({
    access_token: PLAID_ACCESS_TOKEN, start_date: iso(start), end_date: iso(end),
    options: { count: 500, offset },
  });
  const b = r.data.investment_transactions || [];
  all = all.concat(b);
  if (all.length >= (r.data.total_investment_transactions ?? all.length) || !b.length) break;
  offset = all.length;
}
const dates = all.map((t) => t.date).sort();
console.log(`${all.length} transactions, ${dates[0]} .. ${dates[dates.length - 1]}  (asked for ${iso(start)}..${iso(end)})`);

console.log('\nCash movements Plaid can currently see (these are the double-count risk):');
const cash = all.filter((t) => (t.type || '') === 'cash');
const bySub = new Map();
for (const t of cash) {
  const g = bySub.get(t.subtype) || { n: 0, sum: 0, first: '9999', last: '0000' };
  g.n++; g.sum += t.amount || 0;
  if (t.date < g.first) g.first = t.date;
  if (t.date > g.last) g.last = t.date;
  bySub.set(t.subtype, g);
}
for (const [k, g] of bySub) {
  console.log(`  ${String(k).padEnd(14)} n=${String(g.n).padStart(3)}  sum=${money(g.sum).padStart(13)}  ${g.first}..${g.last}`);
}
const deps = cash.filter((t) => ['deposit', 'contribution'].includes(t.subtype));
console.log(`\nDeposits/contributions in window: ${deps.length}, totalling ${money(deps.reduce((s, t) => s + -(t.amount || 0), 0))}`);
console.log('Latest deposit date:', deps.map((t) => t.date).sort().pop() || '(none)');
console.log('\nA base_through cutoff on or after that date excludes all of these from the ledger.');

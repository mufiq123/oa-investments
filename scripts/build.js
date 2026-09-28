// scripts/build.js
// Generates dist/index.html — the one-page O.A. Investments dashboard — from
// data/history.json (value over time), data/latest.json (holdings) and
// data/deposits.json (the one hand-maintained figure; see the stats block).
import { readFileSync, writeFileSync, mkdirSync, copyFileSync, existsSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const history = JSON.parse(readFileSync(join(root, 'data', 'history.json'), 'utf8'));
const latestPath = join(root, 'data', 'latest.json');
const latest = existsSync(latestPath) ? JSON.parse(readFileSync(latestPath, 'utf8')) : null;

const total = latest ? latest.total : history[history.length - 1].value;
const positions = latest ? latest.positions : [];
const asOf = latest ? latest.date : history[history.length - 1].date;

const round2 = (n) => Math.round((n + Number.EPSILON) * 100) / 100;
const money = (n) =>
  '$' + n.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const short$ = (n) => (n >= 1000 ? '$' + Math.round(n / 1000) + 'k' : '$' + Math.round(n));
const MONTHS = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
const prettyDate = (iso) => {
  const [y, m, d] = iso.split('-').map(Number);
  return `${MONTHS[m - 1]} ${d}, ${y}`;
};
const monthYear = (iso) => {
  const [y, m] = iso.split('-').map(Number);
  return `${MONTHS[m - 1]} ${y}`;
};
const tickLabel = (iso) => {
  const [y, m] = iso.split('-').map(Number);
  return `${MONTHS[m - 1]} ’${String(y).slice(2)}`;
};

// ---- growth chart (SVG, time-scaled x axis, y from 0) ----
// Colors are CSS custom properties, so the chart follows the active theme.
function chartSVG(points) {
  const W = 680, H = 400, PL = 56, PR = 20, PT = 30, PB = 42;
  const t = (iso) => { const [y, m, d] = iso.split('-').map(Number); return new Date(y, m - 1, d).getTime(); };
  const t0 = t(points[0].date);
  const t1 = t(points[points.length - 1].date);
  const maxV = Math.max(...points.map((p) => p.value));
  const yMax = maxV * 1.06;
  const X = (tt) => PL + ((tt - t0) / Math.max(t1 - t0, 1)) * (W - PL - PR);
  const Y = (v) => PT + (1 - v / yMax) * (H - PT - PB);

  const line = points.map((p) => `${X(t(p.date)).toFixed(1)},${Y(p.value).toFixed(1)}`).join(' ');
  const area = `${PL},${Y(0).toFixed(1)} ${line} ${X(t1).toFixed(1)},${Y(0).toFixed(1)}`;

  const gridVals = [0, yMax / 2, yMax];
  const grid = gridVals.map((v) => `
      <line x1="${PL}" y1="${Y(v).toFixed(1)}" x2="${W - PR}" y2="${Y(v).toFixed(1)}" stroke="var(--rule-strong)" stroke-dasharray="5 5"/>
      <text class="money" x="${PL - 10}" y="${(Y(v) + 4).toFixed(1)}" text-anchor="end" font-size="13" fill="var(--ink-muted)">${short$(v)}</text>`).join('');

  const n = points.length;
  const tickIdx = [...new Set([0, Math.floor(n * 0.25), Math.floor(n * 0.5), Math.floor(n * 0.75), n - 1])];
  // The first and last points sit on the plot edges, so a centred label there
  // would overflow the viewBox and get clipped. Anchor those two inward.
  const xticks = tickIdx.map((i) => {
    const anchor = i === 0 ? 'start' : i === n - 1 ? 'end' : 'middle';
    return `
      <text x="${X(t(points[i].date)).toFixed(1)}" y="${H - 12}" text-anchor="${anchor}" font-size="13" fill="var(--ink-muted)">${tickLabel(points[i].date)}</text>`;
  }).join('');

  const last = points[n - 1];
  const lx = X(t(last.date)), ly = Y(last.value);
  return `
  <svg viewBox="0 0 ${W} ${H}" style="width:100%;height:auto;display:block" role="img" aria-label="Portfolio growth chart">
    <defs>
      <linearGradient id="gg" x1="0" y1="0" x2="0" y2="1">
        <stop offset="0%" stop-color="var(--gold)" stop-opacity="0.25"/>
        <stop offset="100%" stop-color="var(--gold)" stop-opacity="0.02"/>
      </linearGradient>
    </defs>
    ${grid}
    <polygon points="${area}" fill="url(#gg)"/>
    <polyline points="${line}" fill="none" stroke="var(--gold)" stroke-width="3.5" stroke-linejoin="round" stroke-linecap="round"/>
    <circle cx="${lx.toFixed(1)}" cy="${ly.toFixed(1)}" r="7" fill="var(--surface)" stroke="var(--gold)" stroke-width="3.5"/>
    <text class="money" x="${(lx - 12).toFixed(1)}" y="${(ly - 14).toFixed(1)}" text-anchor="end" font-size="16" font-weight="700" fill="var(--ink-soft)">${money(last.value)}</text>
    ${xticks}
  </svg>`;
}

// ---- performance stats ----
// history.json records portfolio VALUE, not cash flow, so net deposits cannot be
// derived from it: a rise could be a deposit or a market gain. Net deposits is
// therefore read from data/deposits.json (maintained by hand), and the gain
// figures are derived from it plus the current total, so they stay in step with
// the daily refresh. If the file is missing or unusable, the whole stats row is
// omitted rather than shown with wrong numbers.
const depositsPath = join(root, 'data', 'deposits.json');
let depositsFile = null;
try {
  if (existsSync(depositsPath)) depositsFile = JSON.parse(readFileSync(depositsPath, 'utf8'));
} catch (err) {
  console.warn(`Could not read data/deposits.json (${err.message}) — hiding the stats row.`);
}
const netDeposits =
  depositsFile && Number.isFinite(depositsFile.net_deposits) && depositsFile.net_deposits > 0
    ? depositsFile.net_deposits
    : null;

let statsHTML = '';
if (netDeposits != null) {
  const gains = round2(total - netDeposits);
  const gainPct = (gains / netDeposits) * 100;
  const up = gains >= 0;
  const sign = up ? '+' : '−'; // a real minus sign, not a hyphen
  const cls = up ? 'up' : 'down';
  const span = `${monthYear(history[0].date)} – ${monthYear(history[history.length - 1].date)}`;
  const src = depositsFile.note ? ` ${depositsFile.note}` : '';
  statsHTML = `
    <div class="stats">
      <div><div class="label">Net deposits</div><div class="v money">${money(netDeposits)}</div></div>
      <div><div class="label">Investment gains</div><div class="v ${cls} money">${sign}${money(Math.abs(gains))}</div></div>
      <div><div class="label">Gain on deposits</div><div class="v ${cls} money">${sign}${Math.abs(gainPct).toFixed(1)}%</div></div>
    </div>
    <div class="fine" style="text-align:left;margin-top:10px">Net deposits${src} · gains derived · ${span}</div>`;
}

// ---- holdings ----
const GOLD_SHADES = ['var(--gold-1)','var(--gold-2)','var(--gold-3)','var(--gold-4)','var(--gold-5)','var(--gold-6)'];
let allocBar = '';
let rows = '';
if (positions.length) {
  allocBar = `<div style="display:flex;height:8px;border-radius:99px;overflow:hidden;margin-top:14px">` +
    positions.map((p, i) => `<div style="width:${(p.value / total * 100).toFixed(2)}%;background:${GOLD_SHADES[i % GOLD_SHADES.length]}"></div>`).join('') +
    `</div>`;
  rows = positions.map((p) => {
    const pct = (p.value / total) * 100;
    // Plaid reports full legal names ("Vanguard World Fund - Vanguard
    // Information Technology ETF"). The issuing-entity prefix is noise and, in
    // a nowrap column this narrow, pushes the part that identifies the fund
    // past the ellipsis. Show whatever follows the first " - " instead, and
    // fall back to the whole name when there is no prefix to strip. Matching
    // on spaced " - " leaves hyphenated words like "Exchange-Traded" alone.
    const cut = p.name.indexOf(' - ');
    const name = (cut === -1 ? '' : p.name.slice(cut + 3).trim()) || p.name;
    const sub = p.quantity != null && p.price != null
      ? `${p.quantity.toLocaleString('en-US', { maximumFractionDigits: 4 })} sh · ${money(p.price)}`
      : 'ETF';
    return `
    <div style="display:flex;align-items:center;gap:12px;padding:14px 0;border-top:1px solid var(--rule)">
      <div style="width:46px;height:46px;border-radius:12px;background:var(--chip-bg);color:var(--chip-ink);font-weight:800;font-size:12px;display:flex;align-items:center;justify-content:center;flex:none">${p.ticker.slice(0, 5)}</div>
      <div style="flex:1;min-width:0">
        <div style="font-weight:700;font-size:15px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis">${name}</div>
        <div class="money" style="color:var(--ink-muted);font-size:12.5px;margin-top:2px">${sub}</div>
      </div>
      <div style="text-align:right;flex:none">
        <div class="money" style="font-weight:800;font-size:15.5px">${money(p.value)}</div>
        <div class="money" style="color:var(--ink-muted);font-size:12.5px;margin-top:2px">${pct.toFixed(1)}%</div>
      </div>
    </div>`;
  }).join('');
} else {
  rows = `<div style="padding:18px 0;color:var(--ink-muted)">Holdings appear after the first data refresh.</div>`;
}

const html = `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">
<meta name="color-scheme" content="light dark">
<meta name="theme-color" content="#f6f4ee" media="(prefers-color-scheme: light)">
<meta name="theme-color" content="#161412" media="(prefers-color-scheme: dark)">
<title>O.A. Investments</title>
<style>
  /* Light theme (default). Every color is a token, so the dark override below
     also reaches colors used inside inline style attributes and the SVG —
     inline styles outrank a media query, but var() lookups still resolve. */
  :root {
    --bg: #f6f4ee;
    --surface: #ffffff;
    --ink: #1c1917;
    --ink-soft: #44403c;
    --ink-muted: #a8a29e;
    --rule: #f0ece1;
    --rule-strong: #e7e2d6;
    --gold: #a97e2f;
    --loss: #a8412a;
    --chip-bg: #f5ead3;
    --chip-ink: #8a6a24;
    --warn-bg: #fdf4e3;
    --warn-ink: #7a5312;
    --warn-border: #f0dcb4;
    --shadow: 0 1px 2px rgba(28,25,23,.05);
    --gold-1: #a97e2f; --gold-2: #bd9440; --gold-3: #cfa856;
    --gold-4: #ddbd72; --gold-5: #e8d094; --gold-6: #f0e0b8;
  }
  /* Dark theme, following the OS / app appearance setting. */
  @media (prefers-color-scheme: dark) {
    :root {
      --bg: #161412;
      --surface: #211e1a;
      --ink: #f5f1e8;
      --ink-soft: #d6cfc2;
      --ink-muted: #9d968c;
      --rule: #2b2721;
      --rule-strong: #322d26;
      --gold: #d2a44a;
      --loss: #e2806a;
      --chip-bg: #3a301d;
      --chip-ink: #e3c47e;
      --warn-bg: #2e2413;
      --warn-ink: #edcd8d;
      --warn-border: #4d3c1d;
      --shadow: 0 1px 2px rgba(0,0,0,.4);
      --gold-1: #d2a44a; --gold-2: #c1913d; --gold-3: #ad7f33;
      --gold-4: #91692a; --gold-5: #765422; --gold-6: #5b401b;
    }
  }
  * { box-sizing: border-box; margin: 0; padding: 0; }
  body { font-family: -apple-system, BlinkMacSystemFont, "SF Pro Text", "Segoe UI", sans-serif; background: var(--bg); color: var(--ink); -webkit-font-smoothing: antialiased; }
  .wrap { max-width: 520px; margin: 0 auto; padding: 20px 16px 40px; }
  .topbar { display: flex; align-items: center; gap: 12px; margin-bottom: 18px; }
  .topbar img { width: 44px; height: 44px; border-radius: 12px; object-fit: cover; }
  .topbar .name { font-weight: 800; font-size: 18px; }
  .topbar .sub { color: var(--ink-muted); font-size: 12.5px; margin-top: 1px; }
  .eye { margin-left: auto; width: 40px; height: 40px; border-radius: 99px; border: 1px solid var(--rule-strong); background: var(--surface); color: inherit; cursor: pointer; font-size: 18px; }
  .card { background: var(--surface); border-radius: 20px; padding: 22px 20px; margin-bottom: 14px; box-shadow: var(--shadow); }
  .label { color: var(--ink-muted); font-size: 13px; font-weight: 600; }
  .hero { font-size: 44px; font-weight: 800; letter-spacing: -1px; margin-top: 6px; }
  .hero-sub { color: var(--ink-muted); font-size: 13px; margin-top: 6px; }
  /* Equal columns, and each cell is a flex column whose label absorbs the
     spare height. A label that wraps to two lines therefore pushes nothing
     around: all three values still sit on one baseline. */
  .stats { display: grid; grid-template-columns: repeat(3, 1fr); margin-top: 16px; border-top: 1px solid var(--rule); padding-top: 14px; }
  .stats > div { display: flex; flex-direction: column; min-width: 0; padding-right: 10px; }
  .stats > div + div { border-left: 1px solid var(--rule); padding-left: 12px; }
  .stats .label { flex: 1; font-size: 12.5px; line-height: 1.35; }
  .stats .v { font-weight: 800; font-size: 16px; margin-top: 5px; white-space: nowrap; }
  .stats .v.up { color: var(--gold); }
  .stats .v.down { color: var(--loss); }
  .sect { display: flex; align-items: baseline; justify-content: space-between; margin: 22px 4px 10px; }
  .sect h2 { font-size: 19px; font-weight: 800; }
  .sect span { color: var(--ink-muted); font-size: 12.5px; }
  .fine { color: var(--ink-muted); font-size: 11.5px; text-align: center; margin-top: 18px; line-height: 1.6; }
  /* blur scales with font size so a 12px share count is hidden as well as the 44px total */
  .hide-values .money { filter: blur(0.4em); }
  /* WebKit does not reliably apply CSS filters to individual SVG elements,
     so on iOS the chart's labels stayed sharp while everything else blurred.
     Hide them outright instead — opacity works on SVG text everywhere. */
  .hide-values text.money { opacity: 0; }
  .stale { display: flex; gap: 9px; align-items: flex-start; background: var(--warn-bg); color: var(--warn-ink); border: 1px solid var(--warn-border); border-radius: 14px; padding: 12px 14px; margin-bottom: 14px; font-size: 12.5px; line-height: 1.5; }
  .stale[hidden] { display: none; }
  .stale b { font-weight: 800; }
</style>
</head>
<body data-asof="${asOf}">
<div class="wrap">
  <div class="topbar">
    <img src="assets/logo.jpg" alt="O.A. Investments logo">
    <div><div class="name">O.A. Investments</div><div class="sub">Business account</div></div>
    <button class="eye" id="eye" aria-label="Hide or show dollar amounts">\u{1F441}</button>
  </div>

  <div class="stale" id="stale" hidden><span aria-hidden="true">⚠️</span><span><b>This page may be out of date.</b> <span id="stale-msg"></span></span></div>

  <div class="card">
    <div class="label">Current portfolio value</div>
    <div class="hero money">${money(total)}</div>
    <div class="hero-sub">Portfolio snapshot · ${prettyDate(asOf)}</div>
    ${allocBar}
  </div>

  <div class="sect"><h2>Growth</h2><span>${history.length} data points</span></div>
  <div class="card">
    ${chartSVG(history)}${statsHTML}
  </div>

  <div class="sect"><h2>Holdings</h2><span>${positions.length} positions</span></div>
  <div class="card" style="padding-top:6px">${rows}</div>

  <div class="fine">Updated ${prettyDate(asOf)} · refreshes daily<br>Data via Plaid (read-only) · may lag Vanguard</div>
</div>
<script>
  document.getElementById('eye').addEventListener('click', () => document.body.classList.toggle('hide-values'));

  // Staleness is worked out in the browser, not at build time, so the warning
  // still appears if the daily workflow stops running and this page is never
  // rebuilt — the case a build-time banner would silently miss.
  (function () {
    var asOf = document.body.getAttribute('data-asof');
    if (!asOf) return;
    var p = asOf.split('-').map(Number);
    if (p.length !== 3 || p.some(isNaN)) return;
    var snap = new Date(p[0], p[1] - 1, p[2]);
    var now = new Date();
    var today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
    var days = Math.round((today - snap) / 86400000);
    if (!(days >= 2)) return; // 0 = today, 1 = before today's noon refresh
    document.getElementById('stale-msg').textContent =
      'The last successful update was ' + days + ' days ago, so these figures are not current. The daily refresh may have stopped.';
    document.getElementById('stale').hidden = false;
  })();
</script>
</body>
</html>`;

mkdirSync(join(root, 'dist', 'assets'), { recursive: true });
writeFileSync(join(root, 'dist', 'index.html'), html);
copyFileSync(join(root, 'assets', 'logo.jpg'), join(root, 'dist', 'assets', 'logo.jpg'));
console.log(
  `Wrote dist/index.html (${(html.length / 1024).toFixed(1)} KB), ${history.length} history points, ` +
  `${positions.length} positions, net deposits ` +
  `${netDeposits == null ? 'unset (stats row hidden)' : money(netDeposits)}.`
);

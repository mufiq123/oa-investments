// scripts/build.js
// Generates dist/index.html — the one-page O.A. Investments dashboard —
// from data/history.json (value-over-time) and data/latest.json (holdings).
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

const GOLD = '#a97e2f';
const money = (n) =>
  '$' + n.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const short$ = (n) => (n >= 1000 ? '$' + Math.round(n / 1000) + 'k' : '$' + Math.round(n));
const MONTHS = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
const prettyDate = (iso) => {
  const [y, m, d] = iso.split('-').map(Number);
  return `${MONTHS[m - 1]} ${d}, ${y}`;
};
const tickLabel = (iso) => {
  const [y, m] = iso.split('-').map(Number);
  return `${MONTHS[m - 1]} ’${String(y).slice(2)}`;
};

// ---- growth chart (SVG, time-scaled x axis, y from 0) ----
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
      <line x1="${PL}" y1="${Y(v).toFixed(1)}" x2="${W - PR}" y2="${Y(v).toFixed(1)}" stroke="#e7e2d6" stroke-dasharray="5 5"/>
      <text x="${PL - 10}" y="${(Y(v) + 4).toFixed(1)}" text-anchor="end" font-size="13" fill="#a8a29e">${short$(v)}</text>`).join('');

  const n = points.length;
  const tickIdx = [...new Set([0, Math.floor(n * 0.25), Math.floor(n * 0.5), Math.floor(n * 0.75), n - 1])];
  const xticks = tickIdx.map((i) => `
      <text x="${X(t(points[i].date)).toFixed(1)}" y="${H - 12}" text-anchor="middle" font-size="13" fill="#a8a29e">${tickLabel(points[i].date)}</text>`).join('');

  const last = points[n - 1];
  const lx = X(t(last.date)), ly = Y(last.value);
  return `
  <svg viewBox="0 0 ${W} ${H}" style="width:100%;height:auto;display:block" role="img" aria-label="Portfolio growth chart">
    <defs>
      <linearGradient id="gg" x1="0" y1="0" x2="0" y2="1">
        <stop offset="0%" stop-color="${GOLD}" stop-opacity="0.25"/>
        <stop offset="100%" stop-color="${GOLD}" stop-opacity="0.02"/>
      </linearGradient>
    </defs>
    ${grid}
    <polygon points="${area}" fill="url(#gg)"/>
    <polyline points="${line}" fill="none" stroke="${GOLD}" stroke-width="3.5" stroke-linejoin="round" stroke-linecap="round"/>
    <circle cx="${lx.toFixed(1)}" cy="${ly.toFixed(1)}" r="7" fill="#fff" stroke="${GOLD}" stroke-width="3.5"/>
    <text x="${(lx - 12).toFixed(1)}" y="${(ly - 14).toFixed(1)}" text-anchor="end" font-size="16" font-weight="700" fill="#44403c">${money(last.value)}</text>
    ${xticks}
  </svg>`;
}

// ---- holdings ----
const GOLD_SHADES = ['#a97e2f', '#bd9440', '#cfa856', '#ddbd72', '#e8d094', '#f0e0b8'];
let allocBar = '';
let rows = '';
if (positions.length) {
  allocBar = `<div style="display:flex;height:8px;border-radius:99px;overflow:hidden;margin-top:14px">` +
    positions.map((p, i) => `<div style="width:${(p.value / total * 100).toFixed(2)}%;background:${GOLD_SHADES[i % GOLD_SHADES.length]}"></div>`).join('') +
    `</div>`;
  rows = positions.map((p) => {
    const pct = (p.value / total) * 100;
    const sub = p.quantity != null && p.price != null
      ? `${p.quantity.toLocaleString('en-US', { maximumFractionDigits: 4 })} sh · ${money(p.price)}`
      : 'ETF';
    return `
    <div style="display:flex;align-items:center;gap:12px;padding:14px 0;border-top:1px solid #f0ece1">
      <div style="width:46px;height:46px;border-radius:12px;background:#f5ead3;color:#8a6a24;font-weight:800;font-size:12px;display:flex;align-items:center;justify-content:center;flex:none">${p.ticker.slice(0, 5)}</div>
      <div style="flex:1;min-width:0">
        <div style="font-weight:700;font-size:15px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis">${p.name}</div>
        <div style="color:#a8a29e;font-size:12.5px;margin-top:2px">${sub}</div>
      </div>
      <div style="text-align:right;flex:none">
        <div class="money" style="font-weight:800;font-size:15.5px">${money(p.value)}</div>
        <div style="color:#a8a29e;font-size:12.5px;margin-top:2px">${pct.toFixed(1)}%</div>
      </div>
    </div>`;
  }).join('');
} else {
  rows = `<div style="padding:18px 0;color:#a8a29e">Holdings appear after the first data refresh.</div>`;
}

const html = `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">
<title>O.A. Investments</title>
<style>
  * { box-sizing: border-box; margin: 0; padding: 0; }
  body { font-family: -apple-system, BlinkMacSystemFont, "SF Pro Text", "Segoe UI", sans-serif; background: #f6f4ee; color: #1c1917; -webkit-font-smoothing: antialiased; }
  .wrap { max-width: 520px; margin: 0 auto; padding: 20px 16px 40px; }
  .topbar { display: flex; align-items: center; gap: 12px; margin-bottom: 18px; }
  .topbar img { width: 44px; height: 44px; border-radius: 12px; object-fit: cover; }
  .topbar .name { font-weight: 800; font-size: 18px; }
  .topbar .sub { color: #a8a29e; font-size: 12.5px; margin-top: 1px; }
  .eye { margin-left: auto; width: 40px; height: 40px; border-radius: 99px; border: 1px solid #e7e2d6; background: #fff; cursor: pointer; font-size: 18px; }
  .card { background: #fff; border-radius: 20px; padding: 22px 20px; margin-bottom: 14px; box-shadow: 0 1px 2px rgba(28,25,23,.05); }
  .label { color: #a8a29e; font-size: 13px; font-weight: 600; }
  .hero { font-size: 44px; font-weight: 800; letter-spacing: -1px; margin-top: 6px; }
  .hero-sub { color: #a8a29e; font-size: 13px; margin-top: 6px; }
  .stats { display: flex; margin-top: 16px; border-top: 1px solid #f0ece1; padding-top: 14px; }
  .stats > div { flex: 1; }
  .stats > div + div { border-left: 1px solid #f0ece1; padding-left: 14px; }
  .stats .v { font-weight: 800; font-size: 16px; margin-top: 3px; }
  .stats .v.up { color: ${GOLD}; }
  .sect { display: flex; align-items: baseline; justify-content: space-between; margin: 22px 4px 10px; }
  .sect h2 { font-size: 19px; font-weight: 800; }
  .sect span { color: #a8a29e; font-size: 12.5px; }
  .fine { color: #a8a29e; font-size: 11.5px; text-align: center; margin-top: 18px; line-height: 1.6; }
  .hide-values .money { filter: blur(9px); }
</style>
</head>
<body>
<div class="wrap">
  <div class="topbar">
    <img src="assets/logo.jpg" alt="O.A. Investments logo">
    <div><div class="name">O.A. Investments</div><div class="sub">Business account</div></div>
    <button class="eye" id="eye" aria-label="Hide or show dollar amounts">👁</button>
  </div>

  <div class="card">
    <div class="label">Current portfolio value</div>
    <div class="hero money">${money(total)}</div>
    <div class="hero-sub">Portfolio snapshot · ${prettyDate(asOf)}</div>
    ${allocBar}
  </div>

  <div class="sect"><h2>Growth</h2><span>${history.length} data points</span></div>
  <div class="card">
    ${chartSVG(history)}
    <div class="stats">
      <div><div class="label">Net deposits</div><div class="v money">$25,910</div></div>
      <div><div class="label">Investment gains</div><div class="v up money">+$6,033.03</div></div>
      <div><div class="label">Gain on deposits</div><div class="v up">+23.3%</div></div>
    </div>
    <div class="fine" style="text-align:left;margin-top:10px">Deposit &amp; gain figures per Vanguard · Sep 2025 – Sep 2026</div>
  </div>

  <div class="sect"><h2>Holdings</h2><span>${positions.length} positions</span></div>
  <div class="card" style="padding-top:6px">${rows}</div>

  <div class="fine">Updated ${prettyDate(asOf)} · refreshes every morning<br>Data via Plaid (read-only) · may lag Vanguard</div>
</div>
<script>
  document.getElementById('eye').addEventListener('click', () => document.body.classList.toggle('hide-values'));
</script>
</body>
</html>`;

mkdirSync(join(root, 'dist', 'assets'), { recursive: true });
writeFileSync(join(root, 'dist', 'index.html'), html);
copyFileSync(join(root, 'assets', 'logo.jpg'), join(root, 'dist', 'assets', 'logo.jpg'));
console.log(`Wrote dist/index.html (${(html.length / 1024).toFixed(1)} KB), ${history.length} history points, ${positions.length} positions.`);

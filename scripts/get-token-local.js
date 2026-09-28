// scripts/get-token-local.js
// ONE-TIME setup, run on your own computer (not on the server):
//
//   npm install
//   PLAID_CLIENT_ID=... PLAID_SECRET=... node scripts/get-token-local.js
//
// It opens a Plaid Link window where you log in to the Vanguard business
// account, then prints an access token. Paste that token into your GitHub
// repository's secrets as PLAID_ACCESS_TOKEN. The token never leaves your
// machine except into your own repo's secret storage.
import { Configuration, PlaidApi, PlaidEnvironments } from 'plaid';
import http from 'http';
import readline from 'readline/promises';

const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
const ask = async (q, env) => (process.env[env] || (await rl.question(q))).trim();

const clientId = await ask('Plaid Client ID: ', 'PLAID_CLIENT_ID');
const secret = await ask('Plaid Secret: ', 'PLAID_SECRET');
const envName = (process.env.PLAID_ENV || 'production').trim();
const envMap = {
  sandbox: PlaidEnvironments.sandbox,
  development: PlaidEnvironments.development,
  production: PlaidEnvironments.production,
};
if (!envMap[envName]) {
  console.error(`Unknown PLAID_ENV "${envName}".`);
  process.exit(1);
}

const plaid = new PlaidApi(
  new Configuration({
    basePath: envMap[envName],
    baseOptions: { headers: { 'PLAID-CLIENT-ID': clientId, 'PLAID-SECRET': secret } },
  })
);

const linkResp = await plaid.linkTokenCreate({
  user: { client_user_id: 'oa-investments-owner' },
  client_name: 'O.A. Investments Dashboard',
  products: ['investments'],
  country_codes: ['US'],
  language: 'en',
});
const linkToken = linkResp.data.link_token;

const page = `<!DOCTYPE html><html><body style="font-family:sans-serif;display:flex;align-items:center;justify-content:center;height:100vh;background:#f6f4ee">
<div style="text-align:center;max-width:420px;padding:32px">
<h2>O.A. Investments</h2>
<p>Click below, then log in to the Vanguard business account.</p>
<button id="b" style="font-size:18px;padding:14px 28px;border-radius:12px;border:none;background:#a97e2f;color:#fff;cursor:pointer">Connect Vanguard</button>
<p id="s" style="color:#78716c;margin-top:16px"></p>
</div>
<script src="https://cdn.plaid.com/link/v2/stable/link-initialize.js"></script>
<script>
const h = Plaid.create({ token: ${JSON.stringify(linkToken)}, onSuccess: async (pt) => {
  document.getElementById('s').textContent = 'Exchanging token…';
  const r = await fetch('/exchange', { method: 'POST', headers: {'Content-Type':'application/json'}, body: JSON.stringify({ public_token: pt }) });
  const j = await r.json();
  document.getElementById('s').textContent = j.access_token ? 'Done — copy the access token from your terminal.' : ('Error: ' + (j.error || 'unknown'));
}, onExit: (e) => { if (e) document.getElementById('s').textContent = 'Closed: ' + (e.error_message || e.display_message || ''); } });
document.getElementById('b').onclick = () => h.open();
</script></body></html>`;

const server = http.createServer(async (req, res) => {
  if (req.method === 'POST' && req.url === '/exchange') {
    let body = '';
    req.on('data', (c) => (body += c));
    req.on('end', async () => {
      try {
        const { public_token } = JSON.parse(body);
        const ex = await plaid.itemPublicTokenExchange({ public_token });
        const accessToken = ex.data.access_token;
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ ok: true }));
        console.log('\n============================================');
        console.log('Your PLAID_ACCESS_TOKEN (save as a GitHub secret):');
        console.log(accessToken);
        console.log('============================================\nYou can close this now.');
        rl.close();
        setTimeout(() => process.exit(0), 500);
      } catch (err) {
        res.writeHead(500, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: err?.response?.data?.error_message || String(err) }));
      }
    });
    return;
  }
  res.writeHead(200, { 'Content-Type': 'text/html' });
  res.end(page);
});

server.listen(3000, () => {
  console.log('\nOpen http://localhost:3000 in your browser and click "Connect Vanguard".\n');
});

// hub-helpers.mjs — atel hub command implementation
// No new npm dependencies: uses native fetch, fs, crypto

import { existsSync, readFileSync, writeFileSync, mkdirSync } from 'fs';
import { join } from 'path';
import { createReadStream } from 'fs';

const _atelDir = process.env.ATEL_DIR || join(process.env.HOME || '/root', '.atel');
const HUB_CONFIG_PATH = join(_atelDir, 'hub.json');
const DEFAULT_BASE = 'https://api.atelai.org/tokenhub/v1';

// ─── Config ──────────────────────────────────────────────────────

function getConfig() {
  const envKey = process.env.ATEL_HUB_KEY;
  const envBase = process.env.ATEL_HUB_BASE || DEFAULT_BASE;
  if (envKey) return { key: envKey, base: envBase };
  if (!existsSync(HUB_CONFIG_PATH)) {
    throw new Error('No hub API key configured. Run: atel hub key create');
  }
  try {
    return JSON.parse(readFileSync(HUB_CONFIG_PATH, 'utf-8'));
  } catch {
    throw new Error('Corrupted hub config. Run: atel hub key create');
  }
}

function saveConfig(key, base) {
  const dir = _atelDir;
  mkdirSync(dir, { recursive: true, mode: 0o700 });
  writeFileSync(
    HUB_CONFIG_PATH,
    JSON.stringify({ key, base: base || DEFAULT_BASE }),
    { mode: 0o600 }
  );
}

// ─── HTTP ────────────────────────────────────────────────────────

async function hubFetch(path, options = {}) {
  const cfg = getConfig();
  const url = cfg.base + path;
  const res = await fetch(url, {
    ...options,
    headers: {
      Authorization: 'Bearer ' + cfg.key,
      'Content-Type': 'application/json',
      ...(options.headers || {}),
    },
  });
  if (!res.ok) {
    let errBody = {};
    try { errBody = await res.json(); } catch {}
    const code = errBody?.error?.code || 'ERROR';
    const msg = errBody?.error?.message || res.statusText;
    const err = new Error(`[${code}] ${msg}`);
    err.httpStatus = res.status;
    err.code = code;
    if (errBody?.error?.action === 'topup') {
      err.hint = 'Run: atel hub topup';
    }
    throw err;
  }
  return res;
}

// ─── Commands ────────────────────────────────────────────────────

async function cmdHubSwap(usdcAmount, flags) {
  if (!usdcAmount || isNaN(parseFloat(usdcAmount))) {
    console.error('Usage: atel hub swap <usdc_amount> [--chain bsc|base]');
    console.error('Example: atel hub swap 1.0 --chain bsc');
    process.exit(1);
  }
  const amount = parseFloat(usdcAmount);
  const chain = flags.chain || 'bsc';

  // swap via platform (not tokenhub)
  const { loadIdentity } = await import('./atel.mjs');
  const id = loadIdentity();
  const PLATFORM_URL = process.env.ATEL_PLATFORM || process.env.ATEL_REGISTRY || 'https://api.atelai.org';

  // Use signedFetch from atel.mjs
  const body = JSON.stringify({ usdc_amount: amount, chain });
  const res = await fetch(PLATFORM_URL + '/account/v1/swap', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body,
    signal: AbortSignal.timeout(10000),
  });
  const data = await res.json();
  if (!res.ok) {
    console.error('Swap failed:', data.error || JSON.stringify(data));
    process.exit(1);
  }
  const tokenPerUSDC = data.token_per_usdc || 10000;
  console.log('✓ Swap successful');
  console.log(`  USDC spent:     $${amount.toFixed(6)}`);
  console.log(`  ATELToken received: ${data.token_amount.toLocaleString()}`);
  console.log(`  Rate:           1 USDC = ${tokenPerUSDC.toLocaleString()} ATEL`);
  console.log(`  Platform balance after: $${parseFloat(data.balance_after).toFixed(6)} USDC`);
  console.log('');
  console.log('Run `atel hub balance` to check your ATELToken balance.');
}

async function cmdHubBalance() {
  const res = await hubFetch('/balance');
  const data = await res.json();
  console.log(`ATELToken Balance: ${data.balance.toLocaleString()}`);
  console.log(`USDC Equivalent:   $${data.usdc_equiv}`);
  if (data.overdraft) {
    console.warn('⚠ Account is in overdraft. Top up to resume service.');
  }
}

async function cmdHubUsage(flags) {
  const params = new URLSearchParams();
  const modelIdx = flags.indexOf('--model');
  if (modelIdx !== -1 && flags[modelIdx + 1]) params.set('model', flags[modelIdx + 1]);
  const daysIdx = flags.indexOf('--days');
  if (daysIdx !== -1 && flags[daysIdx + 1]) {
    const days = parseInt(flags[daysIdx + 1], 10);
    const start = new Date(Date.now() - days * 86400000).toISOString().slice(0, 10);
    params.set('start', start);
  }
  const res = await hubFetch('/usage?' + params.toString());
  const data = await res.json();
  console.log(`Usage (${data.total} total, showing page ${data.page}):`);
  if (data.items.length === 0) {
    console.log('  No usage records found.');
    return;
  }
  console.log('  Time                  Model                          In      Out   Cost');
  console.log('  ' + '-'.repeat(80));
  for (const item of data.items) {
    const t = new Date(item.created_at).toLocaleString();
    const model = item.model_id.padEnd(30);
    console.log(`  ${t}  ${model}  ${String(item.tokens_in).padStart(6)}  ${String(item.tokens_out).padStart(6)}  ${item.cost}`);
  }
  const totalCost = data.items.reduce((s, i) => s + i.cost, 0);
  console.log('  ' + '-'.repeat(80));
  console.log(`  Total cost this page: ${totalCost} ATELToken`);
}

async function cmdHubTopup() {
  // Show balance
  const res = await hubFetch('/balance');
  const data = await res.json();
  console.log('Current balance: ' + data.balance.toLocaleString() + ' ATELToken ($' + data.usdc_equiv + ')');
  console.log('Exchange rate:   1 USDC = 10,000 ATELToken');
  console.log('');

  // Fetch smart wallet addresses from registry
  const identityPath = join(_atelDir, 'identity.json');
  if (!existsSync(identityPath)) {
    console.log('No identity found. Run: atel init');
    return;
  }
  const identity = JSON.parse(readFileSync(identityPath, 'utf-8'));
  const did = identity.did;
  const PLATFORM_URL = process.env.ATEL_PLATFORM || process.env.ATEL_REGISTRY || 'https://api.atelai.org';

  try {
    const agentRes = await fetch(`${PLATFORM_URL}/registry/v1/agent/${encodeURIComponent(did)}`, {
      signal: AbortSignal.timeout(5000)
    });
    if (!agentRes.ok) throw new Error('registry fetch failed');
    const agent = await agentRes.json();
    const wallets = typeof agent.wallets === 'string' ? JSON.parse(agent.wallets) : agent.wallets;
    if (!wallets || Object.keys(wallets).length === 0) {
      console.log('No deposit address found. Make sure you have registered: atel register');
      return;
    }
    console.log('Send USDC to your smart wallet deposit address:');
    console.log('');
    if (wallets.bsc)  console.log('  BSC:  ' + wallets.bsc);
    if (wallets.base) console.log('  Base: ' + wallets.base);
    console.log('');
    console.log('After sending, run: atel hub swap <usdc_amount> --chain bsc|base');
    console.log('(deposits are detected automatically, usually within 1-2 minutes)');
  } catch (e) {
    console.log('Could not fetch deposit address: ' + e.message);
  }
}

async function cmdHubKeyCreate(flags) {
  const nameIdx = flags.indexOf('--name');
  const name = nameIdx !== -1 && flags[nameIdx + 1] ? flags[nameIdx + 1] : 'default';

  let fullKey, hubBase;

  // Bootstrap path: no hub.json yet — use DID-signed platform auth to get first key
  if (!existsSync(HUB_CONFIG_PATH)) {
    // Load identity from ATEL_DIR
    const identityPath = join(_atelDir, 'identity.json');
    if (!existsSync(identityPath)) throw new Error('No identity found. Run: atel init');
    const identity = JSON.parse(readFileSync(identityPath, 'utf-8'));
    const did = identity.did;
    // secretKey stored as hex in identity.json
    const secretKey = Buffer.from(identity.secretKey, 'hex');

    const PLATFORM_URL = process.env.ATEL_PLATFORM || process.env.ATEL_REGISTRY || 'https://api.atelai.org';
    hubBase = process.env.ATEL_HUB_BASE || DEFAULT_BASE;

    // DID-signed request (same as platform DIDAuth expects)
    const { default: nacl } = await import('tweetnacl');
    const { serializePayload } = await import('@lawrenceliang-btc/atel-sdk');
    const ts = new Date().toISOString();
    const payload = { name };
    const signable = serializePayload({ payload, did, timestamp: ts });
    const sig = Buffer.from(nacl.sign.detached(Buffer.from(signable), secretKey)).toString('base64');
    const body = JSON.stringify({ did, payload, timestamp: ts, signature: sig });

    const res = await fetch(`${PLATFORM_URL}/account/v1/hub-key`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body,
    });
    if (!res.ok) {
      let msg = res.statusText;
      try { const e = await res.json(); msg = e.error || msg; } catch {}
      throw new Error(`Bootstrap failed: ${msg}`);
    }
    const data = await res.json();
    fullKey = data.key;
  } else {
    // Already have a key — create additional key via tokenhub directly
    const res = await hubFetch('/apikeys', {
      method: 'POST',
      body: JSON.stringify({ name }),
    });
    const data = await res.json();
    fullKey = data.key;
    const cfg = getConfig();
    hubBase = cfg.base;
  }

  console.log('API Key created:');
  console.log('  ' + fullKey);
  console.log('');
  console.log('This key will NOT be shown again. Save it securely.');
  console.log(`Saving to ${HUB_CONFIG_PATH} ...`);
  saveConfig(fullKey, hubBase || DEFAULT_BASE);
  console.log('Saved. You can now use atel hub commands.');
}

async function cmdHubKeyList() {
  const res = await hubFetch('/apikeys');
  const data = await res.json();
  const keys = data.keys || [];
  if (keys.length === 0) {
    console.log('No API keys found.');
    return;
  }
  console.log(`API Keys (${keys.length}):`);
  for (const k of keys) {
    const revoked = k.Revoked || k.revoked;
    const status = revoked ? '[revoked]' : '[active] ';
    const created = new Date(k.CreatedAt || k.created_at).toLocaleDateString();
    const id = k.ID || k.id;
    const prefix = k.KeyPrefix || k.key_prefix || '';
    const name = k.Name || k.name;
    console.log(`  ${status} id=${id}  prefix=${prefix}...  name=${name}  created=${created}`);
  }
}

async function cmdHubKeyRevoke(id) {
  if (!id) {
    console.error('Usage: atel hub key revoke <id>');
    process.exit(1);
  }
  await hubFetch(`/apikeys/${id}`, { method: 'DELETE' });
  console.log(`Key ${id} revoked successfully.`);
}

async function cmdHubKeyUse() {
  const cfg = getConfig();
  console.log(`export OPENAI_BASE_URL=${cfg.base}`);
  console.log(`export OPENAI_API_KEY=${cfg.key}`);
  console.log('');
  console.log('# Tip: eval $(atel hub key use) to apply in current shell');
}

async function cmdHubModels(flags) {
  const searchIdx = flags.indexOf('--search');
  const keyword = searchIdx !== -1 && flags[searchIdx + 1] ? flags[searchIdx + 1].toLowerCase() : '';
  const res = await hubFetch('/models');
  const data = await res.json();
  let models = data.models || [];
  if (keyword) {
    models = models.filter(m => m.model_id.toLowerCase().includes(keyword));
  }
  if (models.length === 0) {
    console.log('No models found.');
    return;
  }
  console.log(`Available Models (${models.length}):`);
  console.log('  Model ID                                          Rate      Cost/1M tokens');
  console.log('  ' + '-'.repeat(75));
  for (const m of models) {
    const rate = (m.multiplier_milli / 1000).toFixed(3) + 'x';
    const costUSD = '$' + (m.multiplier_milli / 10).toFixed(2);
    console.log(`  ${m.model_id.padEnd(50)}  ${rate.padStart(7)}  ${costUSD}`);
  }
}

async function cmdHubChat(model, prompt, flags) {
  if (!model || !prompt) {
    console.error('Usage: atel hub chat <model> "<prompt>" [--stream]');
    process.exit(1);
  }
  const stream = flags.includes('--stream');
  const cfg = getConfig();
  const body = JSON.stringify({
    model,
    messages: [{ role: 'user', content: prompt }],
    stream,
  });

  const res = await fetch(cfg.base + '/chat/completions', {
    method: 'POST',
    headers: {
      Authorization: 'Bearer ' + cfg.key,
      'Content-Type': 'application/json',
    },
    body,
  });

  if (!res.ok) {
    let errBody = {};
    try { errBody = await res.json(); } catch {}
    const msg = errBody?.error?.message || res.statusText;
    const code = errBody?.error?.code || 'ERROR';
    console.error(`[${code}] ${msg}`);
    if (errBody?.error?.action === 'topup') console.error('Run: atel hub topup');
    process.exit(1);
  }

  if (!stream) {
    const data = await res.json();
    const content = data?.choices?.[0]?.message?.content || '';
    console.log(content);
    if (data.usage) {
      const cost = res.headers.get('X-ATELToken-Cost');
      console.error(`\n[tokens: in=${data.usage.prompt_tokens} out=${data.usage.completion_tokens}${cost ? ' cost=' + cost : ''}]`);
    }
    return;
  }

  // Streaming: parse SSE
  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buf = '';
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    buf += decoder.decode(value, { stream: true });
    const lines = buf.split('\n');
    buf = lines.pop(); // keep incomplete line
    for (const line of lines) {
      if (!line.startsWith('data: ')) continue;
      const data = line.slice(6).trim();
      if (data === '[DONE]') { process.stdout.write('\n'); return; }
      try {
        const chunk = JSON.parse(data);
        const delta = chunk?.choices?.[0]?.delta?.content;
        if (delta) process.stdout.write(delta);
      } catch {}
    }
  }
}

// ─── New Commands ────────────────────────────────────────────────

function getPageFlags(flags) {
  const pageIdx = flags.indexOf('--page');
  const limitIdx = flags.indexOf('--limit');
  const page  = pageIdx  !== -1 && flags[pageIdx  + 1] ? parseInt(flags[pageIdx  + 1], 10) : 1;
  const limit = limitIdx !== -1 && flags[limitIdx + 1] ? parseInt(flags[limitIdx + 1], 10) : 20;
  return { page, limit };
}

async function cmdHubLedger(flags) {
  const { page, limit } = getPageFlags(flags);
  const res = await hubFetch(`/ledger?page=${page}&limit=${limit}`);
  const data = await res.json();
  const entries = data.entries || data.records || [];
  if (entries.length === 0) { console.log('No ledger records.'); return; }
  console.log(`Ledger (page ${page}, ${entries.length} records):`);
  console.log('  ' + 'Time'.padEnd(22) + 'Type'.padEnd(16) + 'Delta'.padStart(12) + '  Balance After');
  console.log('  ' + '-'.repeat(68));
  for (const e of entries) {
    const t = new Date(e.created_at).toLocaleString();
    const delta = (e.delta > 0 ? '+' : '') + e.delta.toLocaleString();
    console.log(`  ${t.padEnd(22)}${(e.entry_type||'').padEnd(16)}${delta.padStart(12)}  ${(e.balance_after||0).toLocaleString()}`);
  }
  if (data.total) console.log(`\nTotal: ${data.total} records`);
}

async function cmdHubDashboard() {
  const res = await hubFetch('/dashboard');
  const data = await res.json();
  console.log('Dashboard Summary:');
  console.log(`  Balance:       ${(data.balance||0).toLocaleString()} ATELToken`);
  console.log(`  USDC Equiv:    $${data.usdc_equiv||'0.00'}`);
  if (data.total_spent    != null) console.log(`  Total Spent:   ${data.total_spent.toLocaleString()} ATELToken`);
  if (data.total_earned   != null) console.log(`  Total Earned:  ${data.total_earned.toLocaleString()} ATELToken`);
  if (data.total_topup    != null) console.log(`  Total Topup:   $${data.total_topup}`);
  if (data.calls_today    != null) console.log(`  Calls Today:   ${data.calls_today}`);
  if (data.calls_30d      != null) console.log(`  Calls (30d):   ${data.calls_30d}`);
}

async function cmdHubSwapHistory(flags) {
  const { page, limit } = getPageFlags(flags);
  const res = await hubFetch(`/swap/history?page=${page}&limit=${limit}`);
  const data = await res.json();
  const records = data.records || data.swaps || [];
  if (records.length === 0) { console.log('No swap history.'); return; }
  console.log(`Swap History (page ${page}):`);
  console.log('  ' + 'Time'.padEnd(22) + 'Direction'.padEnd(20) + 'USDC'.padStart(10) + '  ATELToken');
  console.log('  ' + '-'.repeat(68));
  for (const s of records) {
    const t = new Date(s.created_at).toLocaleString();
    const dir = s.direction || 'usdc→token';
    console.log(`  ${t.padEnd(22)}${dir.padEnd(20)}${String(s.usdc_amount||'').padStart(10)}  ${s.token_amount||''}`);
  }
}

async function cmdHubTransfer(toDid, amount) {
  if (!toDid || !amount || isNaN(parseFloat(amount))) {
    console.error('Usage: atel hub transfer <to_did> <amount>');
    process.exit(1);
  }
  const res = await hubFetch('/transfer', {
    method: 'POST',
    body: JSON.stringify({ to_did: toDid, amount: parseInt(amount, 10) }),
  });
  const data = await res.json();
  console.log(`Transfer sent: ${data.amount||amount} ATELToken → ${toDid}`);
  if (data.balance_after != null) console.log(`Balance after: ${data.balance_after.toLocaleString()} ATELToken`);
}

async function cmdHubTransfers(flags) {
  const { page, limit } = getPageFlags(flags);
  const res = await hubFetch(`/transfers?page=${page}&limit=${limit}`);
  const data = await res.json();
  const records = data.records || data.transfers || [];
  if (records.length === 0) { console.log('No transfer history.'); return; }
  console.log(`Transfer History (page ${page}):`);
  console.log('  ' + 'Time'.padEnd(22) + 'From/To DID'.padEnd(40) + 'Amount'.padStart(10));
  console.log('  ' + '-'.repeat(74));
  for (const t of records) {
    const ts = new Date(t.created_at).toLocaleString();
    const peer = t.to_did || t.from_did || '';
    const dir  = t.to_did ? '→' : '←';
    console.log(`  ${ts.padEnd(22)}${(dir + ' ' + peer).padEnd(40)}${String(t.amount||'').padStart(10)}`);
  }
}

async function cmdHubStats() {
  const res = await hubFetch('/stats');
  const data = await res.json();
  console.log('ATEL Economy Stats:');
  if (data.total_accounts  != null) console.log(`  Total Accounts:    ${data.total_accounts.toLocaleString()}`);
  if (data.total_supply    != null) console.log(`  Total Supply:      ${data.total_supply.toLocaleString()} ATELToken`);
  if (data.total_calls     != null) console.log(`  Total API Calls:   ${data.total_calls.toLocaleString()}`);
  if (data.total_topup_usdc!= null) console.log(`  Total Topup USDC:  $${data.total_topup_usdc}`);
  if (data.token_per_usdc  != null) console.log(`  Rate:              1 USDC = ${data.token_per_usdc.toLocaleString()} ATELToken`);
}

// ─── Router ──────────────────────────────────────────────────────

export async function cmdHub(sub, args, rawArgs) {
  const flags = rawArgs || [];
  try {
    switch (sub) {
      case 'balance':      return await cmdHubBalance();
      case 'swap':         return await cmdHubSwap(args[0], flags);
      case 'swap-history': return await cmdHubSwapHistory(flags);
      case 'usage':        return await cmdHubUsage(flags);
      case 'ledger':       return await cmdHubLedger(flags);
      case 'dashboard':    return await cmdHubDashboard();
      case 'transfer':     return await cmdHubTransfer(args[0], args[1]);
      case 'transfers':    return await cmdHubTransfers(flags);
      case 'stats':        return await cmdHubStats();
      case 'topup':        return await cmdHubTopup();
      case 'models':       return await cmdHubModels(flags);
      case 'chat':         return await cmdHubChat(args[0], args[1], flags);
      case 'key': {
        const keySub = args[0];
        const keyFlags = flags;
        switch (keySub) {
          case 'create': return await cmdHubKeyCreate(keyFlags);
          case 'list':   return await cmdHubKeyList();
          case 'revoke': return await cmdHubKeyRevoke(args[1]);
          case 'use':    return await cmdHubKeyUse();
          default:
            console.log('Usage: atel hub key <create|list|revoke|use>');
            process.exit(1);
        }
        break;
      }
      default:
        console.log(`
atel hub — ATELToken management

Commands:
  atel hub balance                                       Show ATELToken balance
  atel hub dashboard                                     Dashboard summary
  atel hub usage [--model <id>] [--days 7] [--page N]    Usage history
  atel hub ledger [--page N] [--limit N]                 Ledger records
  atel hub topup                                         Show deposit addresses
  atel hub swap <amount> [--chain bsc|base]              Swap USDC → ATELToken
  atel hub swap-history [--page N] [--limit N]           Swap history
  atel hub transfer <to_did> <amount>                    Transfer ATELToken
  atel hub transfers [--page N] [--limit N]              Transfer history
  atel hub stats                                         Public economy stats
  atel hub models [--search <kw>]                        List available models
  atel hub chat <model> "<prompt>" [--stream]            Quick chat
  atel hub key create [--name <name>]                    Create API key
  atel hub key list                                      List API keys
  atel hub key revoke <id>                               Revoke a key
  atel hub key use                                       Output env vars
        `);
    }
  } catch (err) {
    console.error(err.message);
    if (err.hint) console.error(err.hint);
    process.exit(1);
  }
}

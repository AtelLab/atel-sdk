// hub-helpers.mjs — atel hub command implementation
// No new npm dependencies: uses native fetch, fs, crypto

import { existsSync, readFileSync, writeFileSync, mkdirSync } from 'fs';
import { join } from 'path';

const ATEL_DIR = process.env.ATEL_DIR || join(process.env.HOME || '/root', '.atel');
const HUB_CONFIG_PATH = join(ATEL_DIR, 'hub.json');
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
  const dir = ATEL_DIR;
  mkdirSync(dir, { recursive: true, mode: 0o700 });
  writeFileSync(
    HUB_CONFIG_PATH,
    JSON.stringify({ key, base: base || DEFAULT_BASE }),
    { mode: 0o600 }
  );
}

function hasFlag(flags, name) {
  return flags.includes(name);
}

function getFlagValue(flags, name) {
  const idx = flags.indexOf(name);
  if (idx === -1) return '';
  const val = flags[idx + 1];
  if (!val || val.startsWith('--')) return '';
  return val;
}

function getIntFlag(flags, name, fallback) {
  const raw = getFlagValue(flags, name);
  if (!raw) return fallback;
  const v = parseInt(raw, 10);
  return Number.isFinite(v) && v > 0 ? v : fallback;
}

function formatTokenAmount(v) {
  const n = Number(v);
  if (!Number.isFinite(n)) return String(v ?? '');
  return n.toLocaleString();
}

function formatMoney(v) {
  const n = Number(v);
  if (!Number.isFinite(n)) return String(v ?? '');
  return n.toFixed(6);
}

function buildQuery(params) {
  const q = new URLSearchParams();
  Object.entries(params).forEach(([k, v]) => {
    if (v !== undefined && v !== null && v !== '') q.set(k, String(v));
  });
  const s = q.toString();
  return s ? `?${s}` : '';
}

function printObjectAsLines(data) {
  for (const [k, v] of Object.entries(data || {})) {
    if (Array.isArray(v)) continue;
    if (v && typeof v === 'object') continue;
    console.log(`${k}: ${v}`);
  }
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
      err.hint = 'Top up your balance via platform deposit/swap or contact your platform admin.';
    }
    throw err;
  }
  return res;
}

// ─── Commands ────────────────────────────────────────────────────

async function cmdHubSwap(usdcAmount, flags) {
  if (!usdcAmount || isNaN(parseFloat(usdcAmount))) {
    console.error('Usage: atel hub swap <amount> [--chain bsc|base] [--direction usdc_to_token|token_to_usdc]');
    console.error('Example: atel hub swap 1.0 --chain bsc');
    console.error('Example: atel hub swap 10000 --direction token_to_usdc');
    process.exit(1);
  }
  const amount = parseFloat(usdcAmount);
  const chain = getFlagValue(flags, '--chain') || 'bsc';
  const direction = getFlagValue(flags, '--direction') || 'usdc_to_token';

  if (direction !== 'usdc_to_token' && direction !== 'token_to_usdc') {
    console.error('Invalid --direction. Expected usdc_to_token or token_to_usdc');
    process.exit(1);
  }

  if (direction === 'token_to_usdc') {
    const tokenAmount = Math.round(amount);
    if (!Number.isFinite(tokenAmount) || tokenAmount <= 0) {
      console.error('Invalid token amount. Must be > 0.');
      process.exit(1);
    }
    const res = await hubFetch('/swap', {
      method: 'POST',
      body: JSON.stringify({
        direction: 'token_to_usdc',
        token_amount: tokenAmount,
      }),
    });
    const data = await res.json();
    console.log('✓ Swap successful');
    console.log(`  Direction:       token_to_usdc`);
    console.log(`  ATELToken spent: ${formatTokenAmount(data.token_amount ?? tokenAmount)}`);
    if (data.usdc_micro !== undefined) {
      console.log(`  USDC received:   $${(Number(data.usdc_micro) / 1_000_000).toFixed(6)}`);
    }
    if (data.rate !== undefined) {
      console.log(`  Rate:            1 USDC = ${formatTokenAmount(data.rate)} ATEL`);
    }
    if (data.balance_after !== undefined) {
      console.log(`  Token balance after: ${formatTokenAmount(data.balance_after)}`);
    }
    return;
  }

  // swap via platform (not tokenhub)
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
  const model = getFlagValue(flags, '--model');
  if (model) params.set('model', model);
  const daysRaw = getFlagValue(flags, '--days');
  if (daysRaw) {
    const days = parseInt(daysRaw, 10);
    if (!Number.isFinite(days) || days <= 0) {
      console.error('Invalid --days value. Must be a positive integer.');
      process.exit(1);
    }
    const start = new Date(Date.now() - days * 86400000).toISOString().slice(0, 10);
    params.set('start', start);
  }
  params.set('page', String(getIntFlag(flags, '--page', 1)));
  params.set('limit', String(getIntFlag(flags, '--limit', 20)));
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

async function cmdHubLedger(flags) {
  const page = getIntFlag(flags, '--page', 1);
  const limit = getIntFlag(flags, '--limit', 20);
  const res = await hubFetch('/ledger' + buildQuery({ page, limit }));
  const data = await res.json();
  if (hasFlag(flags, '--json')) {
    console.log(JSON.stringify(data, null, 2));
    return;
  }
  const items = data.items || data.ledger || data.records || [];
  if (!Array.isArray(items) || items.length === 0) {
    console.log('Ledger is empty.');
    printObjectAsLines(data);
    return;
  }
  console.log(`Ledger (${items.length} items):`);
  for (const item of items) {
    const t = item.created_at || item.time || item.timestamp || '';
    const type = item.type || item.direction || item.kind || '';
    const amount = item.amount ?? item.token_amount ?? item.delta ?? '';
    const memo = item.memo || item.note || '';
    console.log(`  ${t}  ${type}  amount=${amount}${memo ? `  memo=${memo}` : ''}`);
  }
}

async function cmdHubDashboard(flags) {
  const res = await hubFetch('/dashboard');
  const data = await res.json();
  if (hasFlag(flags, '--json')) {
    console.log(JSON.stringify(data, null, 2));
    return;
  }
  console.log('TokenHub Dashboard');
  if (data.balance !== undefined) console.log(`  Balance:      ${formatTokenAmount(data.balance)} ATEL`);
  if (data.total_spent !== undefined) console.log(`  Total spent:  ${formatTokenAmount(data.total_spent)} ATEL`);
  if (data.total_topup !== undefined) console.log(`  Total topup:  ${formatTokenAmount(data.total_topup)} ATEL`);
  if (data.usdc_equiv !== undefined) console.log(`  USDC equiv:   $${data.usdc_equiv}`);
  if (Object.keys(data).length > 0) {
    const known = new Set(['balance', 'total_spent', 'total_topup', 'usdc_equiv']);
    const extra = Object.fromEntries(Object.entries(data).filter(([k]) => !known.has(k)));
    if (Object.keys(extra).length > 0) {
      console.log('');
      printObjectAsLines(extra);
    }
  }
}

async function cmdHubSwapHistory(flags) {
  const page = getIntFlag(flags, '--page', 1);
  const limit = getIntFlag(flags, '--limit', 20);
  const res = await hubFetch('/swap/history' + buildQuery({ page, limit }));
  const data = await res.json();
  if (hasFlag(flags, '--json')) {
    console.log(JSON.stringify(data, null, 2));
    return;
  }
  const items = data.items || data.history || data.records || [];
  if (!Array.isArray(items) || items.length === 0) {
    console.log('No swap history found.');
    return;
  }
  console.log(`Swap History (${items.length}):`);
  for (const item of items) {
    const t = item.created_at || item.time || '';
    const direction = item.direction || '';
    const tokenAmount = item.token_amount ?? '';
    const usdcMicro = item.usdc_micro;
    const usdc = usdcMicro !== undefined ? Number(usdcMicro) / 1_000_000 : undefined;
    console.log(
      `  ${t}  ${direction}  token=${formatTokenAmount(tokenAmount)}${usdc !== undefined ? `  usdc=$${formatMoney(usdc)}` : ''}`
    );
  }
}

async function cmdHubKeyCreate(flags) {
  const nameIdx = flags.indexOf('--name');
  const name = nameIdx !== -1 && flags[nameIdx + 1] ? flags[nameIdx + 1] : 'default';
  const res = await hubFetch('/apikeys', {
    method: 'POST',
    body: JSON.stringify({ name }),
  });
  const data = await res.json();
  console.log('API Key created:');
  console.log('  ' + data.key);
  console.log('');
  console.log('This key will NOT be shown again. Save it securely.');
  console.log('Saving to ~/.atel/hub.json ...');
  const cfg = getConfig();
  saveConfig(data.key, cfg.base);
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
  const keyword = (getFlagValue(flags, '--search') || '').toLowerCase();
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
    if (errBody?.error?.action === 'topup') {
      console.error('Top up your balance via platform deposit/swap or contact your platform admin.');
    }
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

async function cmdHubTransfer(toDid, amountRaw, flags) {
  if (!toDid || !amountRaw) {
    console.error('Usage: atel hub transfer <to_did> <amount> [--memo "text"] [--idempotency-key <key>]');
    process.exit(1);
  }
  const amount = Number(amountRaw);
  if (!Number.isInteger(amount) || amount <= 0) {
    console.error('Amount must be a positive integer token amount.');
    process.exit(1);
  }
  const memo = getFlagValue(flags, '--memo');
  const idempotencyKey = getFlagValue(flags, '--idempotency-key');
  const body = {
    to_did: toDid,
    amount,
  };
  if (memo) body.memo = memo;
  if (idempotencyKey) body.idempotency_key = idempotencyKey;

  const res = await hubFetch('/transfer', {
    method: 'POST',
    body: JSON.stringify(body),
  });
  const data = await res.json();
  console.log('✓ Transfer successful');
  console.log(`  Transfer ID: ${data.transfer_id || data.id || '(unknown)'}`);
  console.log(`  To DID:      ${data.to_did || toDid}`);
  console.log(`  Amount:      ${formatTokenAmount(data.amount ?? amount)} ATEL`);
}

async function cmdHubTransfers(flags) {
  const page = getIntFlag(flags, '--page', 1);
  const limit = getIntFlag(flags, '--limit', 20);
  const res = await hubFetch('/transfers' + buildQuery({ page, limit }));
  const data = await res.json();
  if (hasFlag(flags, '--json')) {
    console.log(JSON.stringify(data, null, 2));
    return;
  }
  const items = data.items || data.transfers || data.records || [];
  if (!Array.isArray(items) || items.length === 0) {
    console.log('No transfer records found.');
    return;
  }
  console.log(`Transfers (${items.length}):`);
  for (const item of items) {
    const t = item.created_at || item.time || '';
    const fromDid = item.from_did || item.from || '';
    const toDid = item.to_did || item.to || '';
    const amount = item.amount ?? '';
    console.log(`  ${t}  ${formatTokenAmount(amount)} ATEL  ${fromDid} -> ${toDid}`);
  }
}

async function cmdHubStats(flags) {
  let cfg;
  try {
    cfg = getConfig();
  } catch {
    cfg = { base: process.env.ATEL_HUB_BASE || DEFAULT_BASE };
  }
  const res = await fetch(cfg.base + '/stats', {
    headers: cfg.key ? { Authorization: 'Bearer ' + cfg.key } : {},
  });
  if (!res.ok) {
    let errBody = {};
    try { errBody = await res.json(); } catch {}
    const code = errBody?.error?.code || 'ERROR';
    const msg = errBody?.error?.message || res.statusText;
    throw new Error(`[${code}] ${msg}`);
  }
  const data = await res.json();
  if (hasFlag(flags, '--json')) {
    console.log(JSON.stringify(data, null, 2));
    return;
  }
  console.log('TokenHub Public Stats');
  printObjectAsLines(data);
}

// ─── Router ──────────────────────────────────────────────────────

export async function cmdHub(sub, args, rawArgs) {
  const flags = rawArgs || [];
  try {
    switch (sub) {
      case 'balance': return await cmdHubBalance();
      case 'swap':    return await cmdHubSwap(args[0], flags);
      case 'swap-history': return await cmdHubSwapHistory(flags);
      case 'usage':   return await cmdHubUsage(flags);
      case 'ledger':  return await cmdHubLedger(flags);
      case 'dashboard': return await cmdHubDashboard(flags);
      case 'models':  return await cmdHubModels(flags);
      case 'chat':    return await cmdHubChat(args[0], args[1], flags);
      case 'transfer': return await cmdHubTransfer(args[0], args[1], flags);
      case 'transfers': return await cmdHubTransfers(flags);
      case 'stats':   return await cmdHubStats(flags);
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
  atel hub balance                          Show ATELToken balance
  atel hub usage [--model <id>] [--days 7] [--page 1] [--limit 20]
                                             Usage history
  atel hub ledger [--page 1] [--limit 20] [--json]
                                             Ledger records
  atel hub dashboard [--json]                Dashboard summary
  atel hub swap <amount> [--chain bsc|base] [--direction usdc_to_token|token_to_usdc]
                                             Swap USDC ↔ ATELToken
  atel hub swap-history [--page 1] [--limit 20] [--json]
                                             Swap history
  atel hub transfer <to_did> <amount> [--memo "text"] [--idempotency-key <key>]
                                             Transfer token to another DID
  atel hub transfers [--page 1] [--limit 20] [--json]
                                             Transfer history
  atel hub models [--search <kw>]           List available models
  atel hub chat <model> "<prompt>" [--stream] Quick chat
  atel hub stats [--json]                   Public economy stats
  atel hub key create [--name <name>]       Create API key
  atel hub key list                         List API keys
  atel hub key revoke <id>                  Revoke a key
  atel hub key use                          Output env vars for external tools
        `);
    }
  } catch (err) {
    console.error(err.message);
    if (err.hint) console.error(err.hint);
    process.exit(1);
  }
}

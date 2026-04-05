// hub-helpers.mjs — atel hub command implementation
// No new npm dependencies: uses native fetch, fs, crypto

import { existsSync, readFileSync, writeFileSync, mkdirSync } from 'fs';
import { join } from 'path';
import { createReadStream } from 'fs';

const MISSING_PLATFORM_DID_GUIDANCE = [
  'This identity does not have a registered platform DID yet.',
  'Agent action required:',
  '1) Register this identity on the ATEL platform.',
  '2) Confirm the DID was created in the platform registry.',
  '3) Create or load a hub API key for this DID.',
  '4) Retry the hub request.',
  '',
  'Suggested command:',
  '  atel register "<agent-name>" "general" "<endpoint>"',
].join('\n');

const ATEL_DIR = process.env.ATEL_DIR || join(process.env.HOME || '/root', '.atel');
const HUB_CONFIG_PATH = join(ATEL_DIR, 'hub.json');
const DEFAULT_BASE = 'https://api.atelai.org/tokenhub/v1';

function getHubConfigPath() {
  return HUB_CONFIG_PATH;
}

function formatHubConfigUpgradeGuidance(missing) {
  const fieldList = missing.join(', ');
  return [
    `Invalid hub config at ${HUB_CONFIG_PATH}. Missing required field(s): ${fieldList}.`,
    'This usually means hub.json was created by an older SDK and needs to be upgraded.',
    'Agent action required:',
    '1) Register identity if this agent is not registered yet: atel register "<agent-name>" "general" "<endpoint>"',
    '2) Confirm the DID exists on platform.',
    '3) Recreate hub credentials: atel hub key create',
    '4) Retry the hub command.',
  ].join('\n');
}

function readHubConfig(requiredFields = []) {
  if (!existsSync(HUB_CONFIG_PATH)) {
    throw new Error(`No hub API key configured at ${HUB_CONFIG_PATH}. Run: atel hub key create`);
  }
  let cfg;
  try {
    cfg = JSON.parse(readFileSync(HUB_CONFIG_PATH, 'utf-8'));
  } catch {
    throw new Error(`Corrupted hub config at ${HUB_CONFIG_PATH}. Recreate it with: atel hub key create`);
  }
  if (!cfg || typeof cfg !== 'object' || Array.isArray(cfg)) {
    throw new Error(`Invalid hub config at ${HUB_CONFIG_PATH}. Expected a JSON object.`);
  }
  const missing = requiredFields.filter((field) => !cfg[field]);
  if (missing.length > 0) {
    throw new Error(formatHubConfigUpgradeGuidance(missing));
  }
  return cfg;
}


// ─── Config ──────────────────────────────────────────────────────

function getConfig() {
  const envKey = process.env.ATEL_HUB_KEY;
  const envBase = process.env.ATEL_HUB_BASE || DEFAULT_BASE;
  if (envKey) return { key: envKey, base: envBase };
  return readHubConfig(['key', 'base']);
}

function saveConfig(key, base, extras = {}) {
  mkdirSync(ATEL_DIR, { recursive: true, mode: 0o700 });
  const existing = existsSync(HUB_CONFIG_PATH) ? (JSON.parse(readFileSync(HUB_CONFIG_PATH, "utf-8")) || {}) : {};
  const next = { ...existing, ...extras, key, base: base || DEFAULT_BASE };
  writeFileSync(
    HUB_CONFIG_PATH,
    JSON.stringify(next),
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
    const errorBody = errBody?.error || {};
    const code = errorBody?.code || errBody?.code || 'ERROR';
    const msg = errorBody?.message || errBody?.message || res.statusText;
    const err = new Error(`[${code}] ${msg}`);
    err.httpStatus = res.status;
    err.code = code;
    if (errorBody?.action === 'topup') {
      err.hint = 'Run: atel swap usdc <amount> to add ATELToken';
    }
    if (code === 'PLATFORM_DID_NOT_REGISTERED') {
      err.hint = MISSING_PLATFORM_DID_GUIDANCE;
    }
    throw err;
  }
  return res;
}

// ─── Commands ────────────────────────────────────────────────────

async function cmdHubSwap(direction, amountStr, flags) {
  // direction: 'usdc' or 'token'
  // hub swap usdc 0.01 --chain bsc   → USDC → ATELToken
  // hub swap token 100 --chain bsc   → ATELToken → USDC
  if (!direction || !['usdc', 'token'].includes(direction.toLowerCase())) {
    console.error('Usage:');
    console.error('  atel hub swap usdc <amount> [--chain bsc|base]   Swap USDC → ATELToken');
    console.error('  atel hub swap token <amount> [--chain bsc|base]  Swap ATELToken → USDC');
    console.error('Example:');
    console.error('  atel hub swap usdc 0.01 --chain bsc');
    console.error('  atel hub swap token 100 --chain bsc');
    process.exit(1);
  }
  if (!amountStr || isNaN(parseFloat(amountStr))) {
    console.error(`Usage: atel hub swap ${direction} <amount> [--chain bsc|base]`);
    process.exit(1);
  }
  const amount = parseFloat(amountStr);
  const chain = flags.chain || 'bsc';
  const dir = direction.toLowerCase();

  const { loadIdentity, signPayload: _sp } = await import('./atel.mjs').catch(() => ({}));
  // fallback: load identity manually
  const fs = await import('fs');
  const nacl = await import('tweetnacl');
  const path = await import('path');
  const os = await import('os');
  const HUB_CONFIG_PATH = getHubConfigPath();
  let hubCfg;
  try { hubCfg = readHubConfig(['did', 'secretKey', 'platform']); } catch (e) {
    console.error(e.message); process.exit(1);
  }
  const did = hubCfg.did;
  const secretKey = Buffer.from(hubCfg.secretKey, 'hex');
  const PLATFORM_URL = process.env.ATEL_PLATFORM || hubCfg.platform || 'https://api.atelai.org';

  function sortObj(x) {
    if (Array.isArray(x)) return x.map(sortObj);
    if (x && typeof x === 'object') { const o = {}; for (const k of Object.keys(x).sort()) o[k] = sortObj(x[k]); return o; }
    return x;
  }
  // Unified payload: from=usdc|token, amount, chain
  const payload = { from: dir, amount, chain };
  const timestamp = new Date().toISOString();
  const sigInput = JSON.stringify(sortObj({ did, payload, timestamp }));
  const signature = Buffer.from(nacl.default.sign.detached(Buffer.from(sigInput), secretKey)).toString('base64');

  const endpoint = '/account/v1/swap'; // unified endpoint, from/to determines direction
  const res = await fetch(PLATFORM_URL + endpoint, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ did, payload, timestamp, signature }),
    signal: AbortSignal.timeout(120000),
  });
  const data = await res.json();
  if (!res.ok || data.error) {
    console.error('Swap failed:', data.error || JSON.stringify(data));
    process.exit(1);
  }
  const status = String(data.status || '').toLowerCase();
  const pendingVerification = status === 'pending_verification' || status === 'pending';
  if (dir === 'usdc') {
    console.log(`${pendingVerification ? '↺' : '✓'} Swap ${pendingVerification ? 'submitted' : 'successful'} (USDC → ATELToken)`);
    console.log(`  USDC spent:          $${amount.toFixed(6)}`);
    console.log(`  ATELToken expected:  ${(data.token_amount||0).toLocaleString()}`);
    console.log(`  Settlement tx:       ${data.settlement_tx_hash || 'N/A'}`);
    console.log(`  Status:              ${data.status}`);
  } else {
    console.log(`${pendingVerification ? '↺' : '✓'} Swap ${pendingVerification ? 'submitted' : 'successful'} (ATELToken → USDC)`);
    console.log(`  ATELToken spent:     ${amount.toLocaleString()}`);
    console.log(`  USDC expected:       $${parseFloat(data.usdc_amount||0).toFixed(6)}`);
    console.log(`  Settlement tx:       ${data.settlement_tx_hash || 'N/A'}`);
    console.log(`  Status:              ${data.status}`);
  }
  if (pendingVerification) {
    console.log(`  Note:                ${data.note || 'Accounting will update after on-chain verification.'}`);
    console.log('');
    console.log('Run `atel hub swap-history --limit 5` to monitor settlement status.');
    return;
  }
  console.log('');
  console.log('Run `atel hub balance` to review updated balances.');
}

async function cmdHubBalance() {
  // Query platform for both USDC and ATELToken balance
  const cfg = getConfig();
  const fs = await import('fs');
  const path = await import('path');
  const os = await import('os');
  const HUB_CONFIG_PATH = getHubConfigPath();
  let hubCfg;
  try { hubCfg = readHubConfig(['did', 'secretKey', 'platform']); } catch (e) {
    console.error(e.message); process.exit(1);
  }
  const did = hubCfg.did;
  const nacl = await import('tweetnacl');
  const secretKey = Buffer.from(hubCfg.secretKey, 'hex');
  const PLATFORM_URL = process.env.ATEL_PLATFORM || hubCfg.platform || 'https://api.atelai.org';
  function sortObj(x) {
    if (Array.isArray(x)) return x.map(sortObj);
    if (x && typeof x === 'object') { const o = {}; for (const k of Object.keys(x).sort()) o[k] = sortObj(x[k]); return o; }
    return x;
  }
  const payload = {};
  const timestamp = new Date().toISOString();
  const sigInput = JSON.stringify(sortObj({ did, payload, timestamp }));
  const signature = Buffer.from(nacl.default.sign.detached(Buffer.from(sigInput), secretKey)).toString('base64');
  const res = await fetch(PLATFORM_URL + '/account/v1/balance', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ did, payload, timestamp, signature }),
    signal: AbortSignal.timeout(15000),
  });
  const data = await res.json();
  if (!res.ok) { console.error('Balance fetch failed:', data.error || JSON.stringify(data)); process.exit(1); }
  console.log(`USDC Balance:      $${(data.balance || 0).toFixed(6)}`);
  console.log(`ATELToken Balance: ${(data.token_balance || 0).toLocaleString()} ATEL`);
  const tokenPerUSDC = 10000;
  console.log(`USDC Equivalent:   $${((data.token_balance || 0) / tokenPerUSDC).toFixed(6)}`);
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


async function createHubKeyViaDidBootstrap(name) {
  const { readFileSync } = await import('fs');
  const nacl = await import('tweetnacl');
  const idPath = join(ATEL_DIR, 'identity.json');
  if (!existsSync(idPath)) {
    console.error('No identity. Run: atel init');
    process.exit(1);
  }
  const identity = JSON.parse(readFileSync(idPath, 'utf-8'));
  const did = identity.did;
  const secretKeyHex = identity.secretKey;
  const secretKey = Buffer.from(secretKeyHex, 'hex');
  const platformBase = process.env.ATEL_PLATFORM || process.env.ATEL_API || process.env.ATEL_REGISTRY || 'https://api.atelai.org';
  const timestamp = new Date().toISOString();
  const payload = { name };
  const signInput = JSON.stringify({ did, payload, timestamp });
  const signature = Buffer.from(nacl.default.sign.detached(Buffer.from(signInput), secretKey)).toString('base64');
  const body = JSON.stringify({ did, payload, timestamp, signature });
  const res = await fetch(platformBase + '/tokenhub/internal/apikeys', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body,
    signal: AbortSignal.timeout(30000),
  });
  const data = await res.json();
  const base = data.base || process.env.ATEL_HUB_BASE || DEFAULT_BASE;
  if (!res.ok || data.error) {
    const errCode = data?.error?.code || data?.code || data?.error_code;
    const errMsg = data?.error?.message || data?.message || (typeof data?.error === 'string' ? data.error : JSON.stringify(data));
    console.error('Hub key bootstrap failed:', errMsg);
    if (errCode === 'PLATFORM_DID_NOT_REGISTERED') {
      console.error('');
      console.error(MISSING_PLATFORM_DID_GUIDANCE);
    }
    process.exit(1);
  }
  return { data, base };
}

async function cmdHubKeyCreate(flags) {
  const nameIdx = flags.indexOf('--name');
  const name = nameIdx !== -1 && flags[nameIdx + 1] ? flags[nameIdx + 1] : 'default';

  let data;
  let base = process.env.ATEL_HUB_BASE || DEFAULT_BASE;
  let usedBootstrap = false;

  if (existsSync(HUB_CONFIG_PATH)) {
    try {
      const res = await hubFetch('/apikeys', {
        method: 'POST',
        body: JSON.stringify({ name }),
      });
      data = await res.json();
      base = data.base || getConfig().base || base;
    } catch (err) {
      const code = err?.code || '';
      const message = String(err?.message || '');
      const shouldFallback = code === 'INVALID_API_KEY' || /invalid or revoked api key/i.test(message) || /unauthorized/i.test(message);
      if (!shouldFallback) throw err;
      ({ data, base } = await createHubKeyViaDidBootstrap(name));
      usedBootstrap = true;
    }
  } else {
    ({ data, base } = await createHubKeyViaDidBootstrap(name));
    usedBootstrap = true;
  }

  console.log('TokenHub API key created:');
  console.log('  ' + data.key);
  console.log('');
  console.log('The full secret is shown only once. Save it in a secure secrets manager.');
  if (usedBootstrap) {
    console.log('Bootstrap path: DID-signed platform bootstrap was used.');
  }
  console.log(`Saving to ${HUB_CONFIG_PATH} ...`);
  const identityPath = join(ATEL_DIR, 'identity.json');
  let extras = {};
  if (existsSync(identityPath)) {
    try {
      const identity = JSON.parse(readFileSync(identityPath, "utf-8"));
      extras = { did: identity.did, secretKey: identity.secretKey, platform: process.env.ATEL_PLATFORM || process.env.ATEL_API || process.env.ATEL_REGISTRY || "https://api.atelai.org" };
    } catch {}
  }
  saveConfig(data.key, base, extras);
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
  let models = data.models || data.data || [];
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
    if (errBody?.error?.action === 'topup') console.error('Run: atel swap usdc <amount> to add ATELToken');
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
  const pageIdx  = flags.indexOf('--page');
  const limitIdx = flags.indexOf('--limit');
  const page  = pageIdx  !== -1 && flags[pageIdx  + 1] ? parseInt(flags[pageIdx  + 1], 10) : 1;
  const limit = limitIdx !== -1 && flags[limitIdx + 1] ? parseInt(flags[limitIdx + 1], 10) : 20;
  return { page, limit };
}

async function cmdHubLedger(flags) {
  // Ledger is now served by platform /account/v1/transactions
  const { page, limit } = getPageFlags(flags);
  const cfg = getConfig();
  const fs = await import('fs');
  const path = await import('path');
  const os = await import('os');
  const HUB_CONFIG_PATH = getHubConfigPath();
  let hubCfg;
  try { hubCfg = readHubConfig(['did', 'secretKey', 'platform']); } catch (e) {
    console.error(e.message); process.exit(1);
  }
  const did = hubCfg.did;
  const nacl = await import('tweetnacl');
  const secretKey = Buffer.from(hubCfg.secretKey, 'hex');
  const PLATFORM_URL = process.env.ATEL_PLATFORM || hubCfg.platform || 'https://api.atelai.org';
  function sortObj(x) {
    if (Array.isArray(x)) return x.map(sortObj);
    if (x && typeof x === 'object') { const o = {}; for (const k of Object.keys(x).sort()) o[k] = sortObj(x[k]); return o; }
    return x;
  }
  const payload = { page, limit };
  const timestamp = new Date().toISOString();
  const sigInput = JSON.stringify(sortObj({ did, payload, timestamp }));
  const signature = Buffer.from(nacl.default.sign.detached(Buffer.from(sigInput), secretKey)).toString('base64');
  const res = await fetch(PLATFORM_URL + '/account/v1/transactions', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ did, payload, timestamp, signature }),
    signal: AbortSignal.timeout(15000),
  });
  const data = await res.json();
  if (!res.ok) { console.error('Ledger fetch failed:', data.error || JSON.stringify(data)); process.exit(1); }
  const entries = data.transactions || data.records || [];
  if (entries.length === 0) { console.log('No ledger records.'); return; }
  console.log(`Ledger (page ${page}, ${entries.length} records):`);
  console.log('  ' + 'Time'.padEnd(22) + 'Type'.padEnd(16) + 'Amount'.padStart(12) + '  Status');
  console.log('  ' + '-'.repeat(68));
  for (const e of entries) {
    const t = new Date(e.created_at || e.createdAt).toLocaleString();
    console.log(`  ${t.padEnd(22)}${(e.type||'').padEnd(16)}${String(e.amount||'').padStart(12)}  ${e.status||''}`);
  }
  if (data.total) console.log(`\nTotal: ${data.total} records`);
}

async function cmdHubDashboard() {
  const res = await hubFetch('/dashboard');
  const data = await res.json();
  console.log('Dashboard Summary:');
  const dashBal = data.balance ?? 0;
  const dashUSDC = data.usdc_equiv ?? ((dashBal || 0) / 10000).toFixed(4);
  console.log(`  Balance:       ${dashBal.toLocaleString()} ATELToken`);
  console.log(`  USDC Equiv:    $${dashUSDC}`);
  if (data.total_debited  != null) console.log(`  Total Debited: ${data.total_debited.toLocaleString()} ATELToken`);
  else if (data.total_spent  != null) console.log(`  Total Debited: ${data.total_spent.toLocaleString()} ATELToken`);
  if (data.total_credited != null) console.log(`  Total Credited:${data.total_credited.toLocaleString()} ATELToken`);
  else if (data.total_earned != null) console.log(`  Total Credited:${data.total_earned.toLocaleString()} ATELToken`);
  if (data.total_topup  != null) console.log(`  Total Topup:   ${data.total_topup.toLocaleString()} ATELToken`);
  if (data.calls_today  != null) console.log(`  Calls Today:   ${data.calls_today}`);
  if (data.calls_30d    != null) console.log(`  Calls (30d):   ${data.calls_30d}`);
}

async function cmdHubSwapHistory(flags) {
  // Swap history from platform /account/v1/transactions (type=swap or swap_reverse)
  const { page, limit } = getPageFlags(flags);
  const fs = await import('fs');
  const path = await import('path');
  const os = await import('os');
  const HUB_CONFIG_PATH = getHubConfigPath();
  let hubCfg;
  try { hubCfg = readHubConfig(['did', 'secretKey', 'platform']); } catch (e) {
    console.error(e.message); process.exit(1);
  }
  const did = hubCfg.did;
  const nacl = await import('tweetnacl');
  const secretKey = Buffer.from(hubCfg.secretKey, 'hex');
  const PLATFORM_URL = process.env.ATEL_PLATFORM || hubCfg.platform || 'https://api.atelai.org';
  function sortObj(x) {
    if (Array.isArray(x)) return x.map(sortObj);
    if (x && typeof x === 'object') { const o = {}; for (const k of Object.keys(x).sort()) o[k] = sortObj(x[k]); return o; }
    return x;
  }
  const payload = { page, limit, type: 'swap' };
  const timestamp = new Date().toISOString();
  const sigInput = JSON.stringify(sortObj({ did, payload, timestamp }));
  const signature = Buffer.from(nacl.default.sign.detached(Buffer.from(sigInput), secretKey)).toString('base64');
  const res = await fetch(PLATFORM_URL + '/account/v1/transactions', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ did, payload, timestamp, signature }),
    signal: AbortSignal.timeout(15000),
  });
  const data = await res.json();
  if (!res.ok) { console.error('Swap history fetch failed:', data.error || JSON.stringify(data)); process.exit(1); }
  const records = (data.transactions || data.records || []).filter(r => r.type === 'swap' || r.type === 'swap_reverse');
  if (records.length === 0) { console.log('No swap history.'); return; }
  console.log(`Swap History (page ${page}):`);
  console.log('  ' + 'Time'.padEnd(22) + 'Type'.padEnd(16) + 'Amount'.padStart(12) + '  Status');
  console.log('  ' + '-'.repeat(68));
  for (const s of records) {
    const t = new Date(s.created_at || s.createdAt || s.createdat).toLocaleString();
    const dir = s.type === 'swap_reverse' ? 'token→usdc' : 'usdc→token';
    console.log(`  ${t.padEnd(22)}${dir.padEnd(16)}${String(s.amount||'').padStart(12)}  ${s.status||''}`);
  }
}


async function cmdHubStats() {
  const res = await hubFetch('/stats');
  const data = await res.json();
  const bal = data.balance || {};
  const overall = data.overall || {};
  console.log('Usage Stats (24h):');
  console.log(`  Balance:         ${(bal.balance||0).toLocaleString()} ATELToken ($${bal.balance_usdc||0})`);
  if (overall.total_requests != null) console.log(`  Total Requests:  ${overall.total_requests}`);
  if (overall.total_cost_token != null) console.log(`  Total Cost:      ${overall.total_cost_token.toLocaleString()} ATELToken ($${overall.total_cost_usdc||0})`);
  if (overall.today_requests != null)   console.log(`  Today Requests:  ${overall.today_requests}`);
  if (overall.today_cost_token != null) console.log(`  Today Cost:      ${overall.today_cost_token.toLocaleString()} ATELToken`);
  const breakdown = data.model_breakdown || [];
  if (breakdown.length > 0) {
    console.log('\n  Model Breakdown:');
    for (const m of breakdown) {
      console.log(`    ${m.model_id.padEnd(40)} ${m.requests} reqs  ${m.cost_token} token (${m.cost_pct}%)`);
    }
  }
}

// ─── Router ──────────────────────────────────────────────────────

export async function cmdHub(sub, args, rawArgs) {
  const flags = rawArgs || [];
  try {
    switch (sub) {
      case 'balance':      return await cmdHubBalance();
      case 'dashboard':    return await cmdHubDashboard();
      case 'usage':        return await cmdHubUsage(flags);
      case 'ledger':       return await cmdHubLedger(flags);
      case 'swap':         return await cmdHubSwap(args[0], args[1], flags);
      case 'swap-history': return await cmdHubSwapHistory(flags);
      case 'stats':        return await cmdHubStats();
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
            console.log('Usage: atel key <create|list|revoke|use>');
            console.log('   or: atel hub key <create|list|revoke|use>');
            process.exit(1);
        }
        break;
      }
      default:
        console.log(`
atel hub -- AI model access (TokenHub)

Commands:
  atel key create [--name <name>]                        Create and save a TokenHub API key
  atel key list                                          List TokenHub API keys
  atel key revoke <id>                                   Revoke a TokenHub API key
  atel key use                                           Print OpenAI-compatible env exports

  atel hub balance                                       Show USDC and ATELToken balances
  atel hub dashboard                                     Show a compact TokenHub account summary
  atel hub usage [--model <id>] [--days 7] [--page N]    Show model usage history
  atel hub ledger [--page N] [--limit N]                 Show account transaction records
  atel hub swap-history [--page N] [--limit N]           Show swap records
  atel hub stats                                         Show public TokenHub statistics
  atel hub models [--search <kw>]                        List available models
  atel hub chat <model> "<prompt>" [--stream]            Send a quick chat request
  atel hub key create [--name <name>]                    Create a TokenHub API key
  atel hub key list                                      List TokenHub API keys
  atel hub key revoke <id>                               Revoke a TokenHub API key
  atel hub key use                                       Print OpenAI-compatible env exports

Platform account commands:
  atel swap usdc <amount> [--chain bsc|base]             Swap USDC -> ATELToken
  atel swap token <amount> [--chain bsc|base]            Swap ATELToken -> USDC
  atel transfer <to_did> <amount> [--memo <text>]        Transfer ATELToken to another DID
        `);
    }
  } catch (err) {
    console.error(err.message);
    if (err.hint) console.error(err.hint);
    process.exit(1);
  }
}

// ─── Top-level platform commands ────────────────────────────────────────────

export async function cmdSwap(direction, amountStr, rawArgs) {
  const flagArr = Array.isArray(rawArgs) ? rawArgs : [];
  const chainIdx = flagArr.indexOf('--chain');
  const flags = { chain: chainIdx !== -1 ? flagArr[chainIdx + 1] : 'bsc' };
  return cmdHubSwap(direction, amountStr, flags);
}

export async function cmdTransfer(toDID, amountStr, rawArgs) {
  if (!toDID || !amountStr) {
    console.error('Usage: atel transfer <to_did> <amount> [--memo <text>]');
    console.error('Example: atel transfer did:atel:ed25519:... 100 --memo "payment for work"');
    process.exit(1);
  }
  const normalizedAmount = String(amountStr).trim();
  if (!/^\d+$/.test(normalizedAmount)) {
    console.error('amount must be a positive integer with no decimals or extra characters');
    process.exit(1);
  }
  const amount = Number(normalizedAmount);
  if (!Number.isSafeInteger(amount) || amount <= 0) {
    console.error('amount must be a positive safe integer');
    process.exit(1);
  }
  const flagArr = Array.isArray(rawArgs) ? rawArgs : [];
  const memoIdx = flagArr.indexOf('--memo');
  const memo = memoIdx !== -1 ? (flagArr[memoIdx + 1] || '') : '';
  const fs = await import('fs');
  const nacl = await import('tweetnacl');
  const path = await import('path');
  const os = await import('os');
  const HUB_CONFIG_PATH = getHubConfigPath();
  let hubCfg;
  try { hubCfg = readHubConfig(['did', 'secretKey', 'platform']); } catch (e) {
    console.error(e.message); process.exit(1);
  }
  const did = hubCfg.did;
  const secretKey = Buffer.from(hubCfg.secretKey, 'hex');
  const PLATFORM_URL = process.env.ATEL_PLATFORM || hubCfg.platform || 'https://api.atelai.org';

  function sortObj(x) {
    if (Array.isArray(x)) return x.map(sortObj);
    if (x && typeof x === 'object') { const o = {}; for (const k of Object.keys(x).sort()) o[k] = sortObj(x[k]); return o; }
    return x;
  }
  const payload = { to_did: toDID, amount, memo };
  const timestamp = new Date().toISOString();
  const sigInput = JSON.stringify(sortObj({ did, payload, timestamp }));
  const signature = Buffer.from(nacl.default.sign.detached(Buffer.from(sigInput), secretKey)).toString('base64');

  const res = await fetch(PLATFORM_URL + '/account/v1/token/transfer', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ did, payload, timestamp, signature }),
    signal: AbortSignal.timeout(30000),
  });
  const data = await res.json();
  if (!res.ok || data.error) {
    console.error('Transfer failed:', data.error || JSON.stringify(data));
    process.exit(1);
  }
  console.log('✓ Transfer successful');
  console.log(`  From:        ${did}`);
  console.log(`  To:          ${toDID}`);
  console.log(`  Amount:      ${amount} ATEL`);
  if (memo) console.log(`  Memo:        ${memo}`);
  console.log(`  Transfer ID: ${data.transfer_id}`);
}

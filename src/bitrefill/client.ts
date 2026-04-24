// Signed fetch helper — posts to Platform's /trade/v1/a2b/* endpoints with
// DID signature authentication (same pattern as bin/atel.mjs signedFetch).

import nacl from 'tweetnacl';
import { AgentIdentity, serializePayload } from '../identity/index.js';

export interface ClientConfig {
  platformUrl?: string; // default: process.env.ATEL_PLATFORM_URL or https://api.atelai.xyz
}

export function resolvePlatformUrl(cfg?: ClientConfig): string {
  if (cfg?.platformUrl) return cfg.platformUrl;
  if (typeof process !== 'undefined') {
    // Match bin/atel.mjs PLATFORM_URL fallback chain
    const envUrl = process.env.ATEL_PLATFORM
      || process.env.ATEL_PLATFORM_URL
      || process.env.ATEL_API
      || process.env.ATEL_REGISTRY;
    if (envUrl) return envUrl;
  }
  return 'https://api.atelai.xyz';
}

export async function signedPost<T = any>(
  id: AgentIdentity,
  path: string,
  payload: Record<string, any>,
  cfg?: ClientConfig,
): Promise<T> {
  const url = resolvePlatformUrl(cfg) + path;
  const ts = new Date().toISOString();
  const signable = serializePayload({ payload, did: id.did, timestamp: ts });
  const sig = Buffer.from(nacl.sign.detached(Buffer.from(signable), id.secretKey)).toString('base64');
  const body = JSON.stringify({ did: id.did, payload, timestamp: ts, signature: sig });

  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body,
  });
  const text = await res.text();
  let data: any;
  try { data = JSON.parse(text); } catch { data = { raw: text }; }
  if (!res.ok) {
    const err = new Error(data?.error || `HTTP ${res.status}`);
    (err as any).status = res.status;
    (err as any).data = data;
    throw err;
  }
  return data as T;
}

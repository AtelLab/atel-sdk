// AVIP-A2B Bitrefill board — 6 atomic operations.
//
// Usage (Agent calls these in order, 用户确认 between step 2 and step 3):
//
//   const intentRes = await bitrefill.createIntent(id, { category: 'gift_card', maxAmount: 50, userSmartAccount });
//   const products  = await bitrefill.search(id, intentRes.intentId, 'Amazon US');
//   // Agent shows products to user, user picks one
//   await bitrefill.deposit(id, intentRes.intentId, 10.50, userSmartAccount);
//   const invoice   = await bitrefill.createInvoice(id, intentRes.intentId, 'amazon-us', 10);
//   const payRes    = await bitrefill.pay(id, intentRes.intentId, parseFloat(invoice.paymentAmount));
//   const redemp    = await bitrefill.getRedemption(id, intentRes.intentId);

import { randomUUID } from 'crypto';
import { AgentIdentity } from '../identity/index.js';
import { signedPost, ClientConfig } from './client.js';
import {
  BitrefillIntentSpec, BitrefillProduct, BitrefillInvoice, BitrefillRedemption,
  ContractOrderView, BitrefillServiceDID,
} from './types.js';

export * from './types.js';

// ── Step 1: create Intent + register on chain ────────────────────

export interface CreateIntentResult {
  orderId: string;
  intentId: string;
  contractTx: string;
  intentHash: string;
}

export async function createIntent(
  id: AgentIdentity,
  spec: BitrefillIntentSpec,
  cfg?: ClientConfig,
): Promise<CreateIntentResult> {
  const intentId = `intent_${randomUUID()}`;
  const deadlineMinutes = spec.deadlineMinutes ?? 10;
  const deadlineUnix = Math.floor(Date.now() / 1000) + deadlineMinutes * 60;

  const payload = {
    intentId,
    category: spec.category,
    maxAmount: spec.maxAmount,
    deadlineUnix,
    allowedTools: [
      'bitrefill.search',
      'wallet.deposit',
      'bitrefill.createInvoice',
      'wallet.pay',
      'bitrefill.getRedemption',
      'bitrefill.status',
    ],
    requiresConfirmAbove: spec.requiresConfirmAbove ?? 50,
    merchant: 'bitrefill',
    scope: spec.scope ?? [],
    userSA: spec.userSmartAccount,
  };
  return signedPost<CreateIntentResult>(id, '/trade/v1/a2b/intent', payload, cfg);
}

// ── Step 2: search (gateway-checked) ──────────────────────────────

export async function search(
  id: AgentIdentity,
  intentId: string,
  query: string,
  options?: { country?: string; limit?: number },
  cfg?: ClientConfig,
): Promise<BitrefillProduct[]> {
  const payload = {
    intentId,
    query,
    country: options?.country ?? 'US',
    limit: options?.limit ?? 5,
  };
  const res = await signedPost<{ products: BitrefillProduct[] }>(id, '/trade/v1/a2b/bitrefill/search', payload, cfg);
  return res.products ?? [];
}

// ── Step 3: deposit (approve + transferFrom on chain) ─────────────

export interface DepositResult {
  approveTx: string;
  depositTx: string;
  amount: number;
}

export async function deposit(
  id: AgentIdentity,
  intentId: string,
  amount: number,
  userSmartAccount: string,
  cfg?: ClientConfig,
): Promise<DepositResult> {
  return signedPost<DepositResult>(id, '/trade/v1/a2b/wallet/deposit', {
    intentId, amount, userSA: userSmartAccount,
  }, cfg);
}

// ── Step 4: createInvoice (gateway-checked + commitInvoice) ───────

export async function createInvoice(
  id: AgentIdentity,
  intentId: string,
  productId: string,
  value: number,
  cfg?: ClientConfig,
): Promise<BitrefillInvoice> {
  return signedPost<BitrefillInvoice>(id, '/trade/v1/a2b/bitrefill/createInvoice', {
    intentId, productId, value,
  }, cfg);
}

// ── Step 5: pay (gateway + executePayment + audit root) ───────────

export interface PayResult {
  txHash: string;
  auditRoot: string;
}

export async function pay(
  id: AgentIdentity,
  intentId: string,
  amount: number,
  cfg?: ClientConfig,
): Promise<PayResult> {
  return signedPost<PayResult>(id, '/trade/v1/a2b/wallet/pay', { intentId, amount }, cfg);
}

// ── Step 6: getRedemption (gateway + confirmDelivery + Proof) ─────

export async function getRedemption(
  id: AgentIdentity,
  intentId: string,
  cfg?: ClientConfig,
): Promise<BitrefillRedemption> {
  // Bitrefill needs 1–5s after pay to populate redemption_info on /orders/{id}.
  // Platform returns {status:"pending", detail:"..."} (HTTP 202) while waiting.
  // Hide that polling from callers — block until we have a real code or give up
  // after ~30s. Without this the LLM agent often interprets `pending` as an
  // error and stops, leaving the user without a card.
  const maxAttempts = 6;
  const delayMs = 5_000;
  let last: any = null;
  for (let i = 0; i < maxAttempts; i++) {
    const r: any = await signedPost(id, '/trade/v1/a2b/bitrefill/redemption', { intentId }, cfg);
    if (r && r.code) return r as BitrefillRedemption;
    last = r;
    if (i < maxAttempts - 1) await new Promise(res => setTimeout(res, delayMs));
  }
  // Surface the final pending payload so the caller still gets the diagnostic.
  return last as BitrefillRedemption;
}

// ── Read-only status ──────────────────────────────────────────────

export async function status(
  id: AgentIdentity,
  intentId: string,
  cfg?: ClientConfig,
): Promise<{ contract: ContractOrderView; traceCount: number }> {
  return signedPost(id, '/trade/v1/a2b/bitrefill/status', { intentId }, cfg);
}

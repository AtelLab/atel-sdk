import { AgentIdentity } from '../../identity/index.js';
import { signedPost, ClientConfig } from '../../bitrefill/client.js';

export interface DiDiQuoteRequest {
  from: string;
  to: string;
  city?: string;
  rideType?: string;
  maxUsdc?: number;
}

export interface DiDiQuoteResult {
  quoteId: string;
  provider: 'didi';
  scenario: 'ride_hailing';
  estimatedFare: number;
  currency: string;
  etaSeconds?: number;
  expiresAt?: string;
  display?: { title?: string; subtitle?: string; badge?: string };
  mode?: string;
}

export interface DiDiConfirmRequest {
  quoteId: string;
  maxUsdc: number;
  userSA?: string;
}

export interface DiDiRideResult {
  intentId: string;
  orderId?: string;
  provider?: string;
  scenario?: string;
  providerOrderId?: string;
  status?: string;
  estimatedFare?: number;
  currency?: string;
  display?: { title?: string; subtitle?: string; badge?: string };
  fulfillment?: Record<string, unknown>;
  mode?: string;
}

export async function quote(
  id: AgentIdentity,
  request: DiDiQuoteRequest,
  cfg?: ClientConfig,
): Promise<DiDiQuoteResult> {
  return signedPost<DiDiQuoteResult>(id, '/trade/v1/a2b/didi/quote', request, cfg);
}

export async function confirm(
  id: AgentIdentity,
  request: DiDiConfirmRequest,
  cfg?: ClientConfig,
): Promise<DiDiRideResult> {
  return signedPost<DiDiRideResult>(id, '/trade/v1/a2b/didi/confirm', request, cfg);
}

export async function status(
  id: AgentIdentity,
  intentId: string,
  cfg?: ClientConfig,
): Promise<DiDiRideResult> {
  return signedPost<DiDiRideResult>(id, '/trade/v1/a2b/didi/status', { intentId }, cfg);
}

export async function cancel(
  id: AgentIdentity,
  intentId: string,
  reason?: string,
  cfg?: ClientConfig,
): Promise<DiDiRideResult> {
  return signedPost<DiDiRideResult>(id, '/trade/v1/a2b/didi/cancel', { intentId, reason }, cfg);
}

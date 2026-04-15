// AVIP-A2B Bitrefill board — atomic operation types.
//
// Agent drives the flow by calling six atomic SDK ops in sequence:
//   intent → search → (user confirms) → deposit → createInvoice → pay → getRedemption

export const BitrefillServiceDID = 'did:atel:service:bitrefill:prod';

export type BitrefillCategory = 'gift_card' | 'topup' | 'esim' | 'refill';

export interface BitrefillIntentSpec {
  category: BitrefillCategory;
  maxAmount: number;                // USDC cap for this order
  deadlineMinutes?: number;          // default 10
  requiresConfirmAbove?: number;    // default 50
  scope?: string[];                 // optional product id whitelist
  userSmartAccount: string;         // user SA address on Base
}

export interface BitrefillProduct {
  id: string;
  name: string;
  currency: string;
  country: string;
  category: string;
  in_stock: boolean;
  packages: Array<{ value: number; price: number; currency: string }>;
  image?: string;
  description?: string;
}

export interface BitrefillInvoice {
  invoiceId: string;
  paymentAddress: string;
  paymentAmount: string;   // decimal string, e.g. "10.05"
  commitTx: string;
}

export interface BitrefillRedemption {
  code: string;
  pin?: string;
  link?: string;
  instructions?: string;
  expiresAt?: string;
  confirmTx: string;
}

export interface ContractOrderView {
  status: number;
  userAddr: string;
  maxAmount: string;
  depositAmount: string;
  paymentAddress: string;
  paymentAmount: string;
  paidAt: string;
}

export class BitrefillError extends Error {
  code?: string;
  constructor(message: string, code?: string) {
    super(message);
    this.name = 'BitrefillError';
    this.code = code;
  }
}

export class InsufficientBalanceError extends BitrefillError {
  constructor(have: number, need: number) {
    super(`insufficient USDC balance: have ${have}, need ${need}`, 'INSUFFICIENT_BALANCE');
  }
}

export class PolicyDeniedError extends BitrefillError {
  rules: string[];
  constructor(rules: string[]) {
    super(`gateway denied: ${rules.join(', ')}`, 'POLICY_DENIED');
    this.rules = rules;
  }
}

export class AwaitingUserConfirmError extends BitrefillError {
  constructor() {
    super('awaiting user confirmation', 'AWAITING_USER_CONFIRM');
  }
}

// Tiered verifier stub - LLM audit removed. SDK does not audit.
// Keeping empty export for backward compatibility.

export class TieredAuditVerifier {
  constructor(_config?: unknown) {}
  async verify(_chain: unknown): Promise<{ pass: boolean; reason: string }> {
    return { pass: true, reason: 'audit disabled' };
  }
}

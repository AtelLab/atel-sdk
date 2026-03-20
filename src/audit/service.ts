// Audit service stub - LLM audit removed. SDK does not audit.
export interface AuditServiceConfig {
  enabled?: boolean;
}

export class AuditService {
  constructor(_config?: AuditServiceConfig) {}
  async initialize(): Promise<void> {}
  async submitForAudit(_taskId: string, _chain: unknown): Promise<void> {}
  async shutdown(): Promise<void> {}
}

// Async audit queue stub - LLM audit removed.
export class AsyncAuditQueue {
  constructor(_config?: unknown) {}
  async submit(_taskId: string, _chain: unknown): Promise<void> {}
}

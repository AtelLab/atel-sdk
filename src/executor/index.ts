/**
 * Module: Executor Interface
 *
 * The executor is the Agent's own AI system, NOT part of the SDK.
 * This module only exports the interface types for external executors
 * that want to integrate with ATEL via ATEL_EXECUTOR_URL.
 *
 * The SDK does NOT provide a built-in executor. Agents bring their own AI.
 */

// ─── Types (for external executor integration) ───────────────────

export interface TaskRequest {
  taskId: string;
  from: string;
  action: string;
  payload: Record<string, unknown>;
  toolProxy?: string;
  callbackUrl?: string;
}

export interface TaskResult {
  taskId: string;
  result: unknown;
  success: boolean;
}

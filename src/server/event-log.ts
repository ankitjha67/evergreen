// FR-08.5 — In-memory webhook event log for observability

export interface WebhookEvent {
  id: string;
  event: string;
  action?: string;
  repo?: string;
  sender?: string;
  receivedAt: string;
  status: "processed" | "error" | "ignored";
  error?: string;
  durationMs?: number;
}

const MAX_EVENTS = 200;

export class EventLog {
  private events: WebhookEvent[] = [];

  push(event: WebhookEvent): void {
    this.events.unshift(event);
    if (this.events.length > MAX_EVENTS) this.events.length = MAX_EVENTS;
  }

  recent(limit = 50): WebhookEvent[] {
    return this.events.slice(0, limit);
  }

  stats(): { total: number; byEvent: Record<string, number>; byStatus: Record<string, number>; byRepo: Record<string, number> } {
    const byEvent: Record<string, number> = {};
    const byStatus: Record<string, number> = {};
    const byRepo: Record<string, number> = {};
    for (const e of this.events) {
      byEvent[e.event] = (byEvent[e.event] ?? 0) + 1;
      byStatus[e.status] = (byStatus[e.status] ?? 0) + 1;
      if (e.repo) byRepo[e.repo] = (byRepo[e.repo] ?? 0) + 1;
    }
    return { total: this.events.length, byEvent, byStatus, byRepo };
  }

  get size(): number {
    return this.events.length;
  }
}

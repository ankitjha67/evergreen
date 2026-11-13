// Webhook retry queue — retries failed webhook handlers with exponential backoff.
// Dead-letter queue for permanently failed events after max retries.

export interface RetryItem<T = unknown> {
  id: string;
  payload: T;
  attempts: number;
  lastAttemptAt: string;
  nextRetryAt: string;
  error?: string;
}

export interface DeadLetterItem<T = unknown> {
  id: string;
  payload: T;
  attempts: number;
  lastError: string;
  failedAt: string;
}

export class RetryQueue<T = unknown> {
  private queue: RetryItem<T>[] = [];
  private deadLetter: DeadLetterItem<T>[] = [];
  private timer: ReturnType<typeof setInterval> | null = null;
  private readonly maxRetries: number;
  private readonly baseDelayMs: number;
  private readonly maxDeadLetter: number;
  private handler: ((payload: T) => Promise<void>) | null = null;

  constructor(opts: { maxRetries?: number; baseDelayMs?: number; maxDeadLetter?: number } = {}) {
    this.maxRetries = opts.maxRetries ?? 3;
    this.baseDelayMs = opts.baseDelayMs ?? 5000;
    this.maxDeadLetter = opts.maxDeadLetter ?? 100;
  }

  onRetry(handler: (payload: T) => Promise<void>): void {
    this.handler = handler;
  }

  enqueue(id: string, payload: T, error: string): void {
    const existing = this.queue.find((item) => item.id === id);
    if (existing) return;

    const now = new Date();
    const nextRetry = new Date(now.getTime() + this.baseDelayMs);
    this.queue.push({
      id,
      payload,
      attempts: 1,
      lastAttemptAt: now.toISOString(),
      nextRetryAt: nextRetry.toISOString(),
      error,
    });
  }

  start(intervalMs = 5000): void {
    if (this.timer) return;
    this.timer = setInterval(() => this.processQueue(), intervalMs);
  }

  stop(): void {
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }
  }

  private async processQueue(): Promise<void> {
    if (!this.handler || this.queue.length === 0) return;

    const now = Date.now();
    const ready = this.queue.filter((item) => new Date(item.nextRetryAt).getTime() <= now);

    for (const item of ready) {
      try {
        await this.handler(item.payload);
        this.queue = this.queue.filter((q) => q.id !== item.id);
      } catch (e: any) {
        item.attempts++;
        item.lastAttemptAt = new Date().toISOString();
        item.error = e.message;

        if (item.attempts >= this.maxRetries) {
          this.queue = this.queue.filter((q) => q.id !== item.id);
          this.deadLetter.push({
            id: item.id,
            payload: item.payload,
            attempts: item.attempts,
            lastError: e.message,
            failedAt: new Date().toISOString(),
          });
          if (this.deadLetter.length > this.maxDeadLetter) {
            this.deadLetter = this.deadLetter.slice(-this.maxDeadLetter);
          }
        } else {
          const delay = this.baseDelayMs * Math.pow(2, item.attempts - 1);
          item.nextRetryAt = new Date(Date.now() + delay).toISOString();
        }
      }
    }
  }

  get pending(): number {
    return this.queue.length;
  }

  get failed(): number {
    return this.deadLetter.length;
  }

  getDeadLetter(limit = 50): DeadLetterItem<T>[] {
    return this.deadLetter.slice(-limit);
  }

  getQueue(): RetryItem<T>[] {
    return [...this.queue];
  }

  stats(): { pending: number; failed: number; oldestRetry: string | null } {
    return {
      pending: this.queue.length,
      failed: this.deadLetter.length,
      oldestRetry: this.queue.length > 0 ? this.queue[0].lastAttemptAt : null,
    };
  }
}

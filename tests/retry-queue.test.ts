// Tests for webhook retry queue with dead-letter handling
import { describe, it, expect, vi, afterEach } from "vitest";
import { RetryQueue } from "../src/server/retry-queue.js";

describe("RetryQueue", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("enqueues failed items and tracks pending count", () => {
    const queue = new RetryQueue();
    queue.enqueue("evt-1", { type: "push" }, "timeout");
    queue.enqueue("evt-2", { type: "pr" }, "network error");
    expect(queue.pending).toBe(2);
    expect(queue.failed).toBe(0);
  });

  it("deduplicates by ID", () => {
    const queue = new RetryQueue();
    queue.enqueue("evt-1", { type: "push" }, "timeout");
    queue.enqueue("evt-1", { type: "push" }, "timeout again");
    expect(queue.pending).toBe(1);
  });

  it("moves to dead letter after max retries", async () => {
    const queue = new RetryQueue({ maxRetries: 2, baseDelayMs: 0 });
    let callCount = 0;
    queue.onRetry(async () => {
      callCount++;
      throw new Error("still failing");
    });

    queue.enqueue("evt-1", { type: "push" }, "initial failure");
    // Manually set nextRetryAt to past
    const item = queue.getQueue()[0];
    item.nextRetryAt = new Date(0).toISOString();

    // Process twice - should hit max retries
    await (queue as any).processQueue();
    if (queue.pending > 0) {
      queue.getQueue()[0].nextRetryAt = new Date(0).toISOString();
      await (queue as any).processQueue();
    }

    expect(queue.pending).toBe(0);
    expect(queue.failed).toBe(1);
    const dl = queue.getDeadLetter();
    expect(dl[0].id).toBe("evt-1");
    expect(dl[0].lastError).toBe("still failing");
  });

  it("removes item on successful retry", async () => {
    const queue = new RetryQueue({ maxRetries: 3, baseDelayMs: 0 });
    queue.onRetry(async () => { /* success */ });

    queue.enqueue("evt-1", { type: "push" }, "transient error");
    queue.getQueue()[0].nextRetryAt = new Date(0).toISOString();

    await (queue as any).processQueue();
    expect(queue.pending).toBe(0);
    expect(queue.failed).toBe(0);
  });

  it("reports stats correctly", () => {
    const queue = new RetryQueue();
    expect(queue.stats()).toEqual({ pending: 0, failed: 0, oldestRetry: null });

    queue.enqueue("evt-1", { type: "push" }, "error");
    const stats = queue.stats();
    expect(stats.pending).toBe(1);
    expect(stats.failed).toBe(0);
    expect(stats.oldestRetry).toBeTruthy();
  });

  it("caps dead letter queue at maxDeadLetter", async () => {
    const queue = new RetryQueue({ maxRetries: 1, baseDelayMs: 0, maxDeadLetter: 3 });
    queue.onRetry(async () => { throw new Error("fail"); });

    for (let i = 0; i < 5; i++) {
      queue.enqueue(`evt-${i}`, { i }, "error");
      queue.getQueue()[0].nextRetryAt = new Date(0).toISOString();
      await (queue as any).processQueue();
    }

    expect(queue.failed).toBe(3);
    const dl = queue.getDeadLetter();
    expect(dl[0].id).toBe("evt-2");
    expect(dl[2].id).toBe("evt-4");
  });
});

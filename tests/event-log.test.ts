// Tests for FR-08.5 - Webhook event log
import { describe, it, expect } from "vitest";
import { EventLog, WebhookEvent } from "../src/server/event-log.js";

function makeEvent(overrides: Partial<WebhookEvent> = {}): WebhookEvent {
  return {
    id: "delivery-1",
    event: "push",
    repo: "owner/repo",
    sender: "user",
    receivedAt: new Date().toISOString(),
    status: "processed",
    durationMs: 42,
    ...overrides,
  };
}

describe("EventLog", () => {
  it("stores and retrieves events in newest-first order", () => {
    const log = new EventLog();
    log.push(makeEvent({ id: "1", event: "push" }));
    log.push(makeEvent({ id: "2", event: "pull_request" }));
    const events = log.recent();
    expect(events).toHaveLength(2);
    expect(events[0].id).toBe("2");
    expect(events[1].id).toBe("1");
  });

  it("limits retrieval count", () => {
    const log = new EventLog();
    for (let i = 0; i < 10; i++) log.push(makeEvent({ id: String(i) }));
    expect(log.recent(3)).toHaveLength(3);
    expect(log.size).toBe(10);
  });

  it("caps at MAX_EVENTS (200)", () => {
    const log = new EventLog();
    for (let i = 0; i < 250; i++) log.push(makeEvent({ id: String(i) }));
    expect(log.size).toBe(200);
  });

  it("computes correct stats", () => {
    const log = new EventLog();
    log.push(makeEvent({ event: "push", repo: "a/b", status: "processed" }));
    log.push(makeEvent({ event: "push", repo: "a/b", status: "error" }));
    log.push(makeEvent({ event: "pull_request", repo: "c/d", status: "processed" }));
    const stats = log.stats();
    expect(stats.total).toBe(3);
    expect(stats.byEvent.push).toBe(2);
    expect(stats.byEvent.pull_request).toBe(1);
    expect(stats.byStatus.processed).toBe(2);
    expect(stats.byStatus.error).toBe(1);
    expect(stats.byRepo["a/b"]).toBe(2);
    expect(stats.byRepo["c/d"]).toBe(1);
  });

  it("handles empty log", () => {
    const log = new EventLog();
    expect(log.recent()).toHaveLength(0);
    expect(log.stats().total).toBe(0);
  });
});

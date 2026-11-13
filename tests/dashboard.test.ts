// Tests for FR-08.6 — Admin dashboard + specs API
import { describe, it, expect } from "vitest";
import { renderDashboard } from "../src/server/dashboard.js";
import { createServer, ServerConfig } from "../src/server/app.js";
import { resolve } from "node:path";

const TEST_PRIVATE_KEY = `-----BEGIN RSA PRIVATE KEY-----
MIIEpAIBAAKCAQEA0Z3VS5JJcds3xfn/ygWyF8PbnGcY5unA67hqxnfZoGMWF9Kq
T1bbMbVtmkZNAQJ8MRDNKGY2MXKKJN7fMtNIM/KtNVHv5JKJnHAI2Y+lPMksOiz
uadPjU9OGvjVAjFThG1ug3BWOO1FZuIEvOe6hLcFx5VX8d+PvRR3cVR/X/b3MHBJ
e42x8s/XfKTC/Fh2RCfJx/CB/cH2BZMi+kT/E6yN0elCJY6EoN3FDDRjbRPz/ZCx
aSV4IZJFHK4wrCFpydMqDIj+te8OsZ9AlWVP9fQD8g0TMpHL9BxEX8VN2FFKnDBm
m6Y6kHESJftD2obnCTMzBHgfXN3ACvNsXm/bFQIDAQABAKCAQEAxIQ6IOx8Wh5+K
f/B6hLGbSDT9GMMDn5hHAZ0VKl8OmcQ5Ds5GfNaR0e3SPdcsL8nNG3M6J7MmBKVM
XiZn+I1t0lAeWIc6IQbFGzj3DUCuUQNq1dG6CQKbkSVFMd7OWH9bfoCHqJjJR3qm
8b2e0pbVzaa2MBa4gEBNWP64EfU2n0VPwdnq8R5IVF/c7OeO6NPnuq3B+gSMwj8M
Dd2JO6AGIxc0HPpdl3JzQ+dTNYdI4M2YoAYbcqbSQHT/QSHF22C+LJP3KWR3fQgH
f0L+Rb1g6P4tVJ6SzXrVd1bdN6HZfLdQQzVB7FZ1EJwRUWj5wwUPIfSQ8pQfME2D
GAeJ8QKBgQD8Y2xKDj4vy+QCf9zVJFyRuJqqIXSBDJP7S/HWZY1e6LkZoRhdJhYo
RPo1EIeH3Z+FqLb5RTQi2/4RxX7AQS+0YJwSAGj3cq8KJL25ga6kCxBYrSWJNjdF
M1r7XDMXvbzqGIHKSS+IK3xMYz+xoM5wFBL3U9JKz8mqf1/HJQ8jQKBgQDUBz7K
2YaL3yoB7dlwG5qqq4cjv0lZOkR4bAm2lEMezGjjNYMf2j1BlkGy3VfMGHnPXrRg
LfB8C8MLmJfXvnzJ2Y9P8q5ADa6Hnf/0xPGg7b+TzXHBQI5EKb/WTQlkYSusPJJ9
QH2QOT3CAHEfMXcL+OYj/xKOP31hu7u5kQ9oaQKBgQClMdFJZ+u2JyMf33WnpHMY
2h3WTD+8v+0kn+PB9Q9hLXaM1oCAiZ2EkzxPh1RPM4Dvix6JqL0UR4YX5lFb/J0R
nqhCAJVYRSiCBJSN8f1UaD3K0B0nGMnrMY/6tm0MOz1VCOjvBt4r+MXJbhTMRE04
KQaeLYFU0d0LJ8st+Lp66QKBgQCKODo1bfX1VcHrB5TCrjNP4aMOi3sS5TQRxWQ5
xR5BuD4d+Z+4FK4SdCpG0NLd8H7SX3Zf3b8CJsOSqgWcaouPgYSZ0Sfr/Bpj5h0
0kJ1QIJQLW27HEPIFCrwaGe+b/XBnJK9C0Z+wNPR7L/DjeIbaZ2sHcBTkMT7fAJI
+3m7eQKBgQDkUmZhPE2P+b6RCNpt3QP3n2LbS/B0cPVgOqSutP74HBrqWi0aFxJz
jGMOiLDMbJ8UxDBf/GKE2RUaWc2+t/E0q5UqXmPs2TXN+ASVimUa3G4vCpgY9bCH
JJ1LE0JJR7F7jHC3x0U6BPH+KzSLjwKK9oM1+PkrWrI0JMb8NfNBA==
-----END RSA PRIVATE KEY-----`;

function makeConfig(): ServerConfig {
  return {
    port: 0,
    appId: "12345",
    privateKey: TEST_PRIVATE_KEY,
    webhookSecret: "test-webhook-secret-for-testing",
    specsDir: resolve("specs"),
    logLevel: "error",
  };
}

describe("renderDashboard", () => {
  it("renders valid HTML with all sections", () => {
    const html = renderDashboard({
      version: "0.6.0",
      uptime: 3661,
      specs: [{ ref: "stripe@2025-03-31", vendor: "Stripe", api: "basil", version: "2025-03-31", title: "Test", languages: ["typescript"], rules: 5 }],
      events: [],
      evtStats: { total: 0, byEvent: {}, byStatus: {}, byRepo: {} },
      usage: null,
    });
    expect(html).toContain("<!DOCTYPE html>");
    expect(html).toContain("Evergreen Admin Dashboard");
    expect(html).toContain("v0.6.0");
    expect(html).toContain("1h 1m");
    expect(html).toContain("stripe@2025-03-31");
    expect(html).toContain("Stripe");
    expect(html).toContain("No webhook events");
  });

  it("renders usage stats when available", () => {
    const html = renderDashboard({
      version: "0.6.0",
      uptime: 60,
      specs: [],
      events: [],
      evtStats: { total: 0, byEvent: {}, byStatus: {}, byRepo: {} },
      usage: { totalEvents: 10, totalCostUSD: 1.5, totalTokens: { input: 5000, output: 2000 }, prsCreated: 3, byProvider: { anthropic: 8, openai: 2 } },
    });
    expect(html).toContain("Usage Stats");
    expect(html).toContain("$1.5000");
    expect(html).toContain("3");
  });

  it("escapes HTML in user-provided data", () => {
    const html = renderDashboard({
      version: "0.6.0",
      uptime: 0,
      specs: [{ ref: "<script>alert(1)</script>", vendor: "X", api: "Y", version: "1", title: "T", languages: [], rules: 0 }],
      events: [],
      evtStats: { total: 0, byEvent: {}, byStatus: {}, byRepo: {} },
      usage: null,
    });
    expect(html).not.toContain("<script>alert(1)</script>");
    expect(html).toContain("&lt;script&gt;");
  });
});

describe("Server API endpoints", () => {
  it("createServer returns eventLog alongside app and registry", async () => {
    const result = await createServer(makeConfig());
    expect(result.app).toBeDefined();
    expect(result.registry).toBeDefined();
    expect(result.eventLog).toBeDefined();
    expect(result.eventLog.size).toBe(0);
  });
});

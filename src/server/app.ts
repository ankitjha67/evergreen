// FR-08.2 — Express webhook server for Evergreen GitHub App
import express from "express";
import { Webhooks } from "@octokit/webhooks";
import { join, resolve } from "node:path";
import { readFileSync, watch } from "node:fs";
import { createAppOctokit, AppConfig } from "../github/client.js";
import { SpecRegistry } from "../registry/specs.js";
import { handlePush, handlePullRequest, handleInstallation, WebhookContext } from "./webhooks.js";
import { getUsageSummary } from "../usage.js";
import { EventLog, type WebhookEvent } from "./event-log.js";
import { specRef } from "../types.js";
import { renderDashboard } from "./dashboard.js";

export interface ServerConfig {
  port: number;
  appId: string;
  privateKey: string;
  webhookSecret: string;
  specsDir: string;
  logLevel: "debug" | "info" | "warn" | "error";
}

const LOG_LEVELS: Record<string, number> = { debug: 0, info: 1, warn: 2, error: 3 };

function createLogger(level: string) {
  const threshold = LOG_LEVELS[level] ?? 1;
  return (lvl: string, msg: string, meta?: Record<string, unknown>) => {
    if ((LOG_LEVELS[lvl] ?? 1) >= threshold) {
      const ts = new Date().toISOString();
      const metaStr = meta ? ` ${JSON.stringify(meta)}` : "";
      console.log(`[${ts}] [${lvl.toUpperCase()}] ${msg}${metaStr}`);
    }
  };
}

export function loadServerConfig(): ServerConfig {
  const appId = process.env.GITHUB_APP_ID;
  const webhookSecret = process.env.GITHUB_WEBHOOK_SECRET;
  if (!appId) throw new Error("GITHUB_APP_ID is required");
  if (!webhookSecret) throw new Error("GITHUB_WEBHOOK_SECRET is required");

  let privateKey: string;
  if (process.env.GITHUB_PRIVATE_KEY) {
    privateKey = process.env.GITHUB_PRIVATE_KEY.replace(/\\n/g, "\n");
  } else if (process.env.GITHUB_PRIVATE_KEY_PATH) {
    privateKey = readFileSync(process.env.GITHUB_PRIVATE_KEY_PATH, "utf8");
  } else {
    throw new Error("GITHUB_PRIVATE_KEY or GITHUB_PRIVATE_KEY_PATH is required");
  }

  return {
    port: parseInt(process.env.PORT ?? "3000", 10),
    appId,
    privateKey,
    webhookSecret,
    specsDir: process.env.SPECS_DIR ?? join(resolve("."), "specs"),
    logLevel: (process.env.LOG_LEVEL as any) ?? "info",
  };
}

function createRateLimiter(maxRequests: number, windowMs: number) {
  const hits = new Map<string, number[]>();
  return (req: express.Request, res: express.Response, next: express.NextFunction) => {
    const key = req.ip ?? "unknown";
    const now = Date.now();
    const timestamps = (hits.get(key) ?? []).filter((t) => now - t < windowMs);
    if (timestamps.length >= maxRequests) {
      res.status(429).json({ error: "Too many requests", retryAfterMs: windowMs - (now - timestamps[0]) });
      return;
    }
    timestamps.push(now);
    hits.set(key, timestamps);
    next();
  };
}

export async function createServer(config: ServerConfig) {
  const log = createLogger(config.logLevel);
  const app = express();

  // Load spec registry
  const registry = new SpecRegistry();
  await registry.loadFromDirectory(config.specsDir);
  log("info", `Loaded ${registry.size} spec(s) from ${config.specsDir}`);

  // GitHub App auth
  const appConfig: AppConfig = {
    appId: config.appId,
    privateKey: config.privateKey,
    webhookSecret: config.webhookSecret,
  };
  const appOctokit = createAppOctokit(appConfig);

  // Webhook signature verification
  const webhooks = new Webhooks({ secret: config.webhookSecret });

  const eventLog = new EventLog();
  const ctx: WebhookContext = { appOctokit, registry, log };

  // Register event handlers with event logging
  webhooks.on("push", async ({ id, payload }) => {
    const start = Date.now();
    const evt: WebhookEvent = {
      id, event: "push", repo: payload.repository?.full_name,
      sender: payload.sender?.login, receivedAt: new Date().toISOString(), status: "processed",
    };
    try {
      await handlePush(ctx, payload);
    } catch (e: any) {
      evt.status = "error";
      evt.error = e.message;
      log("error", `Push handler error: ${e.message}`);
    }
    evt.durationMs = Date.now() - start;
    eventLog.push(evt);
  });

  webhooks.on("pull_request", async ({ id, payload }) => {
    const start = Date.now();
    const evt: WebhookEvent = {
      id, event: "pull_request", action: payload.action,
      repo: payload.repository?.full_name, sender: payload.sender?.login,
      receivedAt: new Date().toISOString(), status: "processed",
    };
    try {
      await handlePullRequest(ctx, payload);
    } catch (e: any) {
      evt.status = "error";
      evt.error = e.message;
      log("error", `PR handler error: ${e.message}`);
    }
    evt.durationMs = Date.now() - start;
    eventLog.push(evt);
  });

  webhooks.on("installation", async ({ id, payload }) => {
    const start = Date.now();
    const evt: WebhookEvent = {
      id, event: "installation", action: payload.action,
      sender: payload.sender?.login, receivedAt: new Date().toISOString(), status: "processed",
    };
    try {
      await handleInstallation(ctx, payload);
    } catch (e: any) {
      evt.status = "error";
      evt.error = e.message;
      log("error", `Installation handler error: ${e.message}`);
    }
    evt.durationMs = Date.now() - start;
    eventLog.push(evt);
  });

  // Request logging middleware
  app.use((req, res, next) => {
    const start = Date.now();
    res.on("finish", () => {
      const duration = Date.now() - start;
      log("info", `${req.method} ${req.path} ${res.statusCode} ${duration}ms`);
    });
    next();
  });

  // Health check — liveness (always ok if the process is running)
  app.get("/healthz", (_req, res) => {
    res.json({ status: "ok", version: "0.9.0", specs: registry.size, uptime: Math.floor(process.uptime()) });
  });

  // Readiness check — ok only if we have specs loaded and GitHub auth configured
  app.get("/ready", (_req, res) => {
    const ready = registry.size > 0;
    res.status(ready ? 200 : 503).json({ ready, specs: registry.size });
  });

  // Usage stats API
  app.get("/api/usage", async (_req, res) => {
    try {
      const summary = await getUsageSummary();
      res.json(summary);
    } catch (e: any) {
      res.status(500).json({ error: e.message });
    }
  });

  // Specs API
  app.get("/api/specs", (_req, res) => {
    const specs = registry.allSpecs().map((s) => ({
      ref: specRef(s),
      vendor: s.vendor,
      api: s.api,
      version: s.version,
      title: s.title,
      languages: s.languages,
      rules: s.changes.length,
      deadline: s.deadline,
    }));
    res.json({ count: specs.length, specs });
  });

  // Webhook event log API
  app.get("/api/events", (req, res) => {
    const limit = parseInt((req.query.limit as string) ?? "50", 10);
    res.json({ events: eventLog.recent(limit), stats: eventLog.stats() });
  });

  // Admin dashboard
  app.get("/admin", async (_req, res) => {
    const usage = await getUsageSummary().catch(() => null);
    const specs = registry.allSpecs().map((s) => ({ ref: specRef(s), vendor: s.vendor, api: s.api, version: s.version, title: s.title, languages: s.languages, rules: s.changes.length }));
    const events = eventLog.recent(20);
    const evtStats = eventLog.stats();
    res.type("html").send(renderDashboard({ version: "0.9.0", uptime: Math.floor(process.uptime()), specs, events, evtStats, usage }));
  });

  // Simple in-memory rate limiter for webhook endpoint
  const rateLimiter = createRateLimiter(60, 60_000); // 60 requests per minute

  // Webhook endpoint
  app.post("/api/github/webhooks", rateLimiter, express.raw({ type: "application/json" }), async (req, res) => {
    const signature = req.headers["x-hub-signature-256"] as string;
    const event = req.headers["x-github-event"] as string;
    const deliveryId = req.headers["x-github-delivery"] as string;

    if (!signature) {
      res.status(401).json({ error: "Missing signature" });
      return;
    }

    try {
      await webhooks.verifyAndReceive({
        id: deliveryId ?? "unknown",
        name: event as any,
        signature,
        payload: req.body.toString(),
      });
      res.status(202).json({ received: true });
    } catch (e: any) {
      if (e.message?.includes("signature")) {
        log("warn", `Webhook signature verification failed: ${deliveryId}`);
        res.status(401).json({ error: "Invalid signature" });
      } else {
        log("error", `Webhook processing error: ${e.message}`);
        res.status(202).json({ received: true });
      }
    }
  });

  return { app, registry, eventLog };
}

export async function startServer(config?: ServerConfig): Promise<void> {
  const cfg = config ?? loadServerConfig();
  const { app, registry } = await createServer(cfg);

  // Spec hot-reload: watch specs directory for changes
  try {
    const watcher = watch(cfg.specsDir, { persistent: false }, async (eventType, filename) => {
      if (filename?.endsWith(".json")) {
        console.log(`[hot-reload] Spec change detected (${filename}), reloading...`);
        try {
          await registry.loadFromDirectory(cfg.specsDir);
          console.log(`[hot-reload] Reloaded ${registry.size} spec(s)`);
        } catch (e: any) {
          console.error(`[hot-reload] Reload failed: ${e.message}`);
        }
      }
    });
    watcher.unref();
  } catch {
    console.log("[hot-reload] Could not watch specs directory (fs.watch unavailable)");
  }

  const server = app.listen(cfg.port, () => {
    console.log(`Evergreen GitHub App server listening on port ${cfg.port}`);
    console.log(`Webhook URL: POST http://localhost:${cfg.port}/api/github/webhooks`);
    console.log(`Health check: GET http://localhost:${cfg.port}/healthz`);
    console.log(`Admin dashboard: http://localhost:${cfg.port}/admin`);
  });

  let shuttingDown = false;
  const gracefulShutdown = (signal: string) => {
    if (shuttingDown) return;
    shuttingDown = true;
    console.log(`\n${signal} received — shutting down gracefully...`);
    server.close(() => {
      console.log("Server closed. Goodbye.");
      process.exit(0);
    });
    setTimeout(() => {
      console.error("Graceful shutdown timed out after 10s, forcing exit.");
      process.exit(1);
    }, 10_000).unref();
  };

  process.on("SIGTERM", () => gracefulShutdown("SIGTERM"));
  process.on("SIGINT", () => gracefulShutdown("SIGINT"));
}

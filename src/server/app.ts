// FR-08.2 — Express webhook server for Evergreen GitHub App
import express from "express";
import { Webhooks } from "@octokit/webhooks";
import { join, resolve } from "node:path";
import { readFileSync } from "node:fs";
import { createAppOctokit, AppConfig } from "../github/client.js";
import { SpecRegistry } from "../registry/specs.js";
import { handlePush, handlePullRequest, handleInstallation, WebhookContext } from "./webhooks.js";

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

  const ctx: WebhookContext = { appOctokit, registry, log };

  // Register event handlers
  webhooks.on("push", async ({ payload }) => {
    handlePush(ctx, payload).catch((e) => log("error", `Push handler error: ${e.message}`));
  });

  webhooks.on("pull_request", async ({ payload }) => {
    handlePullRequest(ctx, payload).catch((e) => log("error", `PR handler error: ${e.message}`));
  });

  webhooks.on("installation", async ({ payload }) => {
    handleInstallation(ctx, payload).catch((e) => log("error", `Installation handler error: ${e.message}`));
  });

  // Health check — liveness (always ok if the process is running)
  app.get("/healthz", (_req, res) => {
    res.json({ status: "ok", version: "0.4.1", specs: registry.size, uptime: Math.floor(process.uptime()) });
  });

  // Readiness check — ok only if we have specs loaded and GitHub auth configured
  app.get("/ready", (_req, res) => {
    const ready = registry.size > 0;
    res.status(ready ? 200 : 503).json({ ready, specs: registry.size });
  });

  // Webhook endpoint
  app.post("/api/github/webhooks", express.raw({ type: "application/json" }), async (req, res) => {
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

  return { app, registry };
}

export async function startServer(config?: ServerConfig): Promise<void> {
  const cfg = config ?? loadServerConfig();
  const { app } = await createServer(cfg);

  app.listen(cfg.port, () => {
    console.log(`Evergreen GitHub App server listening on port ${cfg.port}`);
    console.log(`Webhook URL: POST http://localhost:${cfg.port}/api/github/webhooks`);
    console.log(`Health check: GET http://localhost:${cfg.port}/healthz`);
  });
}

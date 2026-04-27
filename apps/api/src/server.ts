import cookie from "@fastify/cookie";
import cors from "@fastify/cors";
import helmet from "@fastify/helmet";
import jwt from "@fastify/jwt";
import multipart from "@fastify/multipart";
import rateLimit from "@fastify/rate-limit";
import sensible from "@fastify/sensible";
import fastifyStatic from "@fastify/static";
import Fastify from "fastify";
import { join } from "node:path";
import { mkdir } from "node:fs/promises";
import { config } from "./config.js";
import { registerAuth as registerAuthPlugin } from "./plugins/auth.js";
import { registerAgents } from "./routes/agents.js";
import { registerAppointments } from "./routes/appointments.js";
import { registerAuth } from "./routes/auth.js";
import { registerBrokerQueue } from "./routes/broker-queue.js";
import { registerCampaigns } from "./routes/campaigns.js";
import { registerConversations } from "./routes/conversations.js";
import { registerFollowups } from "./routes/followups.js";
import { registerHealthz } from "./routes/healthz.js";
import { registerInstances } from "./routes/instances.js";
import { registerLeadSources } from "./routes/lead-sources.js";
import { registerLeads } from "./routes/leads.js";
import { registerMetrics } from "./routes/metrics.js";
import { registerNotifications } from "./routes/notifications.js";
import { registerPipelines } from "./routes/pipelines.js";
import { registerProperties } from "./routes/properties.js";
import { registerPromMetrics } from "./routes/prom.js";
import { registerReports } from "./routes/reports.js";
import { registerSearch } from "./routes/search.js";
import { registerSlaAlerts } from "./routes/sla-alerts.js";
import { registerStream } from "./routes/stream.js";
import { registerTriggers } from "./routes/triggers.js";
import { registerUsers } from "./routes/users.js";
import { registerWebhooks } from "./routes/webhooks.js";

export async function buildServer() {
  const app = Fastify({
    logger:
      config.NODE_ENV === "development"
        ? { transport: { target: "pino-pretty", options: { colorize: true } } }
        : { level: "info" },
    trustProxy: true,
    bodyLimit: 2 * 1024 * 1024
  });

  await app.register(sensible);
  // Support multiple origins: WEB_URL can be comma-separated (e.g. "https://pointer.vercel.app,https://preview-xyz.vercel.app")
  const allowedOrigins = config.WEB_URL.split(",").map((s) => s.trim());
  if (config.NODE_ENV === "development" && !allowedOrigins.includes("http://localhost:3000")) {
    allowedOrigins.push("http://localhost:3000");
  }
  await app.register(cors, { origin: allowedOrigins, credentials: true });
  await app.register(helmet, { contentSecurityPolicy: false });
  await app.register(cookie);
  await app.register(jwt, {
    secret: config.JWT_SECRET,
    cookie: { cookieName: "pointer_session", signed: false }
  });
  await app.register(rateLimit, { max: 200, timeWindow: "1 minute" });

  // Multipart uploads (PDF/photo/video) — capped at 25 MB/file.
  await app.register(multipart, {
    limits: { fileSize: 25 * 1024 * 1024, files: 12 }
  });

  // Static file serving for uploads under /files/*
  const storageRoot = process.env.STORAGE_ROOT ?? join(process.cwd(), "uploads");
  await mkdir(storageRoot, { recursive: true });
  await app.register(fastifyStatic, {
    root: storageRoot,
    prefix: "/files/",
    decorateReply: false
  });

  await registerAuthPlugin(app);

  await registerHealthz(app);
  await registerAuth(app);
  await registerLeadSources(app);
  await registerLeads(app);
  await registerConversations(app);
  await registerStream(app);
  await registerWebhooks(app);
  await registerAgents(app);
  await registerTriggers(app);
  await registerInstances(app);
  await registerPipelines(app);
  await registerCampaigns(app);
  await registerAppointments(app);
  await registerFollowups(app);
  await registerBrokerQueue(app);
  await registerSlaAlerts(app);
  await registerSearch(app);
  await registerNotifications(app);
  await registerProperties(app);
  await registerUsers(app);
  await registerMetrics(app);
  await registerReports(app);
  await registerPromMetrics(app);

  return app;
}

async function main() {
  const app = await buildServer();
  try {
    await app.listen({ port: config.API_PORT, host: "0.0.0.0" });
  } catch (err) {
    app.log.error(err);
    process.exit(1);
  }
}

main();

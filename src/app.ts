import cookieParser from "cookie-parser";
import cors from "cors";
import express, { Application, NextFunction, Request, Response } from "express";
import helmet from "helmet";
import httpStatus from "http-status";
import mongoose from "mongoose";
import { CronRoute } from "./app/module/cron/cron.route";
import globalErrorHandler from "./app/middlewares/globalErrorHandler";
import routes from "./app/routes/index";
import { sendResponse } from "./shared/customResponse";
import config from "./config";
import {
  apiSecurityHeaders,
  csrfProtection,
  enforceHttps,
  privateResponseCacheControl,
  requestContext,
  verifyCronSignature,
} from "./app/middlewares/security";
import { Metrics } from "./shared/metrics";
import { RedisClient } from "./shared/redisClient";
import { logger } from "./shared/logger";
import { getWorkerHealth } from "./app/module/cron/phase3.worker";
import { mongoSupportsTransactions } from "./app/db/mongoCapabilities";
import {
  emailProviderStatus,
  verifyEmailProvider,
} from "./app/helpers/sendEmail";
import { ObjectStorageService } from "./app/module/websiteBuilder/objectStorage.service";
import { virusScannerHealth } from "./app/module/websiteBuilder/virusScan.service";
import { corsOptionsDelegate } from "./app/middlewares/corsPolicy";
import { PrivacyPolicyService } from "./app/module/privacy/privacyPolicy.service";
import { DomainProviderService } from "./app/module/domain/providers";
import { OperationsQueueService } from "./app/module/operationsQueue/operationsQueue.service";
import {
  DatabaseBackupStatusStore,
  type DatabaseBackupOperationStatus,
} from "./app/module/backup/databaseBackup.status";
import {
  httpLogLevelForStatus,
  requestRoute,
} from "./shared/httpObservability";

import catchAsync from "./shared/catchAsync";
import { authMiddlewares } from "./app/middlewares/auth";
import { parseTrustedProxy } from "./shared/trustedProxy";
import { requestInputGuard } from "./app/middlewares/requestInputGuard";
import { securityAuditTrail } from "./app/middlewares/securityAuditTrail";

const app: Application = express();
const startedAt = Date.now();

app.disable("x-powered-by");
// Use Node's simple query parser so bracket notation cannot materialize nested
// Mongo-style selector objects before validation (for example filter[$ne]).
app.set("query parser", "simple");
app.set("trust proxy", parseTrustedProxy(process.env.TRUST_PROXY));

app.use(cors(corsOptionsDelegate));
app.options("*", cors(corsOptionsDelegate) as any);

app.use(
  helmet({
    contentSecurityPolicy: {
      directives: { defaultSrc: ["'none'"], frameAncestors: ["'none'"] },
    },
    hsts: config.isProduction
      ? { maxAge: 31536000, includeSubDomains: false, preload: false }
      : false,
    referrerPolicy: { policy: 'strict-origin-when-cross-origin' },
    frameguard: { action: 'deny' },
    noSniff: true,
  }),
);
app.use(requestContext);
app.use(apiSecurityHeaders);
app.use(enforceHttps);
app.use(securityAuditTrail);
app.use((req: Request, res: Response, next: NextFunction) => {
  const started = performance.now();
  res.locals.requestStartedAtMs = started;
  res.on("finish", () => {
    const durationMs = performance.now() - started;
    const route = requestRoute(req);
    const errorCode =
      typeof res.locals.apiErrorCode === "string"
        ? res.locals.apiErrorCode
        : undefined;
    Metrics.observeHttp({
      method: req.method,
      path: route,
      statusCode: res.statusCode,
      durationMs,
    });
    if (durationMs >= config.observability.slow_request_ms) {
      Metrics.inc("http_slow_requests_total", { method: req.method.toUpperCase(), route: Metrics.normalizeRoute(route), status: String(res.statusCode) });
      logger.warn("slow_http_request", {
        event: "slow_http_request",
        requestId: req.requestId,
        method: req.method,
        route,
        statusCode: res.statusCode,
        durationMs: Math.round(durationMs * 10) / 10,
        organizationId: req.tenant?.organizationId,
      });
    }
    const level = httpLogLevelForStatus(res.statusCode, errorCode);
    logger.log(level, "http_request", {
      event: "http_request",
      requestId: req.requestId,
      method: req.method,
      route,
      statusCode: res.statusCode,
      durationMs: Math.round(durationMs * 10) / 10,
      organizationId: req.tenant?.organizationId,
      errorCode,
    });
  });
  next();
});
app.use(cookieParser());
app.use(privateResponseCacheControl);
app.use("/api/v1/organization/website", express.json({ limit: "5mb" }));
app.use("/api/v1/observability/client-error", express.json({ limit: "32kb" }));
app.use(express.json({ limit: "1mb" }));
app.use(express.urlencoded({ extended: false, limit: "256kb", parameterLimit: 200 }));
app.use(requestInputGuard);
app.use(csrfProtection);

app.get("/", (_req: Request, res: Response) => {
  sendResponse(res, {
    statusCode: httpStatus.OK,
    success: true,
    message: "Welcome to the Opygen Real Estate API 10 Sep 12:05 AM",
    data: {
      status: "operational",
      version: "1.0.0",
      timestamp: new Date().toISOString(),
    },
  });
});

app.get("/health", (_req, res) => {
  res.setHeader("Cache-Control", "no-store");
  res.status(200).json({ status: "ok" });
});
app.get("/internal/health", authMiddlewares.authSuperAdmin, catchAsync(async (_req, res) => {
  res.setHeader("Cache-Control", "no-store");
  const mongo = mongoose.connection.readyState === 1;
  const worker = getWorkerHealth();
  const emptyDatabaseBackupStatus: DatabaseBackupOperationStatus = {
    _id: "database_backup",
    status: "never_run",
    updatedAt: "",
  };
  const [databaseBackup, propertyMedia] = await Promise.all([
    mongo
      ? DatabaseBackupStatusStore.readCurrent().catch(
          () => emptyDatabaseBackupStatus,
        )
      : Promise.resolve(emptyDatabaseBackupStatus),
    mongo
      ? OperationsQueueService.assetBacklog().catch(() => ({
          pending: 0,
          processing: 0,
          failed: 0,
          pendingAssetFinalizationCount: 0,
          oldestPendingAt: null,
          uploadFailuresSinceStart: 0,
        }))
      : Promise.resolve({
          pending: 0,
          processing: 0,
          failed: 0,
          pendingAssetFinalizationCount: 0,
          oldestPendingAt: null,
          uploadFailuresSinceStart: 0,
        }),
  ]);
  res.status(200).json({
    status: "ok",
    uptimeSeconds: Math.round(process.uptime()),
    startedAt: new Date(startedAt).toISOString(),
    objectStorage: ObjectStorageService.configurationStatus(),
    operations: {
      lastDatabaseBackupAt: databaseBackup.lastDatabaseBackupAt || null,
      databaseBackup: {
        status: databaseBackup.status,
        lastDatabaseBackupAt: databaseBackup.lastDatabaseBackupAt || null,
        lastDurationMs: databaseBackup.lastDurationMs ?? null,
        restoreVerified: databaseBackup.restoreVerified ?? null,
        backupDatabase: databaseBackup.backupDatabase || null,
        lastError: databaseBackup.lastError || "",
      },
      propertyDraftCleanup: worker.propertyDraftCleanup,
      propertyMedia,
    },
  });
}));
const readinessHandler = async (req: Request, res: Response) => {
  res.setHeader("Cache-Control", "no-store");
  try {
  const mongo = mongoose.connection.readyState === 1;
  const unavailableDatabaseBackupStatus: DatabaseBackupOperationStatus = {
    _id: "database_backup",
    status: "unavailable",
    updatedAt: "",
  };
  const [
    transactions,
    redis,
    email,
    objectStorage,
    clamav,
    privacy,
    domainProvider,
    domainQueue,
    databaseBackup,
  ] = await Promise.all([
    mongo ? mongoSupportsTransactions() : Promise.resolve(false),
    RedisClient.ping(),
    verifyEmailProvider(),
    ObjectStorageService.health(),
    virusScannerHealth(),
    mongo
      ? PrivacyPolicyService.getPublicPolicyState()
      : Promise.resolve({
          ready: false,
          policyUrl: "",
          policyVersion: "",
          legalReviewStatus: "required" as const,
        }),
    DomainProviderService.health(),
    mongo
      ? OperationsQueueService.domainBacklog()
      : Promise.resolve({
          pending: 0,
          processing: 0,
          failed: 0,
          oldestPendingAt: null,
        }),
    mongo
      ? DatabaseBackupStatusStore.readCurrent().catch(
          () => unavailableDatabaseBackupStatus,
        )
      : Promise.resolve(unavailableDatabaseBackupStatus),
  ]);
  const worker = getWorkerHealth();
  const workerReady = !config.runtime.worker_enabled || worker.healthy;
  const transactionReady = transactions;
  const emailReady = !config.isProduction || email;
  const mediaReady =
    !config.isProduction || (objectStorage.healthy && clamav.healthy);
  const privacyReady = !config.isProduction || privacy.ready;
  // Provider control-plane outages are reported as domainLifecycle degradation
  // but do not evict otherwise healthy API replicas from the load balancer.
  // Worker health remains a readiness gate because stalled durable jobs affect
  // multiple production workflows, including domain lifecycle progression.
  const domainWorkerOperational =
    worker.enabled && worker.scheduled && worker.healthy;
  const domainLifecycleHealthy =
    domainWorkerOperational &&
    domainProvider.healthy &&
    domainQueue.failed === 0;
  const backupTime = databaseBackup.lastDatabaseBackupAt ? new Date(databaseBackup.lastDatabaseBackupAt).getTime() : Number.NaN;
  const backupAgeSeconds = Number.isFinite(backupTime) ? Math.max(0, (Date.now() - backupTime) / 1000) : -1;
  Metrics.setGauge("dependency_healthy", mongo ? 1 : 0, { dependency: "mongo" });
  Metrics.setGauge("dependency_healthy", transactionReady ? 1 : 0, { dependency: "mongo_transactions" });
  Metrics.setGauge("dependency_healthy", redis ? 1 : 0, { dependency: "redis" });
  Metrics.setGauge("dependency_healthy", emailReady ? 1 : 0, { dependency: "email" });
  Metrics.setGauge("dependency_healthy", workerReady ? 1 : 0, { dependency: "worker" });
  Metrics.setGauge("dependency_healthy", objectStorage.healthy ? 1 : 0, { dependency: "object_storage" });
  Metrics.setGauge("dependency_healthy", clamav.healthy ? 1 : 0, { dependency: "malware_scanner" });
  Metrics.setGauge("dependency_healthy", privacyReady ? 1 : 0, { dependency: "privacy_policy" });
  Metrics.setGauge("domain_queue_failed", Number(domainQueue.failed || 0));
  Metrics.setGauge("database_backup_age_seconds", backupAgeSeconds);
  Metrics.setGauge("database_backup_restore_verified", databaseBackup.restoreVerified === true ? 1 : 0);

  const ready =
    mongo &&
    transactionReady &&
    redis &&
    emailReady &&
    workerReady &&
    mediaReady &&
    privacyReady;
  if (req.path !== "/internal/ready") {
    res.status(ready ? 200 : 503).json({ status: ready ? "ready" : "not_ready" });
    return;
  }
  const emailStatus = emailProviderStatus();
  res.status(ready ? 200 : 503).json({
    status: ready ? "ready" : "not_ready",
    dependencies: {
      mongo,
      mongoTransactions: transactions,
      redis: config.redis.enabled ? redis : "disabled",
      email: {
        configured: emailStatus.configured,
        healthy: emailReady,
        lastCheckedAt: emailStatus.lastCheckedAt,
      },
      worker: config.runtime.worker_enabled ? worker : "disabled",
      objectStorage,
      clamav,
      privacy: { ...privacy, healthy: privacyReady },
      domainLifecycle: {
        healthy: domainLifecycleHealthy,
        provider: domainProvider,
        queue: domainQueue,
      },
      databaseBackup: {
        status: databaseBackup.status,
        lastDatabaseBackupAt: databaseBackup.lastDatabaseBackupAt || null,
        restoreVerified: databaseBackup.restoreVerified === true,
        ageSeconds: backupAgeSeconds,
      },
    },
  });
  } catch (error) {
    logger.error("readiness_check_failed", { error });
    res.status(503).json({ status: "not_ready" });
  }
};
app.get("/ready", readinessHandler);
app.get("/internal/ready", authMiddlewares.authSuperAdmin, readinessHandler);
app.get("/metrics", (req, res) => {
  if (config.isProduction) {
    const token = req.get("authorization")?.replace(/^Bearer\s+/i, "") || "";
    if (
      !config.observability.metrics_token ||
      token !== config.observability.metrics_token
    )
      return res.status(401).type("text/plain").send("unauthorized\n");
  }
  return res
    .status(200)
    .type("text/plain; version=0.0.4; charset=utf-8")
    .send(Metrics.render());
});

import { UploadRoute } from "./app/module/upload/upload.route";

app.use("/api/v1", routes);
app.use("/api/upload", UploadRoute);
app.use("/upload", UploadRoute);
app.use("/api/cron", verifyCronSignature, CronRoute);

app.use(globalErrorHandler);

app.all("*", (req: Request, res: Response) => {
  const message = `No API endpoint found for ${req.method} ${req.originalUrl}`;
  res.locals.apiErrorCode = "NOT_FOUND";
  res.locals.apiErrorEvent = "request_rejected";
  res.status(httpStatus.NOT_FOUND).json({
    success: false,
    code: "NOT_FOUND",
    message,
    fieldErrors: {},
    errorMessages: [{ path: req.originalUrl, message }],
    requestId: req.requestId,
  });
});

export default app;

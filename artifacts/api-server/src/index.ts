import app from "./app";
import { logger } from "./lib/logger";
import { probePublishingReadiness } from "./lib/publishing-readiness";
import { probeAnalyticsReadiness } from "./lib/analytics-readiness";
import { publishDueScheduledPosts } from "./lib/cms-publishing";
import {
  SCHEDULER_INTERVAL_MS,
  markSchedulerStarted,
  recordSchedulerSuccess,
  recordSchedulerError,
  probeSchedulerHealth,
} from "./lib/scheduler-health";

const rawPort = process.env["PORT"];

if (!rawPort) {
  throw new Error(
    "PORT environment variable is required but was not provided.",
  );
}

const port = Number(rawPort);

if (Number.isNaN(port) || port <= 0) {
  throw new Error(`Invalid PORT value: "${rawPort}"`);
}

app.listen(port, (err) => {
  if (err) {
    logger.error({ err }, "Error listening on port");
    process.exit(1);
  }

  logger.info({ port }, "Server listening");

  // Fire-and-forget readiness probes: surface a clear warning in the
  // deployment logs when the publishing/scheduling or page-view analytics
  // prerequisites are missing, without blocking startup or ever crashing the
  // server.
  void probePublishingReadiness();
  void probeAnalyticsReadiness();

  // Establish the scheduler's boot baseline, then probe its health so a
  // backlog of already-overdue scheduled posts (e.g. accumulated while the
  // server was down) is visible in the deployment logs immediately.
  markSchedulerStarted();
  void probeSchedulerHealth();
});

// Background scheduler: every 60s, publish any scheduled posts whose time has
// come. Each tick is recorded (success or failure) so `/api/healthz/scheduler`
// can tell whether the loop is still alive and whether posts are overdue.
// Errors are swallowed (logged) so a transient DB blip never kills the loop;
// `.unref()` keeps the timer from holding the process open on shutdown.
const schedulerTimer = setInterval(() => {
  publishDueScheduledPosts()
    .then((ids) => {
      recordSchedulerSuccess(ids.length);
      if (ids.length > 0) {
        logger.info({ count: ids.length, ids }, "Auto-published scheduled posts");
      }
    })
    .catch((err: unknown) => {
      recordSchedulerError(err);
      logger.error({ err }, "Scheduled auto-publish failed");
    });
}, SCHEDULER_INTERVAL_MS);
schedulerTimer.unref();

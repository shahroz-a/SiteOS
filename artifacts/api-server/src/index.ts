import app from "./app";
import { logger } from "./lib/logger";
import { probeSearchReadiness } from "./lib/search-readiness";
import { publishDueScheduledPosts } from "./lib/cms-publishing";

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

  // Fire-and-forget readiness probe: surfaces a clear warning in the
  // deployment logs when the CMS-search prerequisites are missing, without
  // blocking startup or ever crashing the server.
  void probeSearchReadiness();
});

// Background scheduler: every 60s, publish any scheduled posts whose time has
// come. Errors are swallowed (logged) so a transient DB blip never kills the
// loop; `.unref()` keeps the timer from holding the process open on shutdown.
const SCHEDULER_INTERVAL_MS = 60_000;
const schedulerTimer = setInterval(() => {
  publishDueScheduledPosts()
    .then((ids) => {
      if (ids.length > 0) {
        logger.info({ count: ids.length, ids }, "Auto-published scheduled posts");
      }
    })
    .catch((err: unknown) => {
      logger.error({ err }, "Scheduled auto-publish failed");
    });
}, SCHEDULER_INTERVAL_MS);
schedulerTimer.unref();

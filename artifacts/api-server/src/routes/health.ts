import { Router, type IRouter } from "express";
import { HealthCheckResponse } from "@workspace/api-zod";
import {
  db,
  checkSearchReadiness,
  checkPublishingReadiness,
  checkAnalyticsReadiness,
} from "@workspace/db";
import { checkSchedulerHealth } from "../lib/scheduler-health";

const router: IRouter = Router();

router.get("/healthz", (_req, res) => {
  const data = HealthCheckResponse.parse({ status: "ok" });
  res.json(data);
});

// On-demand readiness check for the CMS-search prerequisites (`pg_trgm`
// extension + trigram GIN indexes). Operators can hit this after a publish to
// confirm prod is fully set up. Returns 200 when ready, 503 when prerequisites
// are missing, 500 only when the probe itself can't run.
router.get("/healthz/search", async (_req, res, next) => {
  try {
    const readiness = await checkSearchReadiness(db);
    res.status(readiness.ready ? 200 : 503).json(readiness);
  } catch (err) {
    next(err);
  }
});

// On-demand readiness check for the CMS publishing/scheduling prerequisites
// (the `page_status` enum values `review`/`scheduled` + the
// `pages.scheduled_for` column). Operators can hit this after a publish to
// confirm prod is fully set up. Returns 200 when ready, 503 when prerequisites
// are missing, 500 only when the probe itself can't run.
router.get("/healthz/publishing", async (_req, res, next) => {
  try {
    const readiness = await checkPublishingReadiness(db);
    res.status(readiness.ready ? 200 : 503).json(readiness);
  } catch (err) {
    next(err);
  }
});

// On-demand readiness check for the page-view analytics prerequisites (the
// `page_views` raw event log + the `page_view_daily` / `page_view_referrer_daily`
// rollup tables + their indexes). Operators can hit this after a publish to
// confirm prod is fully set up. Returns 200 when ready, 503 when prerequisites
// are missing, 500 only when the probe itself can't run.
router.get("/healthz/analytics", async (_req, res, next) => {
  try {
    const readiness = await checkAnalyticsReadiness(db);
    res.status(readiness.ready ? 200 : 503).json(readiness);
  } catch (err) {
    next(err);
  }
});

// Observability probe for the in-process auto-publish scheduler. Reports whether
// the 60s tick is still firing and whether any scheduled posts are overdue.
// Returns 200 when healthy, 503 when the scheduler looks stalled or posts are
// overdue, 500 only when the probe itself (DB query) can't run.
router.get("/healthz/scheduler", async (_req, res, next) => {
  try {
    const health = await checkSchedulerHealth();
    res.status(health.ready ? 200 : 503).json(health);
  } catch (err) {
    next(err);
  }
});

// Aggregate readiness check that rolls up every non-migration-tracked prod
// prerequisite (search + publishing + analytics) into a single ready/not-ready
// summary, so post-publish verification is one call instead of polling each
// subsystem individually. Reuses the same `check*Readiness` functions as the
// per-subsystem routes (no duplicated DB queries). Returns 200 only when ALL
// subsystems are ready, 503 (with the failing subsystems listed under `notReady`)
// when any prerequisite is missing, and 500 only when a probe itself can't run.
router.get("/healthz/ready", async (_req, res, next) => {
  try {
    const [search, publishing, analytics] = await Promise.all([
      checkSearchReadiness(db),
      checkPublishingReadiness(db),
      checkAnalyticsReadiness(db),
    ]);

    const subsystems = { search, publishing, analytics };
    const notReady = (
      Object.keys(subsystems) as (keyof typeof subsystems)[]
    ).filter((name) => !subsystems[name].ready);
    const ready = notReady.length === 0;

    res.status(ready ? 200 : 503).json({ ready, notReady, subsystems });
  } catch (err) {
    next(err);
  }
});

export default router;

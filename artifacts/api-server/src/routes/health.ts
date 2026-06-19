import { Router, type IRouter } from "express";
import { HealthCheckResponse } from "@workspace/api-zod";
import { db, checkSearchReadiness, checkPublishingReadiness } from "@workspace/db";

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

export default router;

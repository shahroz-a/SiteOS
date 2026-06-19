import { Router, type IRouter, type Request, type Response } from "express";
import { RecordPageViewBody, GetCmsAnalyticsResponse } from "@workspace/api-zod";
import { requireAuth, requirePermission } from "../middlewares/rbac";
import { recordPageView, refererHost, buildAnalytics } from "../lib/analytics";

const router: IRouter = Router();

// Public, unauthenticated page-view capture from the blog. Privacy-respecting:
// only the slug + a coarse referrer host + timestamp are stored. Always
// responds 204, even for unknown slugs, so the client stays fire-and-forget.
router.post("/events/page-view", async (req: Request, res: Response) => {
  const parsed = RecordPageViewBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(204).end();
    return;
  }
  try {
    await recordPageView(parsed.data.slug, refererHost(req.get("referer")));
  } catch (err) {
    req.log.warn({ err }, "failed to record page view");
  }
  res.status(204).end();
});

// Content-analytics snapshot — all aggregates in one server-side pass. Gated on
// content.view so any authenticated CMS user can see performance metrics.
router.get(
  "/cms/analytics",
  requireAuth,
  requirePermission("content.view"),
  async (_req: Request, res: Response) => {
    const analytics = await buildAnalytics();
    res.json(GetCmsAnalyticsResponse.parse(analytics));
  },
);

export default router;

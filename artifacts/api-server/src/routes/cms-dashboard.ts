import { Router, type IRouter, type Request, type Response } from "express";
import { GetCmsDashboardResponse } from "@workspace/api-zod";
import { requireAuth, requirePermission } from "../middlewares/rbac";
import { buildDashboard } from "../lib/dashboard";

const router: IRouter = Router();

// Operational dashboard snapshot — all aggregates in one server-side pass.
// Gated on content.view so every authenticated CMS user can see their home
// overview; sensitive audit detail stays behind the audit-log surface.
router.get(
  "/cms/dashboard",
  requireAuth,
  requirePermission("content.view"),
  async (_req: Request, res: Response) => {
    const dashboard = await buildDashboard();
    res.json(GetCmsDashboardResponse.parse(dashboard));
  },
);

export default router;

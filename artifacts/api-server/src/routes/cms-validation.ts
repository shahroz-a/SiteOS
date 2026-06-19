import { Router, type IRouter, type Request, type Response } from "express";
import { GetCmsPostValidationParams } from "@workspace/api-zod";
import { requireAuth, requirePermission } from "../middlewares/rbac";
import { runValidation } from "../lib/seo-validation";

const router: IRouter = Router();

// SEO + publish validation report for an article. Read-only: computes the full
// check catalogue (incl. DB duplicate detection) over the article's current
// persisted state and returns per-check results, a score and the blocking
// (critical) subset. Does NOT persist a report — the publish gate does that.
router.get(
  "/cms/posts/:id/validation",
  requireAuth,
  requirePermission("content.view"),
  async (req: Request, res: Response) => {
    const { id } = GetCmsPostValidationParams.parse(req.params);
    const outcome = await runValidation(id);
    if (!outcome) {
      res.status(404).json({ error: "Post not found" });
      return;
    }
    res.json({ ...outcome.result, duplicates: outcome.duplicates });
  },
);

export default router;

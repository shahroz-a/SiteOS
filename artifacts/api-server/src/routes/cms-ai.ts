import { Router, type IRouter, type Request, type Response } from "express";
import { SuggestCmsAiBody, SuggestCmsAiParams } from "@workspace/api-zod";
import { requireAuth, requirePermission } from "../middlewares/rbac";
import { generateAiSuggestions } from "../lib/ai-assist";

const router: IRouter = Router();

// AI Writing & SEO Assistant. Returns structured, suggest-only suggestions for
// the editor to accept or reject — it NEVER writes to content. Gated on
// content.edit since it powers the editor's assist surfaces.
router.post(
  "/cms/posts/:id/ai/suggest",
  requireAuth,
  requirePermission("content.edit"),
  async (req: Request, res: Response) => {
    const { id } = SuggestCmsAiParams.parse(req.params);
    const body = SuggestCmsAiBody.safeParse(req.body);
    if (!body.success) {
      res.status(400).json({ error: "Invalid request", details: body.error.issues });
      return;
    }

    try {
      const result = await generateAiSuggestions(id, body.data.kind);
      if (!result) {
        res.status(404).json({ error: "Post not found" });
        return;
      }
      res.json(result);
    } catch (err) {
      req.log.error({ err }, "AI suggestion generation failed");
      res.status(502).json({ error: "AI suggestion generation failed" });
    }
  },
);

export default router;

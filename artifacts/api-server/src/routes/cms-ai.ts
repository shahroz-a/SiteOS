import { Router, type IRouter, type Request, type Response } from "express";
import {
  RecordCmsAiDecisionBody,
  RecordCmsAiDecisionParams,
  SuggestCmsAiBody,
  SuggestCmsAiParams,
} from "@workspace/api-zod";
import { requireAuth, requirePermission } from "../middlewares/rbac";
import { generateAiSuggestions } from "../lib/ai-assist";
import { buildAiDecisionReport, recordAiDecision } from "../lib/ai-decisions";

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

// Record an editor's accept/reject decision on a single AI suggestion. Logged
// to the append-only audit trail so the team can see which suggestion kinds are
// useful and audit AI-assisted edits. Best-effort — never blocks the editor.
router.post(
  "/cms/posts/:id/ai/decision",
  requireAuth,
  requirePermission("content.edit"),
  async (req: Request, res: Response) => {
    const { id } = RecordCmsAiDecisionParams.parse(req.params);
    const body = RecordCmsAiDecisionBody.safeParse(req.body);
    if (!body.success) {
      res.status(400).json({ error: "Invalid request", details: body.error.issues });
      return;
    }

    await recordAiDecision(req, id, {
      kind: body.data.kind,
      decision: body.data.decision,
      apply: body.data.apply,
      target: body.data.target ?? null,
      suggestionId: body.data.suggestionId ?? null,
      label: body.data.label ?? null,
    });
    res.status(204).end();
  },
);

// Usefulness report: accept/reject tallies per suggestion kind. Gated on
// content.view so any staff editor can see which kinds are landing.
router.get(
  "/cms/ai/decisions/report",
  requireAuth,
  requirePermission("content.view"),
  async (_req: Request, res: Response) => {
    const report = await buildAiDecisionReport();
    res.json(report);
  },
);

export default router;

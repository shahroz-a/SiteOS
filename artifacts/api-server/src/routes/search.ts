import { Router, type IRouter, type Request, type Response } from "express";
import {
  SearchPostsQueryParams,
  SearchPostsResponse,
  SearchCmsContentQueryParams,
  SearchCmsContentResponse,
} from "@workspace/api-zod";
import { listPosts, searchCmsPosts } from "../lib/posts";
import { requireAuth, requirePermission } from "../middlewares/rbac";

const router: IRouter = Router();

router.get("/search", async (req, res) => {
  const query = SearchPostsQueryParams.parse(req.query);

  const result = await listPosts({
    page: query.page,
    limit: query.limit,
    q: query.q,
  });

  res.json(SearchPostsResponse.parse(result));
});

// Staff-only global search across every content field and all statuses.
router.get(
  "/cms/search",
  requireAuth,
  requirePermission("content.view"),
  async (req: Request, res: Response) => {
    const query = SearchCmsContentQueryParams.parse(req.query);

    const result = await searchCmsPosts({
      page: query.page,
      limit: query.limit,
      q: query.q,
      status: query.status,
      pageType: query.pageType,
      language: query.language,
      categorySlug: query.category,
      authorSlug: query.author,
      tagSlugs: query.tag,
      sort: query.sort,
    });

    res.json(
      SearchCmsContentResponse.parse({
        items: result.items.map((item) => ({
          ...item,
          publishedAt: item.publishedAt
            ? item.publishedAt.toISOString()
            : null,
          modifiedAt: item.modifiedAt ? item.modifiedAt.toISOString() : null,
          updatedAt: item.updatedAt.toISOString(),
        })),
        pagination: result.pagination,
      }),
    );
  },
);

export default router;

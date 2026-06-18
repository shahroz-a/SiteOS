import { Router, type IRouter } from "express";
import { SearchPostsQueryParams, SearchPostsResponse } from "@workspace/api-zod";
import { listPosts } from "../lib/posts";

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

export default router;

import { Router, type IRouter } from "express";
import healthRouter from "./health";
import postsRouter from "./posts";
import categoriesRouter from "./categories";
import authorsRouter from "./authors";
import tagsRouter from "./tags";
import searchRouter from "./search";
import authRouter from "./auth";
import cmsRouter from "./cms";
import cmsContentRouter from "./cms-content";
import cmsTaxonomyRouter from "./cms-taxonomy";

const router: IRouter = Router();

router.use(healthRouter);
router.use(postsRouter);
router.use(categoriesRouter);
router.use(authorsRouter);
router.use(tagsRouter);
router.use(searchRouter);
router.use(authRouter);
router.use(cmsRouter);
router.use(cmsContentRouter);
router.use(cmsTaxonomyRouter);

export default router;

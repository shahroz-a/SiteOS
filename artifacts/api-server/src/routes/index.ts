import { Router, type IRouter } from "express";
import healthRouter from "./health";
import postsRouter from "./posts";
import categoriesRouter from "./categories";
import authorsRouter from "./authors";
import tagsRouter from "./tags";
import searchRouter from "./search";
import authRouter from "./auth";
import cmsRouter from "./cms";
import cmsDashboardRouter from "./cms-dashboard";
import cmsContentRouter from "./cms-content";
import cmsTaxonomyRouter from "./cms-taxonomy";
import cmsIoRouter from "./cms-io";
import cmsMediaRouter from "./cms-media";
import cmsViewsRouter from "./cms-views";

const router: IRouter = Router();

router.use(healthRouter);
router.use(postsRouter);
router.use(categoriesRouter);
router.use(authorsRouter);
router.use(tagsRouter);
router.use(searchRouter);
router.use(authRouter);
router.use(cmsRouter);
router.use(cmsDashboardRouter);
router.use(cmsContentRouter);
router.use(cmsTaxonomyRouter);
router.use(cmsIoRouter);
router.use(cmsMediaRouter);
router.use(cmsViewsRouter);

export default router;

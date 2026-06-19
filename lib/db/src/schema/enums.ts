import { pgEnum } from "drizzle-orm/pg-core";

export const pageStatusEnum = pgEnum("page_status", [
  "draft",
  "review",
  "scheduled",
  "published",
  "archived",
]);

export const pageTypeEnum = pgEnum("page_type", [
  "post",
  "page",
  "category",
  "author",
  "tag",
  "landing",
  "web-story",
]);

export const crawlStatusEnum = pgEnum("crawl_status", [
  "pending",
  "in_progress",
  "completed",
  "failed",
  "skipped",
]);

export const validationStatusEnum = pgEnum("validation_status", [
  "pass",
  "warn",
  "fail",
]);

export const logLevelEnum = pgEnum("log_level", [
  "debug",
  "info",
  "warn",
  "error",
]);

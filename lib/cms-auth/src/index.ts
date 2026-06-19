/**
 * Shared CMS role & permission model.
 *
 * This is the single source of truth for the CMS ("Blog Studio") authorization
 * model. Both the API server (route/permission middleware) and the CMS web app
 * (UI gating) import from here so the front and back ends can never drift.
 *
 * NOTE: the `ROLES` string values are mirrored by the `user_role` Postgres enum
 * in `lib/db/src/schema/auth.ts`. If you add/remove a role here you MUST update
 * that enum (and run a schema push) in lockstep.
 */

export const ROLES = [
  "admin",
  "editor",
  "writer",
  "seo",
  "reviewer",
  "translator",
  "viewer",
] as const;

export type Role = (typeof ROLES)[number];

export const DEFAULT_ROLE: Role = "viewer";

export function isRole(value: unknown): value is Role {
  return typeof value === "string" && (ROLES as readonly string[]).includes(value);
}

/**
 * Every privileged capability the CMS gates on. Routes/UI elements declare the
 * permission(s) they need; roles are granted a set of these.
 */
export const PERMISSIONS = [
  "content.view", // see content lists & detail in the CMS
  "content.create", // create a new draft
  "content.edit", // edit existing content
  "content.publish", // publish / unpublish (elevated)
  "content.delete", // delete content (elevated)
  "url.manage", // change slugs / canonical URLs / redirects (elevated)
  "seo.edit", // edit SEO metadata
  "review.approve", // approve content in review
  "translation.edit", // edit translations
  "media.manage", // upload / manage media
  "taxonomy.manage", // manage categories / tags / authors
  "audit.view", // view the audit log
  "users.manage", // manage users & roles (admin surface)
  "settings.manage", // manage CMS settings
] as const;

export type Permission = (typeof PERMISSIONS)[number];

const ALL_PERMISSIONS: Permission[] = [...PERMISSIONS];

/**
 * Role -> permission grants. Publishing (`content.publish`) and URL changes
 * (`url.manage`) are intentionally limited to elevated roles.
 */
export const ROLE_PERMISSIONS: Record<Role, Permission[]> = {
  admin: ALL_PERMISSIONS,
  editor: [
    "content.view",
    "content.create",
    "content.edit",
    "content.publish",
    "content.delete",
    "url.manage",
    "seo.edit",
    "review.approve",
    "translation.edit",
    "media.manage",
    "taxonomy.manage",
    "audit.view",
  ],
  writer: [
    "content.view",
    "content.create",
    "content.edit",
    "media.manage",
  ],
  seo: ["content.view", "seo.edit", "url.manage"],
  reviewer: ["content.view", "review.approve"],
  translator: ["content.view", "translation.edit"],
  viewer: ["content.view"],
};

export function getPermissionsForRole(role: Role): Permission[] {
  return ROLE_PERMISSIONS[role] ?? [];
}

export function hasPermission(role: Role, permission: Permission): boolean {
  return getPermissionsForRole(role).includes(permission);
}

export function hasAnyPermission(
  role: Role,
  permissions: Permission[],
): boolean {
  return permissions.some((p) => hasPermission(role, p));
}

export function hasAllPermissions(
  role: Role,
  permissions: Permission[],
): boolean {
  return permissions.every((p) => hasPermission(role, p));
}

export interface RoleMeta {
  label: string;
  description: string;
}

/** Human-readable role metadata for the CMS UI (labels, descriptions). */
export const ROLE_META: Record<Role, RoleMeta> = {
  admin: {
    label: "Admin",
    description: "Full access, including user and role management.",
  },
  editor: {
    label: "Editor",
    description: "Create, edit, review, publish, and manage URLs & taxonomy.",
  },
  writer: {
    label: "Writer",
    description: "Draft and edit content; cannot publish or change URLs.",
  },
  seo: {
    label: "SEO",
    description: "Edit SEO metadata and manage URLs & redirects.",
  },
  reviewer: {
    label: "Reviewer",
    description: "Review and approve content awaiting sign-off.",
  },
  translator: {
    label: "Translator",
    description: "Edit translations of existing content.",
  },
  viewer: {
    label: "Viewer",
    description: "Read-only access to CMS content.",
  },
};

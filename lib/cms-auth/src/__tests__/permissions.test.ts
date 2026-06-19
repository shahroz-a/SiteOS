import { describe, it, expect } from "vitest";
import {
  ROLES,
  PERMISSIONS,
  DEFAULT_ROLE,
  ROLE_PERMISSIONS,
  ROLE_META,
  getPermissionsForRole,
  hasPermission,
  hasAnyPermission,
  hasAllPermissions,
  isRole,
  type Role,
  type Permission,
} from "../index";

/**
 * These tests lock the role -> permission matrix. The CMS enforces RBAC in two
 * independent places (server middleware and client gating), both reading this
 * map, so any silent change here would open or close access in both at once.
 * The exact expected sets below are intentionally spelled out so a change to
 * `ROLE_PERMISSIONS` must be a deliberate, reviewed edit to this fixture too.
 */
const EXPECTED: Record<Role, Permission[]> = {
  admin: [...PERMISSIONS],
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
  writer: ["content.view", "content.create", "content.edit", "media.manage"],
  seo: ["content.view", "seo.edit", "url.manage"],
  reviewer: ["content.view", "review.approve"],
  translator: ["content.view", "translation.edit"],
  viewer: ["content.view"],
};

const sortPerms = (perms: readonly Permission[]) => [...perms].sort();

describe("ROLE_PERMISSIONS matrix", () => {
  it("declares an entry for every role and no extras", () => {
    expect(Object.keys(ROLE_PERMISSIONS).sort()).toEqual([...ROLES].sort());
  });

  for (const role of ROLES) {
    it(`grants exactly the expected permissions to ${role}`, () => {
      expect(sortPerms(getPermissionsForRole(role))).toEqual(
        sortPerms(EXPECTED[role]),
      );
    });

    it(`only grants known permissions to ${role}`, () => {
      for (const perm of getPermissionsForRole(role)) {
        expect(PERMISSIONS).toContain(perm);
      }
    });
  }

  it("grants admin every defined permission", () => {
    expect(sortPerms(getPermissionsForRole("admin"))).toEqual(
      sortPerms(PERMISSIONS),
    );
  });

  it("never grants a non-admin role users.manage or settings.manage", () => {
    for (const role of ROLES) {
      if (role === "admin") continue;
      expect(hasPermission(role, "users.manage")).toBe(false);
      expect(hasPermission(role, "settings.manage")).toBe(false);
    }
  });

  it("limits publishing and URL management to elevated roles", () => {
    // content.publish: only admin + editor.
    const canPublish = ROLES.filter((r) => hasPermission(r, "content.publish"));
    expect(canPublish.sort()).toEqual(["admin", "editor"]);
    // url.manage: admin, editor, seo.
    const canUrl = ROLES.filter((r) => hasPermission(r, "url.manage"));
    expect(canUrl.sort()).toEqual(["admin", "editor", "seo"]);
  });

  it("gives every role read access to content", () => {
    for (const role of ROLES) {
      expect(hasPermission(role, "content.view")).toBe(true);
    }
  });
});

describe("permission helpers", () => {
  it("hasPermission reflects the grant table", () => {
    expect(hasPermission("writer", "content.create")).toBe(true);
    expect(hasPermission("writer", "content.publish")).toBe(false);
    expect(hasPermission("viewer", "content.view")).toBe(true);
    expect(hasPermission("viewer", "content.edit")).toBe(false);
  });

  it("hasAnyPermission is true when at least one is granted", () => {
    expect(
      hasAnyPermission("writer", ["content.publish", "content.create"]),
    ).toBe(true);
    expect(
      hasAnyPermission("viewer", ["content.publish", "users.manage"]),
    ).toBe(false);
    expect(hasAnyPermission("viewer", [])).toBe(false);
  });

  it("hasAllPermissions requires every permission", () => {
    expect(
      hasAllPermissions("editor", ["content.publish", "content.delete"]),
    ).toBe(true);
    expect(
      hasAllPermissions("writer", ["content.create", "content.publish"]),
    ).toBe(false);
    expect(hasAllPermissions("viewer", [])).toBe(true);
  });
});

describe("role identity helpers", () => {
  it("DEFAULT_ROLE is the least-privileged viewer", () => {
    expect(DEFAULT_ROLE).toBe("viewer");
    expect(getPermissionsForRole(DEFAULT_ROLE)).toEqual(["content.view"]);
  });

  it("isRole accepts every known role and rejects others", () => {
    for (const role of ROLES) {
      expect(isRole(role)).toBe(true);
    }
    expect(isRole("superuser")).toBe(false);
    expect(isRole("")).toBe(false);
    expect(isRole(null)).toBe(false);
    expect(isRole(undefined)).toBe(false);
    expect(isRole(42)).toBe(false);
  });

  it("getPermissionsForRole returns an empty set for an unknown role", () => {
    expect(getPermissionsForRole("ghost" as Role)).toEqual([]);
  });

  it("ROLE_META documents every role", () => {
    expect(Object.keys(ROLE_META).sort()).toEqual([...ROLES].sort());
    for (const role of ROLES) {
      expect(ROLE_META[role].label.length).toBeGreaterThan(0);
      expect(ROLE_META[role].description.length).toBeGreaterThan(0);
    }
  });
});

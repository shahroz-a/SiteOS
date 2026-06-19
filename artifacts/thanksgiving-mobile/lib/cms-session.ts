import { useGetCmsMe, getGetCmsMeQueryKey } from "@workspace/api-client-react";

import { useAuth } from "@/lib/auth";

/**
 * Combined CMS session for the mobile app: device auth state (from
 * {@link useAuth}) layered with the signed-in user's CMS role and effective
 * permissions from `GET /cms/me`. Mirrors the web CMS auth context
 * (`artifacts/cms/src/lib/cms-auth-context.tsx`) so the same `/api/cms`
 * endpoints can be gated identically.
 */
export interface CmsSession {
  isLoading: boolean;
  isAuthenticated: boolean;
  /** The CMS role, e.g. "admin" / "editor" / "viewer" — null until loaded. */
  role: string | null;
  /** Effective permissions granted to the role. */
  permissions: string[];
  /** Whether the signed-in user holds a specific permission. */
  can: (permission: string) => boolean;
  login: () => Promise<void>;
  logout: () => Promise<void>;
  userName: string | null;
}

const ROLE_LABELS: Record<string, string> = {
  admin: "Admin",
  editor: "Editor",
  writer: "Writer",
  seo: "SEO",
  reviewer: "Reviewer",
  translator: "Translator",
  viewer: "Viewer",
};

export function roleLabel(role: string | null): string {
  if (!role) return "—";
  return ROLE_LABELS[role] ?? role;
}

export function useCmsSession(): CmsSession {
  const { user, isLoading: authLoading, isAuthenticated, login, logout } =
    useAuth();

  // Role + effective permissions come from /cms/me, only when signed in.
  const meQuery = useGetCmsMe({
    query: {
      queryKey: getGetCmsMeQueryKey(),
      enabled: isAuthenticated,
      retry: false,
    },
  });

  const role = isAuthenticated && meQuery.data ? meQuery.data.role : null;
  const permissions = meQuery.data?.permissions ?? [];

  const userName =
    [user?.firstName, user?.lastName].filter(Boolean).join(" ") ||
    user?.email ||
    null;

  return {
    isLoading: authLoading || (isAuthenticated && meQuery.isLoading),
    isAuthenticated,
    role,
    permissions,
    can: (permission: string) => permissions.includes(permission),
    login,
    logout,
    userName,
  };
}

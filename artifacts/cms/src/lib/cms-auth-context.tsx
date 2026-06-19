import { createContext, useContext, useMemo, type ReactNode } from "react";
import { useAuth, type AuthUser } from "@workspace/replit-auth-web";
import { useGetCmsMe, getGetCmsMeQueryKey } from "@workspace/api-client-react";
import {
  hasAllPermissions,
  hasAnyPermission,
  hasPermission,
  isRole,
  type Permission,
  type Role,
} from "@workspace/cms-auth";

interface CmsAuthValue {
  user: AuthUser | null;
  isLoading: boolean;
  isAuthenticated: boolean;
  role: Role | null;
  permissions: Permission[];
  can: (permission: Permission) => boolean;
  canAny: (permissions: Permission[]) => boolean;
  canAll: (permissions: Permission[]) => boolean;
  login: () => void;
  logout: () => void;
}

const CmsAuthContext = createContext<CmsAuthValue | null>(null);

export function CmsAuthProvider({ children }: { children: ReactNode }) {
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

  const value = useMemo<CmsAuthValue>(() => {
    const role: Role | null =
      isAuthenticated && meQuery.data && isRole(meQuery.data.role)
        ? meQuery.data.role
        : null;
    const permissions = (meQuery.data?.permissions ?? []).filter(
      (p): p is Permission => typeof p === "string",
    ) as Permission[];

    return {
      user,
      isLoading: authLoading || (isAuthenticated && meQuery.isLoading),
      isAuthenticated,
      role,
      permissions,
      can: (permission) => (role ? hasPermission(role, permission) : false),
      canAny: (perms) => (role ? hasAnyPermission(role, perms) : false),
      canAll: (perms) => (role ? hasAllPermissions(role, perms) : false),
      login,
      logout,
    };
  }, [
    user,
    authLoading,
    isAuthenticated,
    meQuery.data,
    meQuery.isLoading,
    login,
    logout,
  ]);

  return (
    <CmsAuthContext.Provider value={value}>{children}</CmsAuthContext.Provider>
  );
}

export function useCmsAuth(): CmsAuthValue {
  const ctx = useContext(CmsAuthContext);
  if (!ctx) {
    throw new Error("useCmsAuth must be used within a CmsAuthProvider");
  }
  return ctx;
}

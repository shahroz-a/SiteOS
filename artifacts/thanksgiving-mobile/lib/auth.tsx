import AsyncStorage from "@react-native-async-storage/async-storage";
import * as AuthSession from "expo-auth-session";
import * as WebBrowser from "expo-web-browser";
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useRef,
  useState,
  type ReactNode,
} from "react";

import {
  exchangeMobileAuthorizationCode,
  getCmsMe,
  setAuthTokenGetter,
  type CmsMe,
} from "@workspace/api-client-react";

// Required so the in-app browser can close itself and hand the auth response
// back to the app when the OAuth redirect returns.
WebBrowser.maybeCompleteAuthSession();

const AUTH_TOKEN_KEY = "cms_session_token";
const ISSUER_URL =
  process.env.EXPO_PUBLIC_ISSUER_URL ?? "https://replit.com/oidc";

/** The signed-in user's basic profile (from the `/cms/me` payload). */
type AuthUser = CmsMe["user"];

interface AuthContextValue {
  /** The signed-in staff member's role + effective permissions, or null. */
  me: CmsMe | null;
  /**
   * The signed-in user's basic profile, derived from {@link me}. Kept for
   * consumers (e.g. `useCmsSession`) that only need name/email.
   */
  user: AuthUser | null;
  isLoading: boolean;
  isAuthenticated: boolean;
  login: () => Promise<void>;
  logout: () => Promise<void>;
  /** True when the signed-in user holds the given CMS permission. */
  hasPermission: (permission: string) => boolean;
}

const AuthContext = createContext<AuthContextValue>({
  me: null,
  user: null,
  isLoading: true,
  isAuthenticated: false,
  login: async () => {},
  logout: async () => {},
  hasPermission: () => false,
});

function getApiBaseUrl(): string {
  if (process.env.EXPO_PUBLIC_DOMAIN) {
    return `https://${process.env.EXPO_PUBLIC_DOMAIN}`;
  }
  return "";
}

function getClientId(): string {
  return process.env.EXPO_PUBLIC_REPL_ID || "";
}

/**
 * Replit Auth (OIDC + PKCE) provider for the mobile CMS surface.
 *
 * Mirrors the web CMS session: an authorization-code-with-PKCE flow exchanged
 * for a bearer token via `POST /api/mobile-auth/token-exchange`, then layered
 * with `GET /cms/me` for the role + effective permissions used to gate editing.
 * The token is persisted in AsyncStorage and registered with the generated API
 * client so every `/cms/*` request carries `Authorization: Bearer <token>`.
 */
export function AuthProvider({ children }: { children: ReactNode }) {
  const [me, setMe] = useState<CmsMe | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const tokenRef = useRef<string | null>(null);

  // Generated API hooks attach the bearer token via this getter.
  useEffect(() => {
    setAuthTokenGetter(() => tokenRef.current);
    return () => setAuthTokenGetter(null);
  }, []);

  const discovery = AuthSession.useAutoDiscovery(ISSUER_URL);
  const redirectUri = AuthSession.makeRedirectUri();

  const [request, response, promptAsync] = AuthSession.useAuthRequest(
    {
      clientId: getClientId(),
      scopes: ["openid", "email", "profile", "offline_access"],
      redirectUri,
      prompt: AuthSession.Prompt.Login,
    },
    discovery,
  );

  const refreshMe = useCallback(async () => {
    if (!tokenRef.current) {
      setMe(null);
      return;
    }
    try {
      const data = await getCmsMe();
      setMe(data);
    } catch {
      // Token rejected/expired — drop the stale session.
      tokenRef.current = null;
      await AsyncStorage.removeItem(AUTH_TOKEN_KEY);
      setMe(null);
    }
  }, []);

  // Restore a persisted session on mount.
  useEffect(() => {
    (async () => {
      try {
        tokenRef.current = await AsyncStorage.getItem(AUTH_TOKEN_KEY);
        await refreshMe();
      } finally {
        setIsLoading(false);
      }
    })();
  }, [refreshMe]);

  // Complete the authorization-code exchange after the browser returns.
  useEffect(() => {
    if (response?.type !== "success" || !request?.codeVerifier) return;
    const { code, state } = response.params;

    (async () => {
      setIsLoading(true);
      try {
        const result = await exchangeMobileAuthorizationCode({
          code,
          code_verifier: request.codeVerifier as string,
          redirect_uri: redirectUri,
          state,
          nonce: request.nonce,
        });
        if (result.token) {
          tokenRef.current = result.token;
          await AsyncStorage.setItem(AUTH_TOKEN_KEY, result.token);
          await refreshMe();
        }
      } catch {
        // Exchange failed — remain unauthenticated.
      } finally {
        setIsLoading(false);
      }
    })();
  }, [response, request, redirectUri, refreshMe]);

  const login = useCallback(async () => {
    try {
      await promptAsync();
    } catch {
      // User dismissed the browser or it errored — stay logged out.
    }
  }, [promptAsync]);

  const logout = useCallback(async () => {
    const token = tokenRef.current;
    try {
      if (token) {
        await fetch(`${getApiBaseUrl()}/api/mobile-auth/logout`, {
          method: "POST",
          headers: { Authorization: `Bearer ${token}` },
        });
      }
    } catch {
      // Best-effort server-side revoke; clear the local session regardless.
    } finally {
      tokenRef.current = null;
      await AsyncStorage.removeItem(AUTH_TOKEN_KEY);
      setMe(null);
    }
  }, []);

  const hasPermission = useCallback(
    (permission: string) => Boolean(me?.permissions.includes(permission)),
    [me],
  );

  return (
    <AuthContext.Provider
      value={{
        me,
        user: me?.user ?? null,
        isLoading,
        isAuthenticated: !!me,
        login,
        logout,
        hasPermission,
      }}
    >
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth(): AuthContextValue {
  return useContext(AuthContext);
}

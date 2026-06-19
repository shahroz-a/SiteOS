import { Switch, Route, Router as WouterRouter } from "wouter";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { Toaster } from "@workspace/ui/toaster";
import { TooltipProvider } from "@workspace/ui/tooltip";
import { Spinner } from "@workspace/ui/spinner";
import NotFound from "@/pages/not-found";
import LoginPage from "@/pages/login";
import HomePage from "@/pages/home";
import SearchPage from "@/pages/search";
import UsersPage from "@/pages/users";
import ContentPage from "@/pages/content";
import EditorPage from "@/pages/editor";
import AuthorsPage from "@/pages/authors";
import CategoriesPage from "@/pages/categories";
import TagsPage from "@/pages/tags";
import AuditLogPage from "@/pages/audit-log";
import ImportExportPage from "@/pages/import-export";
import MediaPage from "@/pages/media";
import HeldBackPage from "@/pages/held-back";
import { AppShell } from "@/components/app-shell";
import { CmsAuthProvider, useCmsAuth } from "@/lib/cms-auth-context";

const queryClient = new QueryClient();

function RequirePermission({
  permission,
  children,
}: {
  permission: Parameters<ReturnType<typeof useCmsAuth>["can"]>[0];
  children: React.ReactNode;
}) {
  const { can } = useCmsAuth();
  if (!can(permission)) {
    return (
      <div className="mx-auto max-w-md py-24 text-center">
        <h1 className="font-serif text-3xl tracking-tight">Access denied</h1>
        <p className="mt-2 text-muted-foreground">
          You don't have permission to view this page.
        </p>
      </div>
    );
  }
  return <>{children}</>;
}

function AuthenticatedApp() {
  return (
    <AppShell>
      <Switch>
        <Route path="/" component={HomePage} />
        <Route path="/content">
          <RequirePermission permission="content.view">
            <ContentPage />
          </RequirePermission>
        </Route>
        <Route path="/content/:id">
          {(params) => (
            <RequirePermission permission="content.view">
              <EditorPage params={params} />
            </RequirePermission>
          )}
        </Route>
        <Route path="/import-export">
          <RequirePermission permission="content.view">
            <ImportExportPage />
          </RequirePermission>
        </Route>
        <Route path="/media">
          <RequirePermission permission="media.manage">
            <MediaPage />
          </RequirePermission>
        </Route>
        <Route path="/review-queue">
          <RequirePermission permission="review.approve">
            <HeldBackPage />
          </RequirePermission>
        </Route>
        <Route path="/authors">
          <RequirePermission permission="taxonomy.manage">
            <AuthorsPage />
          </RequirePermission>
        </Route>
        <Route path="/categories">
          <RequirePermission permission="taxonomy.manage">
            <CategoriesPage />
          </RequirePermission>
        </Route>
        <Route path="/tags">
          <RequirePermission permission="taxonomy.manage">
            <TagsPage />
          </RequirePermission>
        </Route>
        <Route path="/search">
          <RequirePermission permission="content.view">
            <SearchPage />
          </RequirePermission>
        </Route>
        <Route path="/users">
          <RequirePermission permission="users.manage">
            <UsersPage />
          </RequirePermission>
        </Route>
        <Route path="/audit-log">
          <RequirePermission permission="audit.view">
            <AuditLogPage />
          </RequirePermission>
        </Route>
        <Route component={NotFound} />
      </Switch>
    </AppShell>
  );
}

function Gate() {
  const { isLoading, isAuthenticated } = useCmsAuth();

  if (isLoading) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-background">
        <Spinner className="size-8 text-muted-foreground" />
      </div>
    );
  }

  return isAuthenticated ? <AuthenticatedApp /> : <LoginPage />;
}

function App() {
  return (
    <QueryClientProvider client={queryClient}>
      <TooltipProvider>
        <WouterRouter base={import.meta.env.BASE_URL.replace(/\/$/, "")}>
          <CmsAuthProvider>
            <Gate />
          </CmsAuthProvider>
        </WouterRouter>
        <Toaster />
      </TooltipProvider>
    </QueryClientProvider>
  );
}

export default App;

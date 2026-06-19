import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@workspace/ui/card";
import { Badge } from "@workspace/ui/badge";
import { useCmsAuth } from "@/lib/cms-auth-context";
import { ROLE_META } from "@workspace/cms-auth";

export default function HomePage() {
  const { user, role, permissions } = useCmsAuth();
  const firstName = user?.firstName || user?.email || "there";
  const meta = role ? ROLE_META[role] : null;

  return (
    <div className="mx-auto max-w-4xl space-y-8">
      <div className="space-y-2">
        <h1 className="font-serif text-4xl tracking-tight">
          Welcome back, {firstName}
        </h1>
        <p className="text-muted-foreground">
          This is the Blog Studio workspace. Content tools will appear here as
          they come online.
        </p>
      </div>

      <Card className="border-border/60">
        <CardHeader>
          <CardTitle className="text-lg">Your access</CardTitle>
          <CardDescription>
            What you can do is determined by your assigned role.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="flex items-center gap-3">
            <span className="text-sm text-muted-foreground">Role</span>
            {meta ? (
              <Badge variant="secondary">{meta.label}</Badge>
            ) : (
              <Badge variant="outline">Unknown</Badge>
            )}
          </div>
          {meta ? (
            <p className="text-sm text-muted-foreground">{meta.description}</p>
          ) : null}
          <div className="space-y-2">
            <span className="text-sm text-muted-foreground">
              Permissions ({permissions.length})
            </span>
            <div className="flex flex-wrap gap-1.5">
              {permissions.length > 0 ? (
                permissions.map((p) => (
                  <Badge key={p} variant="outline" className="font-mono text-xs">
                    {p}
                  </Badge>
                ))
              ) : (
                <span className="text-sm text-muted-foreground">None</span>
              )}
            </div>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}

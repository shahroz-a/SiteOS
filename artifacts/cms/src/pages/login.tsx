import { Button } from "@workspace/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@workspace/ui/card";
import { useCmsAuth } from "@/lib/cms-auth-context";

export default function LoginPage() {
  const { login } = useCmsAuth();

  return (
    <div className="min-h-screen w-full flex items-center justify-center bg-background px-4">
      <Card className="w-full max-w-md border-border/60 shadow-sm">
        <CardHeader className="space-y-3 text-center">
          <div className="mx-auto flex h-12 w-12 items-center justify-center rounded-xl bg-primary/10 text-primary font-serif text-2xl font-semibold">
            B
          </div>
          <CardTitle className="font-serif text-3xl tracking-tight">Blog Studio</CardTitle>
          <CardDescription className="text-base">
            Internal content management for the Headout Blog. Sign in to continue.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <Button size="lg" className="w-full" onClick={login}>
            Sign in with Replit
          </Button>
          <p className="mt-4 text-center text-xs text-muted-foreground">
            Access is role-based. Contact an admin if you need elevated permissions.
          </p>
        </CardContent>
      </Card>
    </div>
  );
}

import { Link } from "wouter";
import { Compass } from "lucide-react";

export default function NotFound() {
  return (
    <div className="min-h-screen w-full flex items-center justify-center bg-background px-6">
      <div className="w-full max-w-lg text-center">
        <div className="inline-flex items-center justify-center w-16 h-16 rounded-2xl bg-secondary text-secondary-foreground mb-8">
          <Compass className="h-7 w-7" />
        </div>
        <p className="text-eyebrow text-primary mb-4">Error 404</p>
        <h1 className="text-display-sm text-foreground mb-4">
          This page took a different trip
        </h1>
        <p className="text-body text-muted-foreground mb-8 max-w-md mx-auto">
          The page you're looking for doesn't exist or may have moved. Let's get
          you back to the stories.
        </p>
        <Link
          href="/"
          className="inline-flex items-center justify-center h-11 px-7 rounded-lg bg-primary text-primary-foreground border border-primary-border text-sm font-medium hover-elevate active-elevate-2"
        >
          Back to the blog
        </Link>
      </div>
    </div>
  );
}

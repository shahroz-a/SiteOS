import { Link } from "wouter";
import { Loader2 } from "lucide-react";

export function LoadingState({ label = "Loading…" }: { label?: string }) {
  return (
    <div className="flex flex-col items-center justify-center py-32 text-muted-foreground">
      <Loader2 className="w-8 h-8 animate-spin mb-4 text-primary" />
      <p className="text-sm">{label}</p>
    </div>
  );
}

export function ErrorState({
  title = "Something went wrong",
  message = "We couldn't load this content. Please try again.",
}: {
  title?: string;
  message?: string;
}) {
  return (
    <div className="flex flex-col items-center justify-center py-32 text-center px-6">
      <h2 className="font-serif text-2xl text-foreground mb-3">{title}</h2>
      <p className="text-muted-foreground max-w-md mb-6">{message}</p>
      <Link
        href="/"
        className="text-sm font-medium px-5 py-2.5 rounded-full bg-primary text-primary-foreground hover:bg-primary/90 transition-colors"
      >
        Back to the blog
      </Link>
    </div>
  );
}

export function EmptyState({
  title = "Nothing here yet",
  message,
}: {
  title?: string;
  message?: string;
}) {
  return (
    <div className="flex flex-col items-center justify-center py-24 text-center px-6">
      <h2 className="font-serif text-2xl text-foreground mb-3">{title}</h2>
      {message ? (
        <p className="text-muted-foreground max-w-md">{message}</p>
      ) : null}
    </div>
  );
}

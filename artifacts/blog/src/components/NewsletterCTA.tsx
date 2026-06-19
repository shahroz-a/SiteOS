import { useState } from "react";
import { Button } from "@workspace/ui/button";
import { Input } from "@workspace/ui/input";
import { Send } from "lucide-react";

export function NewsletterCTA() {
  const [email, setEmail] = useState("");
  const [status, setStatus] = useState<"idle" | "success">("idle");

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (email) {
      setStatus("success");
      setTimeout(() => setStatus("idle"), 3000);
      setEmail("");
    }
  };

  return (
    <section className="bg-primary rounded-3xl p-8 md:p-16 border border-primary/20 relative overflow-hidden">
      {/* Decorative blobs */}
      <div className="absolute top-0 right-0 w-64 h-64 bg-white/10 rounded-full blur-3xl -translate-y-1/2 translate-x-1/3 pointer-events-none" />
      <div className="absolute bottom-0 left-0 w-80 h-80 bg-black/10 rounded-full blur-3xl translate-y-1/3 -translate-x-1/3 pointer-events-none" />

      <div className="max-w-2xl mx-auto text-center relative z-10">
        <h2 className="text-3xl md:text-5xl font-serif text-primary-foreground mb-6 leading-[1.1] tracking-tight">
          Let the adventure come to you
        </h2>
        <p className="text-primary-foreground/80 text-lg mb-10 font-light">
          Join our newsletter for curated travel inspiration, exclusive city guides, and holiday ideas.
        </p>

        <form
          onSubmit={handleSubmit}
          className="flex flex-col sm:flex-row gap-3 max-w-md mx-auto"
        >
          <Input
            type="email"
            placeholder="Email address"
            required
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            className="bg-white/10 text-primary-foreground placeholder:text-primary-foreground/50 border-white/20 h-14 rounded-xl px-6 focus-visible:ring-white/50 backdrop-blur-sm transition-all"
          />
          <Button
            type="submit"
            className="h-14 rounded-xl px-8 bg-white hover:bg-white/90 text-primary font-medium hover-elevate transition-all"
          >
            {status === "success" ? "Subscribed!" : (
              <span className="flex items-center gap-2">
                Subscribe <Send className="w-4 h-4" />
              </span>
            )}
          </Button>
        </form>
        <p className="text-xs text-primary-foreground/60 mt-6">
          No spam. Unsubscribe at any time.
        </p>
      </div>
    </section>
  );
}

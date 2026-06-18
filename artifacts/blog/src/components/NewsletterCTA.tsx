import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Mail } from "lucide-react";

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
    <section className="bg-primary/5 rounded-3xl p-8 md:p-16 border border-primary/10 my-20 relative overflow-hidden">
      <div className="absolute top-0 left-0 w-full h-1 bg-gradient-to-r from-transparent via-primary/50 to-transparent opacity-50" />

      <div className="max-w-2xl mx-auto text-center relative z-10">
        <div className="inline-flex items-center justify-center w-12 h-12 rounded-full bg-primary/10 text-primary mb-6">
          <Mail className="w-5 h-5" />
        </div>
        <p className="text-primary font-medium tracking-wide uppercase text-sm mb-4">
          Join the journey
        </p>
        <h2 className="text-3xl md:text-4xl font-serif text-foreground mb-8 leading-tight">
          Get travel inspiration in your inbox
        </h2>

        <form
          onSubmit={handleSubmit}
          className="flex flex-col sm:flex-row gap-3 max-w-md mx-auto"
        >
          <Input
            type="email"
            placeholder="Enter your email"
            required
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            className="bg-card h-12 rounded-full px-6 border-primary/20 focus-visible:ring-primary"
          />
          <Button
            type="submit"
            className="h-12 rounded-full px-8 bg-primary hover:bg-primary/90 text-primary-foreground font-medium"
          >
            {status === "success" ? "Subscribed!" : "Subscribe"}
          </Button>
        </form>
        <p className="text-sm text-muted-foreground mt-4">
          No spam, just the good stuff. Unsubscribe anytime.
        </p>
      </div>
    </section>
  );
}

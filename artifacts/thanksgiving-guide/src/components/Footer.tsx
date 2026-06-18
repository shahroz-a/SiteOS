import { footerStats, footerTagline, type FooterStat } from "@/data/content";

interface FooterProps {
  stats?: FooterStat[];
  tagline?: string;
}

/**
 * Reusable site footer, matching the original site design. Driven by props/data
 * (with defaults from content.ts) so it can be reused across other pages.
 */
export function Footer({
  stats = footerStats,
  tagline = footerTagline,
}: FooterProps) {
  return (
    <footer className="bg-foreground text-background py-16 md:py-24 mt-auto">
      <div className="max-w-7xl mx-auto px-6 lg:px-12">
        <div className="grid grid-cols-1 md:grid-cols-3 gap-12 md:gap-8 mb-16 pb-16 border-b border-background/10">
          {stats.map((stat, idx) => (
            <div key={idx} className="text-center md:text-left space-y-3">
              <div className="text-3xl font-serif text-primary-foreground">{stat.highlight}</div>
              <div className="font-medium text-background/90">{stat.label}</div>
              <div className="text-background/60 text-sm leading-relaxed max-w-xs mx-auto md:mx-0">
                {stat.description}
              </div>
            </div>
          ))}
        </div>

        <div className="text-center md:flex md:items-center md:justify-between">
          <p className="text-2xl md:text-3xl font-serif text-background/90 mb-8 md:mb-0">
            {tagline}
          </p>
          <div className="text-sm text-background/50">
            &copy; {new Date().getFullYear()} Headout. All rights reserved.
          </div>
        </div>
      </div>
    </footer>
  );
}

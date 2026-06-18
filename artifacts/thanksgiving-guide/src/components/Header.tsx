import { siteMeta, siteNav, type NavItem } from "@/data/content";

interface HeaderProps {
  logo?: string;
  logoAlt?: string;
  logoHref?: string;
  nav?: NavItem[];
}

/**
 * Reusable site chrome (top navigation bar), matching the original Headout Blog
 * header. Driven entirely by props/data so other scraped pages can drop it in
 * without re-creating it. Defaults reproduce this site's logo and primary menu.
 */
export function Header({
  logo = siteMeta.logo,
  logoAlt = siteMeta.blogName,
  logoHref = siteMeta.blogHref,
  nav = siteNav,
}: HeaderProps) {
  return (
    <header className="w-full bg-card border-b border-border/40 sticky top-0 z-50">
      <div className="max-w-7xl mx-auto px-6 lg:px-12 h-16 md:h-20 flex items-center justify-between gap-6">
        <a
          href={logoHref}
          target="_blank"
          rel="noopener noreferrer"
          className="inline-block shrink-0 hover:opacity-80 transition-opacity"
        >
          <img src={logo} alt={logoAlt} className="h-6 md:h-7 w-auto" />
        </a>

        <nav
          aria-label="Primary"
          className="hidden md:flex items-center gap-6 lg:gap-8"
        >
          {nav.map((item) => (
            <a
              key={item.label}
              href={item.href ?? "#"}
              {...(item.href
                ? { target: "_blank", rel: "noopener noreferrer" }
                : {})}
              className="text-xs font-semibold uppercase tracking-wide text-foreground/80 hover:text-primary transition-colors whitespace-nowrap"
            >
              {item.label}
            </a>
          ))}
        </nav>
      </div>
    </header>
  );
}

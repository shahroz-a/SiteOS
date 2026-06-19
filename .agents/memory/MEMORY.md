# Memory index

- [Headout crawl render mode (HTTP vs Playwright)](headout-crawl-render-mode.md) — HTTP is content-complete for article bodies at 100–600× the speed; Playwright only adds a few lazy-loaded images. Prefer HTTP for the full crawl.
- [Playwright Chromium on Replit](replit-playwright-chromium.md) — `playwright install` download is firewall-blocked here; install Nix `chromium` and launch with `executablePath`.
- [pkill self-match in the bash tool](shell-pkill-self-match.md) — `pkill -f foo` also matches the running shell (pattern is in its argv) and SIGTERMs it (exit 143, no output). Use the `[f]oo` bracket trick.

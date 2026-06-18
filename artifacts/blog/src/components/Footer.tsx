import { Link } from "wouter";
import { useListCategories } from "@workspace/api-client-react";
import { categoryPath } from "@/lib/blog";

export function Footer() {
  const { data: categories } = useListCategories();

  return (
    <footer className="bg-foreground text-background py-16 md:py-20 mt-auto">
      <div className="max-w-7xl mx-auto px-6 lg:px-12">
        <div className="grid grid-cols-1 md:grid-cols-3 gap-12 md:gap-8 mb-14 pb-14 border-b border-background/10">
          <div className="space-y-4">
            <img
              src="https://cdn-imgix-open.headout.com/logo/svg/Headout_blog.svg"
              alt="Headout Blog"
              className="h-7 w-auto brightness-0 invert"
            />
            <p className="text-background/60 text-sm leading-relaxed max-w-xs">
              Travel inspiration, family destination guides, and holiday ideas
              from around the world.
            </p>
          </div>

          <div className="space-y-4">
            <h3 className="text-sm font-semibold uppercase tracking-wide text-background/90">
              Explore
            </h3>
            <ul className="space-y-2">
              {(categories ?? []).map((cat) => (
                <li key={cat.id}>
                  <Link
                    href={categoryPath(cat.slug)}
                    className="text-sm text-background/60 hover:text-primary-foreground transition-colors"
                  >
                    {cat.name}
                  </Link>
                </li>
              ))}
            </ul>
          </div>

          <div className="space-y-4">
            <h3 className="text-sm font-semibold uppercase tracking-wide text-background/90">
              About
            </h3>
            <p className="text-background/60 text-sm leading-relaxed max-w-xs">
              The Headout Blog helps families and travellers plan smarter,
              richer trips with curated guides and local know-how.
            </p>
          </div>
        </div>

        <div className="text-center md:flex md:items-center md:justify-between">
          <p className="text-2xl md:text-3xl font-serif text-background/90 mb-6 md:mb-0">
            Go see the world.
          </p>
          <div className="text-sm text-background/50">
            &copy; {new Date().getFullYear()} Headout. All rights reserved.
          </div>
        </div>
      </div>
    </footer>
  );
}

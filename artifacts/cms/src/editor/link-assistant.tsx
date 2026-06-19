/**
 * Internal-linking assistant.
 *
 * Provides a promise-based link picker via context so any rich-text editor can
 * call `pick()` to open a searchable dialog over published/draft posts, authors
 * and categories. Draft or archived targets are flagged with a warning so
 * editors don't link to content that isn't publicly reachable.
 */
import {
  createContext,
  useCallback,
  useContext,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { AlertTriangle, FileText, Folder, Link2, User } from "lucide-react";
import {
  useListCmsPost,
  useListAuthors,
  useListCategories,
  getListCmsPostQueryKey,
  getListAuthorsQueryKey,
  getListCategoriesQueryKey,
} from "@workspace/api-client-react";
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from "@workspace/ui/command";
import { Dialog, DialogContent, DialogTitle } from "@workspace/ui/dialog";
import { Input } from "@workspace/ui/input";
import { Button } from "@workspace/ui/button";

export interface LinkResult {
  href: string;
  label: string;
}

type Resolver = (value: LinkResult | null) => void;

interface LinkPickerContextValue {
  pick: (initialText?: string) => Promise<LinkResult | null>;
}

const LinkPickerContext = createContext<LinkPickerContextValue | null>(null);

export function useLinkPicker(): LinkPickerContextValue {
  return (
    useContext(LinkPickerContext) ?? {
      // Fallback when no provider is mounted: a plain URL prompt.
      pick: async () => {
        const href = window.prompt("Link URL");
        return href ? { href, label: href } : null;
      },
    }
  );
}

const BLOG_BASE = "/blog";

function statusWarn(status: string): boolean {
  return status !== "published";
}

export function LinkPickerProvider({ children }: { children: ReactNode }) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [manualUrl, setManualUrl] = useState("");
  const resolverRef = useRef<Resolver | null>(null);

  const postsParams = { q: query || undefined, limit: 8 };
  const postsQuery = useListCmsPost(postsParams, {
    query: { queryKey: getListCmsPostQueryKey(postsParams), enabled: open },
  });
  const authorsQuery = useListAuthors({
    query: { queryKey: getListAuthorsQueryKey(), enabled: open },
  });
  const categoriesQuery = useListCategories({
    query: { queryKey: getListCategoriesQueryKey(), enabled: open },
  });

  const finish = useCallback((result: LinkResult | null) => {
    resolverRef.current?.(result);
    resolverRef.current = null;
    setOpen(false);
    setQuery("");
    setManualUrl("");
  }, []);

  const pick = useCallback((initialText?: string) => {
    return new Promise<LinkResult | null>((resolve) => {
      resolverRef.current = resolve;
      setQuery(initialText?.trim() ?? "");
      setManualUrl("");
      setOpen(true);
    });
  }, []);

  const handleOpenChange = useCallback(
    (next: boolean) => {
      if (!next) finish(null);
      else setOpen(true);
    },
    [finish],
  );

  const posts = postsQuery.data?.items ?? [];
  const q = query.trim().toLowerCase();
  const authors = (authorsQuery.data ?? []).filter(
    (a) => !q || a.name.toLowerCase().includes(q),
  );
  const categories = (categoriesQuery.data ?? []).filter(
    (c) => !q || c.name.toLowerCase().includes(q),
  );

  const value = useMemo<LinkPickerContextValue>(() => ({ pick }), [pick]);

  return (
    <LinkPickerContext.Provider value={value}>
      {children}
      <Dialog open={open} onOpenChange={handleOpenChange}>
        <DialogContent className="overflow-hidden p-0">
          <DialogTitle className="sr-only">Insert link</DialogTitle>
          <Command
            shouldFilter={false}
            className="[&_[cmdk-group-heading]]:px-2 [&_[cmdk-group-heading]]:font-medium [&_[cmdk-group-heading]]:text-muted-foreground"
          >
            <CommandInput
              placeholder="Search posts, authors, categories…"
              value={query}
              onValueChange={setQuery}
            />
            <CommandList>
          <CommandEmpty>No matches found.</CommandEmpty>

          {posts.length > 0 ? (
            <CommandGroup heading="Posts">
              {posts.map((p) => {
                const warn = statusWarn(p.status);
                return (
                  <CommandItem
                    key={p.id}
                    value={`post-${p.id}`}
                    onSelect={() => finish({ href: p.pathname, label: p.title })}
                  >
                    <FileText className="mr-2 h-4 w-4 shrink-0 text-muted-foreground" />
                    <span className="flex-1 truncate">{p.title}</span>
                    {warn ? (
                      <span className="ml-2 flex items-center gap-1 text-xs text-amber-600">
                        <AlertTriangle className="h-3 w-3" />
                        {p.status}
                      </span>
                    ) : null}
                  </CommandItem>
                );
              })}
            </CommandGroup>
          ) : null}

          {authors.length > 0 ? (
            <CommandGroup heading="Authors">
              {authors.slice(0, 6).map((a) => (
                <CommandItem
                  key={a.id}
                  value={`author-${a.id}`}
                  onSelect={() =>
                    finish({ href: `${BLOG_BASE}/author/${a.slug}`, label: a.name })
                  }
                >
                  <User className="mr-2 h-4 w-4 shrink-0 text-muted-foreground" />
                  <span className="flex-1 truncate">{a.name}</span>
                </CommandItem>
              ))}
            </CommandGroup>
          ) : null}

          {categories.length > 0 ? (
            <CommandGroup heading="Categories">
              {categories.slice(0, 6).map((c) => (
                <CommandItem
                  key={c.id}
                  value={`category-${c.id}`}
                  onSelect={() =>
                    finish({ href: `${BLOG_BASE}/category/${c.slug}`, label: c.name })
                  }
                >
                  <Folder className="mr-2 h-4 w-4 shrink-0 text-muted-foreground" />
                  <span className="flex-1 truncate">{c.name}</span>
                </CommandItem>
              ))}
            </CommandGroup>
          ) : null}
            </CommandList>

            <div className="flex items-center gap-2 border-t border-border/60 p-2">
              <Link2 className="h-4 w-4 shrink-0 text-muted-foreground" />
              <Input
                value={manualUrl}
                onChange={(e) => setManualUrl(e.target.value)}
                placeholder="…or paste an external URL"
                className="h-8 flex-1"
                onKeyDown={(e) => {
                  if (e.key === "Enter" && manualUrl.trim()) {
                    e.preventDefault();
                    finish({ href: manualUrl.trim(), label: manualUrl.trim() });
                  }
                }}
              />
              <Button
                size="sm"
                disabled={!manualUrl.trim()}
                onClick={() => finish({ href: manualUrl.trim(), label: manualUrl.trim() })}
              >
                Use URL
              </Button>
            </div>
          </Command>
        </DialogContent>
      </Dialog>
    </LinkPickerContext.Provider>
  );
}

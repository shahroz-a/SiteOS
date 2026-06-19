import { type ReactNode } from "react";
import { Link, useLocation } from "wouter";
import {
  ArrowLeftRight,
  BarChart3,
  FileText,
  FileWarning,
  FolderTree,
  Home,
  Image,
  ScrollText,
  Search,
  Signpost,
  Table2,
  Tag,
  UserPen,
  Users,
} from "lucide-react";
import {
  Avatar,
  AvatarFallback,
  AvatarImage,
} from "@workspace/ui/avatar";
import { Badge } from "@workspace/ui/badge";
import { Button } from "@workspace/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@workspace/ui/dropdown-menu";
import { cn } from "@workspace/ui";
import { useCmsAuth } from "@/lib/cms-auth-context";
import { ROLE_META, type Permission } from "@workspace/cms-auth";

interface NavItem {
  label: string;
  href: string;
  icon: typeof Home;
  permission?: Permission;
}

const NAV_ITEMS: NavItem[] = [
  { label: "Home", href: "/", icon: Home },
  {
    label: "Analytics",
    href: "/analytics",
    icon: BarChart3,
    permission: "content.view",
  },
  {
    label: "Content",
    href: "/content",
    icon: FileText,
    permission: "content.view",
  },
  {
    label: "Explorer",
    href: "/explorer",
    icon: Table2,
    permission: "content.view",
  },
  {
    label: "Import / Export",
    href: "/import-export",
    icon: ArrowLeftRight,
    permission: "content.view",
  },
  {
    label: "Media",
    href: "/media",
    icon: Image,
    permission: "media.manage",
  },
  {
    label: "Review queue",
    href: "/review-queue",
    icon: FileWarning,
    permission: "review.approve",
  },
  {
    label: "Authors",
    href: "/authors",
    icon: UserPen,
    permission: "taxonomy.manage",
  },
  {
    label: "Categories",
    href: "/categories",
    icon: FolderTree,
    permission: "taxonomy.manage",
  },
  { label: "Tags", href: "/tags", icon: Tag, permission: "taxonomy.manage" },
  {
    label: "Search",
    href: "/search",
    icon: Search,
    permission: "content.view",
  },
  {
    label: "Redirects",
    href: "/redirects",
    icon: Signpost,
    permission: "url.manage",
  },
  { label: "Users", href: "/users", icon: Users, permission: "users.manage" },
  {
    label: "Audit log",
    href: "/audit-log",
    icon: ScrollText,
    permission: "audit.view",
  },
];

function initialsFor(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return "?";
  if (parts.length === 1) return parts[0]!.slice(0, 2).toUpperCase();
  return (parts[0]![0]! + parts[parts.length - 1]![0]!).toUpperCase();
}

export function AppShell({ children }: { children: ReactNode }) {
  const { user, role, can, logout } = useCmsAuth();
  const [location] = useLocation();

  const displayName =
    [user?.firstName, user?.lastName].filter(Boolean).join(" ") ||
    user?.email ||
    "Account";
  const roleLabel = role ? ROLE_META[role].label : null;

  const visibleNav = NAV_ITEMS.filter(
    (item) => !item.permission || can(item.permission),
  );

  return (
    <div className="min-h-screen bg-background text-foreground">
      <header className="sticky top-0 z-30 border-b border-border/60 bg-background/95 backdrop-blur supports-[backdrop-filter]:bg-background/80">
        <div className="flex h-14 items-center justify-between px-4 md:px-6">
          <div className="flex items-center gap-2">
            <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-primary/10 text-primary font-serif text-lg font-semibold">
              B
            </div>
            <span className="font-serif text-lg font-semibold tracking-tight">
              Blog Studio
            </span>
          </div>

          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button variant="ghost" className="h-10 gap-2 px-2">
                <Avatar className="h-8 w-8">
                  {user?.profileImageUrl ? (
                    <AvatarImage src={user.profileImageUrl} alt={displayName} />
                  ) : null}
                  <AvatarFallback>{initialsFor(displayName)}</AvatarFallback>
                </Avatar>
                <span className="hidden text-sm font-medium md:inline">
                  {displayName}
                </span>
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="w-56">
              <DropdownMenuLabel className="flex flex-col gap-1">
                <span className="truncate text-sm font-medium">{displayName}</span>
                {user?.email ? (
                  <span className="truncate text-xs font-normal text-muted-foreground">
                    {user.email}
                  </span>
                ) : null}
                {roleLabel ? (
                  <Badge variant="secondary" className="mt-1 w-fit">
                    {roleLabel}
                  </Badge>
                ) : null}
              </DropdownMenuLabel>
              <DropdownMenuSeparator />
              <DropdownMenuItem onClick={logout}>Sign out</DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
      </header>

      <div className="flex">
        <aside className="hidden w-56 shrink-0 border-r border-border/60 md:block">
          <nav className="flex flex-col gap-1 p-3">
            {visibleNav.map((item) => {
              const active =
                item.href === "/"
                  ? location === "/"
                  : location.startsWith(item.href);
              const Icon = item.icon;
              return (
                <Link
                  key={item.href}
                  href={item.href}
                  className={cn(
                    "flex items-center gap-3 rounded-lg px-3 py-2 text-sm font-medium transition-colors",
                    active
                      ? "bg-primary/10 text-primary"
                      : "text-muted-foreground hover:bg-muted hover:text-foreground",
                  )}
                >
                  <Icon className="h-4 w-4" />
                  {item.label}
                </Link>
              );
            })}
          </nav>
        </aside>

        <main className="min-w-0 flex-1 p-4 md:p-8">{children}</main>
      </div>
    </div>
  );
}

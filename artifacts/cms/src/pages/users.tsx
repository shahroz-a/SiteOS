import { useQueryClient } from "@tanstack/react-query";
import {
  useListCmsUsers,
  useUpdateCmsUserRole,
  getListCmsUsersQueryKey,
  type CmsUser,
} from "@workspace/api-client-react";
import { ROLES, ROLE_META, type Role } from "@workspace/cms-auth";
import {
  Avatar,
  AvatarFallback,
  AvatarImage,
} from "@/components/ui/avatar";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Skeleton } from "@/components/ui/skeleton";
import { useToast } from "@/hooks/use-toast";
import { useCmsAuth } from "@/lib/cms-auth-context";

function displayName(u: CmsUser): string {
  return (
    [u.firstName, u.lastName].filter(Boolean).join(" ") || u.email || "Unknown"
  );
}

function initials(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return "?";
  if (parts.length === 1) return parts[0]!.slice(0, 2).toUpperCase();
  return (parts[0]![0]! + parts[parts.length - 1]![0]!).toUpperCase();
}

export default function UsersPage() {
  const { user: currentUser } = useCmsAuth();
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const { data, isLoading, isError } = useListCmsUsers();

  const updateRole = useUpdateCmsUserRole({
    mutation: {
      onSuccess: () => {
        queryClient.invalidateQueries({ queryKey: getListCmsUsersQueryKey() });
        toast({ title: "Role updated" });
      },
      onError: () => {
        toast({
          title: "Could not update role",
          description: "You may not have permission, or something went wrong.",
          variant: "destructive",
        });
      },
    },
  });

  const users = data ?? [];

  return (
    <div className="mx-auto max-w-5xl space-y-6">
      <div className="space-y-2">
        <h1 className="font-serif text-4xl tracking-tight">Users</h1>
        <p className="text-muted-foreground">
          Manage team members and their roles. Only admins can change roles.
        </p>
      </div>

      <div className="rounded-lg border border-border/60">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>User</TableHead>
              <TableHead>Email</TableHead>
              <TableHead className="w-48">Role</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {isLoading ? (
              Array.from({ length: 4 }).map((_, i) => (
                <TableRow key={i}>
                  <TableCell>
                    <Skeleton className="h-8 w-40" />
                  </TableCell>
                  <TableCell>
                    <Skeleton className="h-4 w-48" />
                  </TableCell>
                  <TableCell>
                    <Skeleton className="h-9 w-44" />
                  </TableCell>
                </TableRow>
              ))
            ) : isError ? (
              <TableRow>
                <TableCell colSpan={3} className="py-8 text-center text-muted-foreground">
                  Failed to load users.
                </TableCell>
              </TableRow>
            ) : users.length === 0 ? (
              <TableRow>
                <TableCell colSpan={3} className="py-8 text-center text-muted-foreground">
                  No users yet.
                </TableCell>
              </TableRow>
            ) : (
              users.map((u) => {
                const name = displayName(u);
                const isSelf = u.id === currentUser?.id;
                const pending =
                  updateRole.isPending && updateRole.variables?.userId === u.id;
                return (
                  <TableRow key={u.id}>
                    <TableCell>
                      <div className="flex items-center gap-3">
                        <Avatar className="h-8 w-8">
                          {u.profileImageUrl ? (
                            <AvatarImage src={u.profileImageUrl} alt={name} />
                          ) : null}
                          <AvatarFallback>{initials(name)}</AvatarFallback>
                        </Avatar>
                        <span className="font-medium">
                          {name}
                          {isSelf ? (
                            <span className="ml-2 text-xs text-muted-foreground">
                              (you)
                            </span>
                          ) : null}
                        </span>
                      </div>
                    </TableCell>
                    <TableCell className="text-muted-foreground">
                      {u.email ?? "—"}
                    </TableCell>
                    <TableCell>
                      <Select
                        value={u.role}
                        disabled={pending}
                        onValueChange={(value) =>
                          updateRole.mutate({
                            userId: u.id,
                            data: { role: value as Role },
                          })
                        }
                      >
                        <SelectTrigger className="w-44">
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          {ROLES.map((r) => (
                            <SelectItem key={r} value={r}>
                              {ROLE_META[r].label}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </TableCell>
                  </TableRow>
                );
              })
            )}
          </TableBody>
        </Table>
      </div>
    </div>
  );
}

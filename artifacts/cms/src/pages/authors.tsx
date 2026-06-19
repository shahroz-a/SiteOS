import { useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import {
  useListCmsAuthors,
  useCreateCmsAuthor,
  useUpdateCmsAuthor,
  useDeleteCmsAuthor,
  useArchiveCmsAuthor,
  getListCmsAuthorsQueryKey,
  type CmsAuthor,
  type CmsAuthorInput,
} from "@workspace/api-client-react";
import { MoreHorizontal, Plus } from "lucide-react";
import { Button } from "@workspace/ui/button";
import { Badge } from "@workspace/ui/badge";
import { Input } from "@workspace/ui/input";
import { Label } from "@workspace/ui/label";
import { Textarea } from "@workspace/ui/textarea";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@workspace/ui/dialog";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@workspace/ui/alert-dialog";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@workspace/ui/dropdown-menu";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@workspace/ui/table";
import { Skeleton } from "@workspace/ui/skeleton";
import { useToast } from "@workspace/ui";

type FormState = {
  name: string;
  slug: string;
  bio: string;
  email: string;
  role: string;
  avatarUrl: string;
};

const EMPTY: FormState = {
  name: "",
  slug: "",
  bio: "",
  email: "",
  role: "",
  avatarUrl: "",
};

function toInput(f: FormState): CmsAuthorInput {
  const trimmed = (v: string) => (v.trim() === "" ? null : v.trim());
  return {
    name: f.name.trim(),
    slug: f.slug.trim() === "" ? undefined : f.slug.trim(),
    bio: trimmed(f.bio),
    email: trimmed(f.email),
    role: trimmed(f.role),
    avatarUrl: trimmed(f.avatarUrl),
  };
}

export default function AuthorsPage() {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const { data, isLoading, isError } = useListCmsAuthors();

  const [dialogOpen, setDialogOpen] = useState(false);
  const [editing, setEditing] = useState<CmsAuthor | null>(null);
  const [form, setForm] = useState<FormState>(EMPTY);
  const [deleteTarget, setDeleteTarget] = useState<CmsAuthor | null>(null);

  const invalidate = () =>
    queryClient.invalidateQueries({ queryKey: getListCmsAuthorsQueryKey() });

  const onMutationError = (title: string) =>
    toast({
      title,
      description: "You may not have permission, or something went wrong.",
      variant: "destructive",
    });

  const createAuthor = useCreateCmsAuthor({
    mutation: {
      onSuccess: () => {
        invalidate();
        toast({ title: "Author created" });
        setDialogOpen(false);
      },
      onError: () => onMutationError("Could not create author"),
    },
  });
  const updateAuthor = useUpdateCmsAuthor({
    mutation: {
      onSuccess: () => {
        invalidate();
        toast({ title: "Author updated" });
        setDialogOpen(false);
      },
      onError: () => onMutationError("Could not update author"),
    },
  });
  const deleteAuthor = useDeleteCmsAuthor({
    mutation: {
      onSuccess: () => {
        invalidate();
        toast({ title: "Author deleted" });
        setDeleteTarget(null);
      },
      onError: () => onMutationError("Could not delete author"),
    },
  });
  const archiveAuthor = useArchiveCmsAuthor({
    mutation: {
      onSuccess: () => {
        invalidate();
      },
      onError: () => onMutationError("Could not change archive state"),
    },
  });

  const openCreate = () => {
    setEditing(null);
    setForm(EMPTY);
    setDialogOpen(true);
  };

  const openEdit = (a: CmsAuthor) => {
    setEditing(a);
    setForm({
      name: a.name,
      slug: a.slug,
      bio: a.bio ?? "",
      email: a.email ?? "",
      role: a.role ?? "",
      avatarUrl: a.avatarUrl ?? "",
    });
    setDialogOpen(true);
  };

  const submit = () => {
    if (form.name.trim() === "") return;
    const input = toInput(form);
    if (editing) {
      updateAuthor.mutate({ id: editing.id, data: input });
    } else {
      createAuthor.mutate({ data: input });
    }
  };

  const authors = data ?? [];
  const saving = createAuthor.isPending || updateAuthor.isPending;

  return (
    <div className="mx-auto max-w-5xl space-y-6">
      <div className="flex items-start justify-between gap-4">
        <div className="space-y-2">
          <h1 className="font-serif text-4xl tracking-tight">Authors</h1>
          <p className="text-muted-foreground">
            Create, edit, archive, or remove the people credited on posts.
          </p>
        </div>
        <Button onClick={openCreate} className="gap-2">
          <Plus className="h-4 w-4" />
          New author
        </Button>
      </div>

      <div className="rounded-lg border border-border/60">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Name</TableHead>
              <TableHead>Slug</TableHead>
              <TableHead className="w-24 text-right">Posts</TableHead>
              <TableHead className="w-28">Status</TableHead>
              <TableHead className="w-12" />
            </TableRow>
          </TableHeader>
          <TableBody>
            {isLoading ? (
              Array.from({ length: 4 }).map((_, i) => (
                <TableRow key={i}>
                  <TableCell>
                    <Skeleton className="h-5 w-40" />
                  </TableCell>
                  <TableCell>
                    <Skeleton className="h-4 w-32" />
                  </TableCell>
                  <TableCell>
                    <Skeleton className="ml-auto h-4 w-8" />
                  </TableCell>
                  <TableCell>
                    <Skeleton className="h-5 w-16" />
                  </TableCell>
                  <TableCell />
                </TableRow>
              ))
            ) : isError ? (
              <TableRow>
                <TableCell colSpan={5} className="py-8 text-center text-muted-foreground">
                  Failed to load authors.
                </TableCell>
              </TableRow>
            ) : authors.length === 0 ? (
              <TableRow>
                <TableCell colSpan={5} className="py-8 text-center text-muted-foreground">
                  No authors yet.
                </TableCell>
              </TableRow>
            ) : (
              authors.map((a) => (
                <TableRow key={a.id} className={a.archived ? "opacity-60" : ""}>
                  <TableCell className="font-medium">{a.name}</TableCell>
                  <TableCell className="text-muted-foreground">{a.slug}</TableCell>
                  <TableCell className="text-right tabular-nums">{a.postCount}</TableCell>
                  <TableCell>
                    {a.archived ? (
                      <Badge variant="secondary">Archived</Badge>
                    ) : (
                      <Badge variant="outline">Active</Badge>
                    )}
                  </TableCell>
                  <TableCell>
                    <DropdownMenu>
                      <DropdownMenuTrigger asChild>
                        <Button variant="ghost" size="icon" className="h-8 w-8">
                          <MoreHorizontal className="h-4 w-4" />
                        </Button>
                      </DropdownMenuTrigger>
                      <DropdownMenuContent align="end">
                        <DropdownMenuItem onClick={() => openEdit(a)}>
                          Edit
                        </DropdownMenuItem>
                        <DropdownMenuItem
                          onClick={() =>
                            archiveAuthor.mutate({
                              id: a.id,
                              data: { archived: !a.archived },
                            })
                          }
                        >
                          {a.archived ? "Restore" : "Archive"}
                        </DropdownMenuItem>
                        <DropdownMenuItem
                          className="text-destructive focus:text-destructive"
                          onClick={() => setDeleteTarget(a)}
                        >
                          Delete
                        </DropdownMenuItem>
                      </DropdownMenuContent>
                    </DropdownMenu>
                  </TableCell>
                </TableRow>
              ))
            )}
          </TableBody>
        </Table>
      </div>

      <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{editing ? "Edit author" : "New author"}</DialogTitle>
            <DialogDescription>
              Changes to an author propagate to every post they are credited on.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="author-name">Name</Label>
              <Input
                id="author-name"
                value={form.name}
                onChange={(e) => setForm({ ...form, name: e.target.value })}
                placeholder="Jane Doe"
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="author-slug">Slug</Label>
              <Input
                id="author-slug"
                value={form.slug}
                onChange={(e) => setForm({ ...form, slug: e.target.value })}
                placeholder="Auto-generated from name if left blank"
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="author-email">Email</Label>
              <Input
                id="author-email"
                value={form.email}
                onChange={(e) => setForm({ ...form, email: e.target.value })}
                placeholder="jane@example.com"
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="author-role">Role</Label>
              <Input
                id="author-role"
                value={form.role}
                onChange={(e) => setForm({ ...form, role: e.target.value })}
                placeholder="Travel Writer"
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="author-avatar">Avatar URL</Label>
              <Input
                id="author-avatar"
                value={form.avatarUrl}
                onChange={(e) => setForm({ ...form, avatarUrl: e.target.value })}
                placeholder="https://…"
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="author-bio">Bio</Label>
              <Textarea
                id="author-bio"
                value={form.bio}
                onChange={(e) => setForm({ ...form, bio: e.target.value })}
                rows={3}
              />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setDialogOpen(false)}>
              Cancel
            </Button>
            <Button onClick={submit} disabled={saving || form.name.trim() === ""}>
              {editing ? "Save changes" : "Create author"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <AlertDialog
        open={deleteTarget !== null}
        onOpenChange={(open) => !open && setDeleteTarget(null)}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete author?</AlertDialogTitle>
            <AlertDialogDescription>
              {deleteTarget
                ? `“${deleteTarget.name}” will be removed. Posts will be left without this author. This cannot be undone.`
                : ""}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
              onClick={() => deleteTarget && deleteAuthor.mutate({ id: deleteTarget.id })}
            >
              Delete
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}

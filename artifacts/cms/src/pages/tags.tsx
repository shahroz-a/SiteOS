import { useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import {
  useListCmsTags,
  useCreateCmsTag,
  useUpdateCmsTag,
  useDeleteCmsTag,
  useArchiveCmsTag,
  useMergeCmsTag,
  getListCmsTagsQueryKey,
  type CmsTag,
  type CmsTagInput,
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
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@workspace/ui/select";
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

type FormState = { name: string; slug: string; description: string };

const EMPTY: FormState = { name: "", slug: "", description: "" };

function toInput(f: FormState): CmsTagInput {
  return {
    name: f.name.trim(),
    slug: f.slug.trim() === "" ? undefined : f.slug.trim(),
    description: f.description.trim() === "" ? null : f.description.trim(),
  };
}

export default function TagsPage() {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const { data, isLoading, isError } = useListCmsTags();

  const [dialogOpen, setDialogOpen] = useState(false);
  const [editing, setEditing] = useState<CmsTag | null>(null);
  const [form, setForm] = useState<FormState>(EMPTY);
  const [deleteTarget, setDeleteTarget] = useState<CmsTag | null>(null);
  const [mergeSource, setMergeSource] = useState<CmsTag | null>(null);
  const [mergeTargetId, setMergeTargetId] = useState<string>("");

  const invalidate = () =>
    queryClient.invalidateQueries({ queryKey: getListCmsTagsQueryKey() });

  const onMutationError = (title: string) =>
    toast({
      title,
      description: "You may not have permission, or something went wrong.",
      variant: "destructive",
    });

  const createTag = useCreateCmsTag({
    mutation: {
      onSuccess: () => {
        invalidate();
        toast({ title: "Tag created" });
        setDialogOpen(false);
      },
      onError: () => onMutationError("Could not create tag"),
    },
  });
  const updateTag = useUpdateCmsTag({
    mutation: {
      onSuccess: () => {
        invalidate();
        toast({ title: "Tag updated" });
        setDialogOpen(false);
      },
      onError: () => onMutationError("Could not update tag"),
    },
  });
  const deleteTag = useDeleteCmsTag({
    mutation: {
      onSuccess: () => {
        invalidate();
        toast({ title: "Tag deleted" });
        setDeleteTarget(null);
      },
      onError: () => onMutationError("Could not delete tag"),
    },
  });
  const archiveTag = useArchiveCmsTag({
    mutation: {
      onSuccess: () => invalidate(),
      onError: () => onMutationError("Could not change archive state"),
    },
  });
  const mergeTag = useMergeCmsTag({
    mutation: {
      onSuccess: () => {
        invalidate();
        toast({ title: "Tags merged" });
        setMergeSource(null);
        setMergeTargetId("");
      },
      onError: () => onMutationError("Could not merge tags"),
    },
  });

  const tags = data ?? [];

  const openCreate = () => {
    setEditing(null);
    setForm(EMPTY);
    setDialogOpen(true);
  };

  const openEdit = (t: CmsTag) => {
    setEditing(t);
    setForm({ name: t.name, slug: t.slug, description: t.description ?? "" });
    setDialogOpen(true);
  };

  const submit = () => {
    if (form.name.trim() === "") return;
    const input = toInput(form);
    if (editing) {
      updateTag.mutate({ id: editing.id, data: input });
    } else {
      createTag.mutate({ data: input });
    }
  };

  const saving = createTag.isPending || updateTag.isPending;
  const mergeChoices = tags.filter((t) => t.id !== mergeSource?.id);

  return (
    <div className="mx-auto max-w-5xl space-y-6">
      <div className="flex items-start justify-between gap-4">
        <div className="space-y-2">
          <h1 className="font-serif text-4xl tracking-tight">Tags</h1>
          <p className="text-muted-foreground">
            Free-form labels for posts. Merge folds one tag's posts into another.
          </p>
        </div>
        <Button onClick={openCreate} className="gap-2">
          <Plus className="h-4 w-4" />
          New tag
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
                  Failed to load tags.
                </TableCell>
              </TableRow>
            ) : tags.length === 0 ? (
              <TableRow>
                <TableCell colSpan={5} className="py-8 text-center text-muted-foreground">
                  No tags yet.
                </TableCell>
              </TableRow>
            ) : (
              tags.map((t) => (
                <TableRow key={t.id} className={t.archived ? "opacity-60" : ""}>
                  <TableCell className="font-medium">{t.name}</TableCell>
                  <TableCell className="text-muted-foreground">{t.slug}</TableCell>
                  <TableCell className="text-right tabular-nums">{t.postCount}</TableCell>
                  <TableCell>
                    {t.archived ? (
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
                        <DropdownMenuItem onClick={() => openEdit(t)}>
                          Edit
                        </DropdownMenuItem>
                        <DropdownMenuItem
                          onClick={() => {
                            setMergeSource(t);
                            setMergeTargetId("");
                          }}
                        >
                          Merge into…
                        </DropdownMenuItem>
                        <DropdownMenuItem
                          onClick={() =>
                            archiveTag.mutate({
                              id: t.id,
                              data: { archived: !t.archived },
                            })
                          }
                        >
                          {t.archived ? "Restore" : "Archive"}
                        </DropdownMenuItem>
                        <DropdownMenuItem
                          className="text-destructive focus:text-destructive"
                          onClick={() => setDeleteTarget(t)}
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
            <DialogTitle>{editing ? "Edit tag" : "New tag"}</DialogTitle>
          </DialogHeader>
          <div className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="tag-name">Name</Label>
              <Input
                id="tag-name"
                value={form.name}
                onChange={(e) => setForm({ ...form, name: e.target.value })}
                placeholder="Food & Drink"
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="tag-slug">Slug</Label>
              <Input
                id="tag-slug"
                value={form.slug}
                onChange={(e) => setForm({ ...form, slug: e.target.value })}
                placeholder="Auto-generated from name if left blank"
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="tag-description">Description</Label>
              <Textarea
                id="tag-description"
                value={form.description}
                onChange={(e) => setForm({ ...form, description: e.target.value })}
                rows={3}
              />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setDialogOpen(false)}>
              Cancel
            </Button>
            <Button onClick={submit} disabled={saving || form.name.trim() === ""}>
              {editing ? "Save changes" : "Create tag"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog
        open={mergeSource !== null}
        onOpenChange={(open) => {
          if (!open) {
            setMergeSource(null);
            setMergeTargetId("");
          }
        }}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Merge tag</DialogTitle>
            <DialogDescription>
              {mergeSource
                ? `Move every post tagged “${mergeSource.name}” onto another tag, then delete “${mergeSource.name}”. This cannot be undone.`
                : ""}
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-2">
            <Label htmlFor="merge-tag-target">Merge into</Label>
            <Select value={mergeTargetId} onValueChange={setMergeTargetId}>
              <SelectTrigger id="merge-tag-target">
                <SelectValue placeholder="Select a tag" />
              </SelectTrigger>
              <SelectContent>
                {mergeChoices.map((t) => (
                  <SelectItem key={t.id} value={t.id}>
                    {t.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <DialogFooter>
            <Button
              variant="outline"
              onClick={() => {
                setMergeSource(null);
                setMergeTargetId("");
              }}
            >
              Cancel
            </Button>
            <Button
              disabled={mergeTargetId === "" || mergeTag.isPending}
              onClick={() =>
                mergeSource &&
                mergeTargetId !== "" &&
                mergeTag.mutate({
                  id: mergeSource.id,
                  data: { targetId: mergeTargetId },
                })
              }
            >
              Merge
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
            <AlertDialogTitle>Delete tag?</AlertDialogTitle>
            <AlertDialogDescription>
              {deleteTarget
                ? `“${deleteTarget.name}” will be removed from all posts. This cannot be undone.`
                : ""}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
              onClick={() => deleteTarget && deleteTag.mutate({ id: deleteTarget.id })}
            >
              Delete
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}

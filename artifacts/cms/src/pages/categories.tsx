import { useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import {
  useListCmsCategories,
  useCreateCmsCategory,
  useUpdateCmsCategory,
  useDeleteCmsCategory,
  useArchiveCmsCategory,
  useMergeCmsCategory,
  getListCmsCategoriesQueryKey,
  type CmsCategory,
  type CmsCategoryInput,
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

const NO_PARENT = "__none__";

type FormState = {
  name: string;
  slug: string;
  description: string;
  parentId: string;
};

const EMPTY: FormState = { name: "", slug: "", description: "", parentId: NO_PARENT };

function toInput(f: FormState): CmsCategoryInput {
  return {
    name: f.name.trim(),
    slug: f.slug.trim() === "" ? undefined : f.slug.trim(),
    description: f.description.trim() === "" ? null : f.description.trim(),
    parentId: f.parentId === NO_PARENT ? null : f.parentId,
  };
}

export default function CategoriesPage() {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const { data, isLoading, isError } = useListCmsCategories();

  const [dialogOpen, setDialogOpen] = useState(false);
  const [editing, setEditing] = useState<CmsCategory | null>(null);
  const [form, setForm] = useState<FormState>(EMPTY);
  const [deleteTarget, setDeleteTarget] = useState<CmsCategory | null>(null);
  const [mergeSource, setMergeSource] = useState<CmsCategory | null>(null);
  const [mergeTargetId, setMergeTargetId] = useState<string>("");

  const invalidate = () =>
    queryClient.invalidateQueries({ queryKey: getListCmsCategoriesQueryKey() });

  const onMutationError = (title: string) =>
    toast({
      title,
      description: "You may not have permission, or something went wrong.",
      variant: "destructive",
    });

  const createCategory = useCreateCmsCategory({
    mutation: {
      onSuccess: () => {
        invalidate();
        toast({ title: "Category created" });
        setDialogOpen(false);
      },
      onError: () => onMutationError("Could not create category"),
    },
  });
  const updateCategory = useUpdateCmsCategory({
    mutation: {
      onSuccess: () => {
        invalidate();
        toast({ title: "Category updated" });
        setDialogOpen(false);
      },
      onError: () => onMutationError("Could not update category"),
    },
  });
  const deleteCategory = useDeleteCmsCategory({
    mutation: {
      onSuccess: () => {
        invalidate();
        toast({ title: "Category deleted" });
        setDeleteTarget(null);
      },
      onError: () => onMutationError("Could not delete category"),
    },
  });
  const archiveCategory = useArchiveCmsCategory({
    mutation: {
      onSuccess: () => invalidate(),
      onError: () => onMutationError("Could not change archive state"),
    },
  });
  const mergeCategory = useMergeCmsCategory({
    mutation: {
      onSuccess: () => {
        invalidate();
        toast({ title: "Categories merged" });
        setMergeSource(null);
        setMergeTargetId("");
      },
      onError: () => onMutationError("Could not merge categories"),
    },
  });

  const categories = data ?? [];
  const byId = new Map(categories.map((c) => [c.id, c]));

  const openCreate = () => {
    setEditing(null);
    setForm(EMPTY);
    setDialogOpen(true);
  };

  const openEdit = (c: CmsCategory) => {
    setEditing(c);
    setForm({
      name: c.name,
      slug: c.slug,
      description: c.description ?? "",
      parentId: c.parentId ?? NO_PARENT,
    });
    setDialogOpen(true);
  };

  const submit = () => {
    if (form.name.trim() === "") return;
    const input = toInput(form);
    if (editing) {
      updateCategory.mutate({ id: editing.id, data: input });
    } else {
      createCategory.mutate({ data: input });
    }
  };

  const saving = createCategory.isPending || updateCategory.isPending;
  // A category cannot be its own parent.
  const parentChoices = categories.filter((c) => c.id !== editing?.id);
  // Merge can target any other category.
  const mergeChoices = categories.filter((c) => c.id !== mergeSource?.id);

  return (
    <div className="mx-auto max-w-5xl space-y-6">
      <div className="flex items-start justify-between gap-4">
        <div className="space-y-2">
          <h1 className="font-serif text-4xl tracking-tight">Categories</h1>
          <p className="text-muted-foreground">
            Organize posts into a hierarchy. Merge folds one category's posts and
            child categories into another.
          </p>
        </div>
        <Button onClick={openCreate} className="gap-2">
          <Plus className="h-4 w-4" />
          New category
        </Button>
      </div>

      <div className="rounded-lg border border-border/60">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Name</TableHead>
              <TableHead>Slug</TableHead>
              <TableHead>Parent</TableHead>
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
                    <Skeleton className="h-4 w-24" />
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
                <TableCell colSpan={6} className="py-8 text-center text-muted-foreground">
                  Failed to load categories.
                </TableCell>
              </TableRow>
            ) : categories.length === 0 ? (
              <TableRow>
                <TableCell colSpan={6} className="py-8 text-center text-muted-foreground">
                  No categories yet.
                </TableCell>
              </TableRow>
            ) : (
              categories.map((c) => (
                <TableRow key={c.id} className={c.archived ? "opacity-60" : ""}>
                  <TableCell className="font-medium">{c.name}</TableCell>
                  <TableCell className="text-muted-foreground">{c.slug}</TableCell>
                  <TableCell className="text-muted-foreground">
                    {c.parentId ? byId.get(c.parentId)?.name ?? "—" : "—"}
                  </TableCell>
                  <TableCell className="text-right tabular-nums">{c.postCount}</TableCell>
                  <TableCell>
                    {c.archived ? (
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
                        <DropdownMenuItem onClick={() => openEdit(c)}>
                          Edit
                        </DropdownMenuItem>
                        <DropdownMenuItem
                          onClick={() => {
                            setMergeSource(c);
                            setMergeTargetId("");
                          }}
                        >
                          Merge into…
                        </DropdownMenuItem>
                        <DropdownMenuItem
                          onClick={() =>
                            archiveCategory.mutate({
                              id: c.id,
                              data: { archived: !c.archived },
                            })
                          }
                        >
                          {c.archived ? "Restore" : "Archive"}
                        </DropdownMenuItem>
                        <DropdownMenuItem
                          className="text-destructive focus:text-destructive"
                          onClick={() => setDeleteTarget(c)}
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
            <DialogTitle>{editing ? "Edit category" : "New category"}</DialogTitle>
          </DialogHeader>
          <div className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="cat-name">Name</Label>
              <Input
                id="cat-name"
                value={form.name}
                onChange={(e) => setForm({ ...form, name: e.target.value })}
                placeholder="Things to do"
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="cat-slug">Slug</Label>
              <Input
                id="cat-slug"
                value={form.slug}
                onChange={(e) => setForm({ ...form, slug: e.target.value })}
                placeholder="Auto-generated from name if left blank"
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="cat-parent">Parent</Label>
              <Select
                value={form.parentId}
                onValueChange={(value) => setForm({ ...form, parentId: value })}
              >
                <SelectTrigger id="cat-parent">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value={NO_PARENT}>No parent (top level)</SelectItem>
                  {parentChoices.map((c) => (
                    <SelectItem key={c.id} value={c.id}>
                      {c.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-2">
              <Label htmlFor="cat-description">Description</Label>
              <Textarea
                id="cat-description"
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
              {editing ? "Save changes" : "Create category"}
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
            <DialogTitle>Merge category</DialogTitle>
            <DialogDescription>
              {mergeSource
                ? `Move every post and child category from “${mergeSource.name}” into another category, then delete “${mergeSource.name}”. This cannot be undone.`
                : ""}
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-2">
            <Label htmlFor="merge-target">Merge into</Label>
            <Select value={mergeTargetId} onValueChange={setMergeTargetId}>
              <SelectTrigger id="merge-target">
                <SelectValue placeholder="Select a category" />
              </SelectTrigger>
              <SelectContent>
                {mergeChoices.map((c) => (
                  <SelectItem key={c.id} value={c.id}>
                    {c.name}
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
              disabled={mergeTargetId === "" || mergeCategory.isPending}
              onClick={() =>
                mergeSource &&
                mergeTargetId !== "" &&
                mergeCategory.mutate({
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
            <AlertDialogTitle>Delete category?</AlertDialogTitle>
            <AlertDialogDescription>
              {deleteTarget
                ? `“${deleteTarget.name}” will be removed and its child categories reparented. This cannot be undone.`
                : ""}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
              onClick={() =>
                deleteTarget && deleteCategory.mutate({ id: deleteTarget.id })
              }
            >
              Delete
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}

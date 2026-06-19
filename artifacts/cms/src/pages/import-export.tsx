import { useRef, useState } from "react";
import {
  useExportCmsContent,
  useExportCmsContentFull,
  useImportCmsContent,
  useBackupCmsContent,
  useRestoreCmsContent,
  useGetCmsPayloadMapping,
  getExportCmsContentQueryKey,
  getExportCmsContentFullQueryKey,
  getBackupCmsContentQueryKey,
  type ContentImportResult,
} from "@workspace/api-client-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
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

type ExportFormat = "json" | "csv" | "markdown" | "sql" | "payload";
type ImportFormat = "json" | "csv" | "markdown" | "payload";

const EXPORT_FORMATS: { value: ExportFormat; label: string }[] = [
  { value: "json", label: "JSON (canonical, lossless)" },
  { value: "csv", label: "CSV (flat posts)" },
  { value: "markdown", label: "Markdown (front-matter + HTML)" },
  { value: "sql", label: "SQL (INSERT dump)" },
  { value: "payload", label: "Payload CMS manifest" },
];

const IMPORT_FORMATS: { value: ImportFormat; label: string }[] = [
  { value: "json", label: "JSON" },
  { value: "csv", label: "CSV" },
  { value: "markdown", label: "Markdown" },
  { value: "payload", label: "Payload manifest" },
];

/** Trigger a browser download of a string payload. */
function downloadFile(filename: string, contentType: string, content: string) {
  const blob = new Blob([content], { type: contentType });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}

function ImportSummary({ result }: { result: ContentImportResult }) {
  const items: { label: string; value: number }[] = [
    { label: "Posts created", value: result.postsCreated },
    { label: "Posts updated", value: result.postsUpdated },
    { label: "Posts unchanged", value: result.postsUnchanged },
    { label: "Authors", value: result.authorsUpserted },
    { label: "Categories", value: result.categoriesUpserted },
    { label: "Tags", value: result.tagsUpserted },
    { label: "Links resolved", value: result.internalLinksResolved },
  ];
  return (
    <div className="mt-4 grid grid-cols-2 gap-2 sm:grid-cols-4">
      {items.map((it) => (
        <div key={it.label} className="rounded-md border border-border/60 p-3">
          <div className="text-2xl font-semibold tabular-nums">{it.value}</div>
          <div className="text-xs text-muted-foreground">{it.label}</div>
        </div>
      ))}
    </div>
  );
}

export default function ImportExportPage() {
  const { can } = useCmsAuth();
  const { toast } = useToast();

  const [format, setFormat] = useState<ExportFormat>("json");
  const exportQuery = useExportCmsContent(
    { format },
    { query: { enabled: false, queryKey: getExportCmsContentQueryKey({ format }) } },
  );
  const fullExport = useExportCmsContentFull({
    query: { enabled: false, queryKey: getExportCmsContentFullQueryKey() },
  });
  const backup = useBackupCmsContent({
    query: { enabled: false, queryKey: getBackupCmsContentQueryKey() },
  });

  const [importFormat, setImportFormat] = useState<ImportFormat>("json");
  const [importResult, setImportResult] = useState<ContentImportResult | null>(
    null,
  );
  const importFileRef = useRef<HTMLInputElement>(null);
  const restoreFileRef = useRef<HTMLInputElement>(null);

  const importMutation = useImportCmsContent();
  const restoreMutation = useRestoreCmsContent();

  const canRestore = can("settings.manage");

  async function handleExport() {
    try {
      const res = await exportQuery.refetch();
      const data = res.data;
      if (!data) throw new Error("No data returned");
      downloadFile(data.filename, data.contentType, data.content);
      toast({ title: "Export ready", description: data.filename });
    } catch {
      toast({ title: "Export failed", variant: "destructive" });
    }
  }

  async function handleFullExport() {
    try {
      const res = await fullExport.refetch();
      const data = res.data;
      if (!data) throw new Error("No data returned");
      for (const file of data.files) {
        downloadFile(file.filename, file.contentType, file.content);
      }
      toast({
        title: "Full export ready",
        description: `${data.files.length} files downloaded`,
      });
    } catch {
      toast({ title: "Full export failed", variant: "destructive" });
    }
  }

  async function handleBackup() {
    try {
      const res = await backup.refetch();
      const data = res.data;
      if (!data) throw new Error("No data returned");
      downloadFile(data.filename, data.contentType, data.content);
      toast({ title: "Backup downloaded", description: data.filename });
    } catch {
      toast({ title: "Backup failed", variant: "destructive" });
    }
  }

  function readFile(file: File): Promise<string> {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(String(reader.result ?? ""));
      reader.onerror = () => reject(reader.error);
      reader.readAsText(file);
    });
  }

  async function handleImportFile(file: File) {
    try {
      const content = await readFile(file);
      const result = await importMutation.mutateAsync({
        data: { format: importFormat, content },
      });
      setImportResult(result);
      toast({
        title: "Import complete",
        description: `${result.postsCreated} created, ${result.postsUpdated} updated`,
      });
    } catch {
      toast({
        title: "Import failed",
        description: "Check the file format and try again.",
        variant: "destructive",
      });
    } finally {
      if (importFileRef.current) importFileRef.current.value = "";
    }
  }

  async function handleRestoreFile(file: File) {
    try {
      const content = await readFile(file);
      const result = await restoreMutation.mutateAsync({ data: { content } });
      setImportResult(result);
      toast({
        title: "Restore complete",
        description: `${result.postsCreated} created, ${result.postsUpdated} updated`,
      });
    } catch {
      toast({ title: "Restore failed", variant: "destructive" });
    } finally {
      if (restoreFileRef.current) restoreFileRef.current.value = "";
    }
  }

  return (
    <div className="mx-auto max-w-5xl space-y-6">
      <div className="space-y-2">
        <h1 className="font-serif text-4xl tracking-tight">Import &amp; Export</h1>
        <p className="text-muted-foreground">
          Move content in and out in any supported format, keep backups, and
          inspect Payload CMS compatibility.
        </p>
      </div>

      <div className="grid gap-6 md:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle>Export</CardTitle>
            <CardDescription>
              Download the entire corpus in a single format.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="flex items-center gap-2">
              <Select
                value={format}
                onValueChange={(v) => setFormat(v as ExportFormat)}
              >
                <SelectTrigger className="w-full">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {EXPORT_FORMATS.map((f) => (
                    <SelectItem key={f.value} value={f.value}>
                      {f.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <Button
                onClick={handleExport}
                disabled={exportQuery.isFetching}
              >
                {exportQuery.isFetching ? "Preparing…" : "Export"}
              </Button>
            </div>
            <Button
              variant="outline"
              className="w-full"
              onClick={handleFullExport}
              disabled={fullExport.isFetching}
            >
              {fullExport.isFetching
                ? "Preparing…"
                : "One-click full export (all formats)"}
            </Button>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Import</CardTitle>
            <CardDescription>
              Non-destructive: matches existing content by slug / URL and only
              rewrites what changed.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            {can("content.create") ? (
              <>
                <div className="flex items-center gap-2">
                  <Select
                    value={importFormat}
                    onValueChange={(v) => setImportFormat(v as ImportFormat)}
                  >
                    <SelectTrigger className="w-full">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {IMPORT_FORMATS.map((f) => (
                        <SelectItem key={f.value} value={f.value}>
                          {f.label}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                  <Button
                    onClick={() => importFileRef.current?.click()}
                    disabled={importMutation.isPending}
                  >
                    {importMutation.isPending ? "Importing…" : "Choose file"}
                  </Button>
                </div>
                <input
                  ref={importFileRef}
                  type="file"
                  className="hidden"
                  onChange={(e) => {
                    const file = e.target.files?.[0];
                    if (file) void handleImportFile(file);
                  }}
                />
              </>
            ) : (
              <p className="text-sm text-muted-foreground">
                You don't have permission to import content.
              </p>
            )}
          </CardContent>
        </Card>
      </div>

      {importResult ? (
        <Card>
          <CardHeader>
            <CardTitle>Last import</CardTitle>
          </CardHeader>
          <CardContent>
            <ImportSummary result={importResult} />
          </CardContent>
        </Card>
      ) : null}

      {canRestore ? (
        <Card>
          <CardHeader>
            <CardTitle>Backup &amp; restore</CardTitle>
            <CardDescription>
              Download a full JSON backup, or restore the corpus from one.
              Admin-only.
            </CardDescription>
          </CardHeader>
          <CardContent className="flex flex-wrap items-center gap-3">
            <Button
              variant="outline"
              onClick={handleBackup}
              disabled={backup.isFetching}
            >
              {backup.isFetching ? "Preparing…" : "Download backup"}
            </Button>
            <Button
              variant="outline"
              onClick={() => restoreFileRef.current?.click()}
              disabled={restoreMutation.isPending}
            >
              {restoreMutation.isPending ? "Restoring…" : "Restore from backup"}
            </Button>
            <input
              ref={restoreFileRef}
              type="file"
              accept="application/json,.json"
              className="hidden"
              onChange={(e) => {
                const file = e.target.files?.[0];
                if (file) void handleRestoreFile(file);
              }}
            />
          </CardContent>
        </Card>
      ) : null}

      <PayloadCompatibilityPanel />
    </div>
  );
}

function PayloadCompatibilityPanel() {
  const { data, isLoading, isError } = useGetCmsPayloadMapping();

  return (
    <Card>
      <CardHeader>
        <CardTitle>Payload CMS compatibility</CardTitle>
        <CardDescription>
          How the migration database maps onto a Payload instance, plus live
          block-type coverage over the current corpus.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-6">
        {isLoading ? (
          <Skeleton className="h-40 w-full" />
        ) : isError || !data ? (
          <p className="text-sm text-muted-foreground">
            Could not load the Payload mapping.
          </p>
        ) : (
          <>
            <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
              <Stat label="Posts" value={data.report.totals.posts} />
              <Stat label="Blocks" value={data.report.totals.blocks} />
              <Stat label="Mapped" value={data.report.totals.mappedBlocks} />
              <Stat
                label="Unmapped"
                value={data.report.totals.unmappedBlocks}
                warn={data.report.totals.unmappedBlocks > 0}
              />
            </div>

            <div>
              <h3 className="mb-2 text-sm font-medium text-muted-foreground">
                Collections
              </h3>
              <div className="flex flex-wrap gap-2">
                {data.collections.map((c) => (
                  <Badge key={c.slug} variant="secondary" className="font-normal">
                    {c.label} ← {c.source}
                  </Badge>
                ))}
              </div>
            </div>

            <div>
              <h3 className="mb-2 text-sm font-medium text-muted-foreground">
                Block-type coverage
              </h3>
              <div className="rounded-lg border border-border/60">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Block type</TableHead>
                      <TableHead>Payload block</TableHead>
                      <TableHead className="text-right">Count</TableHead>
                      <TableHead className="w-28 text-right">Status</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {data.report.blockTypes.length === 0 ? (
                      <TableRow>
                        <TableCell
                          colSpan={4}
                          className="py-8 text-center text-muted-foreground"
                        >
                          No blocks in the corpus yet.
                        </TableCell>
                      </TableRow>
                    ) : (
                      data.report.blockTypes.map((bt) => (
                        <TableRow key={bt.blockType}>
                          <TableCell className="font-medium">
                            {bt.blockType}
                          </TableCell>
                          <TableCell className="text-muted-foreground">
                            {bt.payloadBlock ?? "—"}
                          </TableCell>
                          <TableCell className="text-right tabular-nums">
                            {bt.count}
                          </TableCell>
                          <TableCell className="text-right">
                            {bt.mapped ? (
                              <Badge variant="secondary" className="font-normal">
                                Mapped
                              </Badge>
                            ) : (
                              <Badge variant="destructive" className="font-normal">
                                Unmapped
                              </Badge>
                            )}
                          </TableCell>
                        </TableRow>
                      ))
                    )}
                  </TableBody>
                </Table>
              </div>
            </div>
          </>
        )}
      </CardContent>
    </Card>
  );
}

function Stat({
  label,
  value,
  warn,
}: {
  label: string;
  value: number;
  warn?: boolean;
}) {
  return (
    <div className="rounded-md border border-border/60 p-3">
      <div
        className={
          warn
            ? "text-2xl font-semibold tabular-nums text-destructive"
            : "text-2xl font-semibold tabular-nums"
        }
      >
        {value}
      </div>
      <div className="text-xs text-muted-foreground">{label}</div>
    </div>
  );
}

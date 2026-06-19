/**
 * Per-block-type editing UIs. Each editor receives the block and a partial
 * `onChange` that merges into `block.data` (or top-level fields like `text`).
 * `BlockEditor` dispatches to the right editor by `block.type`.
 */
import { useRef, useState } from "react";
import { ImageIcon, Loader2, Plus, Trash2, Upload } from "lucide-react";
import { Input } from "@workspace/ui/input";
import { Textarea } from "@workspace/ui/textarea";
import { Label } from "@workspace/ui/label";
import { Switch } from "@workspace/ui/switch";
import { Button } from "@workspace/ui/button";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@workspace/ui/select";
import { RichTextEditor } from "./rich-text-editor";
import { MediaPicker } from "@/components/media-picker";
import { UploadedImagePicker } from "@/components/uploaded-image-picker";
import { useImageUpload } from "../lib/use-image-upload";
import type { BlockData, BlockEntry, EditorBlock, GalleryImage } from "./model";

export interface BlockEditorProps {
  block: EditorBlock;
  onChange: (patch: Partial<EditorBlock>) => void;
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="space-y-1.5">
      <Label className="text-xs font-medium text-muted-foreground">{label}</Label>
      {children}
    </div>
  );
}

function patchData(block: EditorBlock, onChange: BlockEditorProps["onChange"], data: Partial<BlockData>) {
  onChange({ data });
}

/**
 * Opens the media library and hands the chosen item back to the caller so a
 * block can reuse an existing Headout CDN image (URL + alt) — no binary upload.
 */
export function LibraryButton({
  onPick,
  label = "Choose from library",
}: {
  onPick: (image: { url: string; alt: string }) => void;
  label?: string;
}) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <Button type="button" variant="outline" size="sm" onClick={() => setOpen(true)}>
        <ImageIcon className="mr-1 h-4 w-4" /> {label}
      </Button>
      <MediaPicker
        open={open}
        onOpenChange={setOpen}
        onSelect={(item) => onPick({ url: item.url, alt: item.alt ?? "" })}
      />
    </>
  );
}

/**
 * Opens the uploaded-image picker (previously uploaded object-storage images)
 * and hands the chosen serving URL back so an editor can reuse an earlier
 * upload without re-uploading or pasting the URL.
 */
function UploadedButton({
  onPick,
  label = "Choose uploaded",
  size = "sm",
}: {
  onPick: (url: string) => void;
  label?: string;
  size?: "sm" | "icon";
}) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <Button
        type="button"
        variant="outline"
        size={size === "icon" ? "icon" : "sm"}
        onClick={() => setOpen(true)}
        title={label}
      >
        <ImageIcon className={size === "icon" ? "h-4 w-4" : "mr-1 h-4 w-4"} />
        {size === "icon" ? null : label}
      </Button>
      <UploadedImagePicker
        open={open}
        onOpenChange={setOpen}
        onSelect={(image) => onPick(image.url)}
      />
    </>
  );
}

/**
 * Upload-an-image control. Opens the native file picker, uploads to object
 * storage and hands the resulting serving URL back via `onUploaded`. Falls back
 * gracefully (inline error) on failure; the adjacent URL field still works.
 */
export function ImageUploadButton({
  onUploaded,
  label = "Upload image",
  size = "sm",
}: {
  onUploaded: (url: string) => void;
  label?: string;
  size?: "sm" | "icon";
}) {
  const inputRef = useRef<HTMLInputElement>(null);
  const { upload, isUploading, error } = useImageUpload();
  const [localError, setLocalError] = useState<string | null>(null);

  const handleFiles = async (files: FileList | null) => {
    const file = files?.[0];
    if (!file) return;
    setLocalError(null);
    try {
      const url = await upload(file);
      onUploaded(url);
    } catch {
      // `error` from the hook holds the message; keep the picker usable.
    } finally {
      if (inputRef.current) inputRef.current.value = "";
    }
  };

  return (
    <div className="flex flex-col gap-1">
      <input
        ref={inputRef}
        type="file"
        accept="image/*"
        className="hidden"
        onChange={(e) => void handleFiles(e.target.files)}
      />
      <Button
        type="button"
        variant="outline"
        size={size === "icon" ? "icon" : "sm"}
        disabled={isUploading}
        onClick={() => inputRef.current?.click()}
        title={label}
      >
        {isUploading ? (
          <Loader2 className={size === "icon" ? "h-4 w-4 animate-spin" : "mr-1 h-4 w-4 animate-spin"} />
        ) : (
          <Upload className={size === "icon" ? "h-4 w-4" : "mr-1 h-4 w-4"} />
        )}
        {size === "icon" ? null : isUploading ? "Uploading…" : label}
      </Button>
      {error || localError ? (
        <span className="text-xs text-destructive">{error ?? localError}</span>
      ) : null}
    </div>
  );
}

/* ---------------- individual editors ---------------- */

function HeadingEditor({ block, onChange }: BlockEditorProps) {
  return (
    <div className="grid grid-cols-[1fr_7rem] gap-3">
      <Field label="Heading text">
        <Input
          value={block.text ?? ""}
          onChange={(e) => onChange({ text: e.target.value })}
          placeholder="Section heading"
        />
      </Field>
      <Field label="Level">
        <Select
          value={String(block.data.level ?? 2)}
          onValueChange={(v) => patchData(block, onChange, { level: Number(v) })}
        >
          <SelectTrigger>
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {[1, 2, 3, 4, 5, 6].map((l) => (
              <SelectItem key={l} value={String(l)}>
                H{l}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </Field>
    </div>
  );
}

function RichTextBlockEditor({ block, onChange }: BlockEditorProps) {
  return (
    <RichTextEditor
      value={block.data.html ?? ""}
      onChange={(html) => patchData(block, onChange, { html })}
      placeholder="Write something…"
    />
  );
}

function HeroEditor({ block, onChange }: BlockEditorProps) {
  const d = block.data;
  return (
    <div className="space-y-3">
      <Field label="Eyebrow">
        <Input value={d.eyebrow ?? ""} onChange={(e) => patchData(block, onChange, { eyebrow: e.target.value })} />
      </Field>
      <Field label="Title">
        <Input value={d.title ?? ""} onChange={(e) => patchData(block, onChange, { title: e.target.value })} />
      </Field>
      <Field label="Subtitle">
        <Textarea value={d.subtitle ?? ""} onChange={(e) => patchData(block, onChange, { subtitle: e.target.value })} rows={2} />
      </Field>
      <div className="grid grid-cols-2 gap-3">
        <Field label="Image URL">
          <Input value={d.imageUrl ?? ""} onChange={(e) => patchData(block, onChange, { imageUrl: e.target.value })} />
        </Field>
        <Field label="Image alt">
          <Input value={d.imageAlt ?? ""} onChange={(e) => patchData(block, onChange, { imageAlt: e.target.value })} />
        </Field>
      </div>
      <LibraryButton
        onPick={({ url, alt }) =>
          patchData(block, onChange, { imageUrl: url, imageAlt: d.imageAlt || alt })
        }
      />
    </div>
  );
}

function ImageEditor({ block, onChange }: BlockEditorProps) {
  const d = block.data;
  return (
    <div className="space-y-3">
      <Field label="Image">
        <div className="flex items-center gap-2">
          <Input
            value={d.src ?? ""}
            onChange={(e) => patchData(block, onChange, { src: e.target.value })}
            placeholder="Paste a URL or upload a file"
          />
          <ImageUploadButton onUploaded={(url) => patchData(block, onChange, { src: url })} label="Upload" />
          <UploadedButton onPick={(url) => patchData(block, onChange, { src: url })} />
          <LibraryButton
            onPick={({ url, alt }) =>
              patchData(block, onChange, { src: url, alt: d.alt || alt })
            }
          />
        </div>
      </Field>
      <div className="grid grid-cols-2 gap-3">
        <Field label="Alt text">
          <Input value={d.alt ?? ""} onChange={(e) => patchData(block, onChange, { alt: e.target.value })} />
        </Field>
        <Field label="Caption">
          <Input value={d.caption ?? ""} onChange={(e) => patchData(block, onChange, { caption: e.target.value })} />
        </Field>
      </div>
      {d.src ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img src={d.src} alt={d.alt ?? ""} className="max-h-40 rounded-md border border-border object-contain" />
      ) : null}
    </div>
  );
}

function GalleryEditor({ block, onChange }: BlockEditorProps) {
  const images = block.data.images ?? [];
  const setImages = (next: GalleryImage[]) => patchData(block, onChange, { images: next });
  return (
    <div className="space-y-3">
      {images.map((img, i) => (
        <div key={i} className="flex items-start gap-2">
          <div className="grid flex-1 grid-cols-2 gap-2">
            <Input
              value={img.src}
              placeholder="Image URL"
              onChange={(e) => setImages(images.map((x, j) => (j === i ? { ...x, src: e.target.value } : x)))}
            />
            <Input
              value={img.alt ?? ""}
              placeholder="Alt text"
              onChange={(e) => setImages(images.map((x, j) => (j === i ? { ...x, alt: e.target.value } : x)))}
            />
          </div>
          <ImageUploadButton
            size="icon"
            label="Upload image"
            onUploaded={(url) => setImages(images.map((x, j) => (j === i ? { ...x, src: url } : x)))}
          />
          <UploadedButton
            size="icon"
            label="Choose uploaded"
            onPick={(url) => setImages(images.map((x, j) => (j === i ? { ...x, src: url } : x)))}
          />
          <Button variant="ghost" size="icon" onClick={() => setImages(images.filter((_, j) => j !== i))}>
            <Trash2 className="h-4 w-4" />
          </Button>
        </div>
      ))}
      <div className="flex flex-wrap gap-2">
        <Button variant="outline" size="sm" onClick={() => setImages([...images, { src: "", alt: "" }])}>
          <Plus className="mr-1 h-4 w-4" /> Add image
        </Button>
        <ImageUploadButton
          label="Upload & add"
          onUploaded={(url) => setImages([...images, { src: url, alt: "" }])}
        />
        <LibraryButton
          label="Add from library"
          onPick={({ url, alt }) => setImages([...images, { src: url, alt }])}
        />
      </div>
    </div>
  );
}

function QuoteEditor({ block, onChange }: BlockEditorProps) {
  return (
    <div className="space-y-3">
      <Field label="Quote">
        <Textarea value={block.text ?? ""} onChange={(e) => onChange({ text: e.target.value })} rows={3} />
      </Field>
      <Field label="Citation">
        <Input value={block.data.cite ?? ""} onChange={(e) => patchData(block, onChange, { cite: e.target.value })} />
      </Field>
    </div>
  );
}

function TableEditor({ block, onChange }: BlockEditorProps) {
  const rows = block.data.rows ?? [];
  const cols = rows[0]?.length ?? 0;
  const setRows = (next: string[][]) => patchData(block, onChange, { rows: next });

  const setCell = (r: number, c: number, val: string) =>
    setRows(rows.map((row, ri) => (ri === r ? row.map((cell, ci) => (ci === c ? val : cell)) : row)));
  const addRow = () => setRows([...rows, Array.from({ length: cols || 1 }, () => "")]);
  const addCol = () => setRows(rows.map((row) => [...row, ""]));
  const removeRow = (r: number) => setRows(rows.filter((_, ri) => ri !== r));
  const removeCol = (c: number) => setRows(rows.map((row) => row.filter((_, ci) => ci !== c)));

  return (
    <div className="space-y-3">
      <label className="flex items-center gap-2 text-sm">
        <Switch
          checked={block.data.hasHeader ?? false}
          onCheckedChange={(v) => patchData(block, onChange, { hasHeader: v })}
        />
        First row is a header
      </label>
      <div className="overflow-x-auto">
        <table className="border-collapse">
          <tbody>
            {rows.map((row, r) => (
              <tr key={r}>
                {row.map((cell, c) => (
                  <td key={c} className="border border-border p-0.5">
                    <Input
                      value={cell}
                      onChange={(e) => setCell(r, c, e.target.value)}
                      className="h-8 min-w-[7rem] border-0 shadow-none focus-visible:ring-1"
                    />
                  </td>
                ))}
                <td className="px-1">
                  <Button variant="ghost" size="icon" className="h-7 w-7" onClick={() => removeRow(r)}>
                    <Trash2 className="h-3.5 w-3.5" />
                  </Button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <div className="flex flex-wrap gap-2">
        <Button variant="outline" size="sm" onClick={addRow}>
          <Plus className="mr-1 h-4 w-4" /> Row
        </Button>
        <Button variant="outline" size="sm" onClick={addCol}>
          <Plus className="mr-1 h-4 w-4" /> Column
        </Button>
        {cols > 1 ? (
          <Button variant="ghost" size="sm" onClick={() => removeCol(cols - 1)}>
            Remove last column
          </Button>
        ) : null}
      </div>
    </div>
  );
}

function EntryListEditor({
  block,
  onChange,
  fields,
  newEntry,
  headingLabel,
}: BlockEditorProps & {
  fields: Array<{ key: keyof BlockEntry; label: string; rich?: boolean; textarea?: boolean }>;
  newEntry: BlockEntry;
  headingLabel?: string;
}) {
  const entries = block.data.entries ?? [];
  const setEntries = (next: BlockEntry[]) => patchData(block, onChange, { entries: next });

  return (
    <div className="space-y-3">
      {headingLabel !== undefined ? (
        <Field label={headingLabel}>
          <Input
            value={block.data.heading ?? ""}
            onChange={(e) => patchData(block, onChange, { heading: e.target.value })}
          />
        </Field>
      ) : null}
      {entries.map((entry, i) => (
        <div key={i} className="space-y-2 rounded-md border border-border/60 p-3">
          <div className="flex items-center justify-between">
            <span className="text-xs font-medium text-muted-foreground">Item {i + 1}</span>
            <Button variant="ghost" size="icon" className="h-7 w-7" onClick={() => setEntries(entries.filter((_, j) => j !== i))}>
              <Trash2 className="h-4 w-4" />
            </Button>
          </div>
          {fields.map((f) => (
            <Field key={String(f.key)} label={f.label}>
              {f.rich ? (
                <RichTextEditor
                  minimal
                  value={(entry[f.key] as string) ?? ""}
                  onChange={(html) =>
                    setEntries(entries.map((x, j) => (j === i ? { ...x, [f.key]: html } : x)))
                  }
                />
              ) : f.textarea ? (
                <Textarea
                  rows={2}
                  value={(entry[f.key] as string) ?? ""}
                  onChange={(e) => setEntries(entries.map((x, j) => (j === i ? { ...x, [f.key]: e.target.value } : x)))}
                />
              ) : (
                <Input
                  value={(entry[f.key] as string) ?? ""}
                  onChange={(e) => setEntries(entries.map((x, j) => (j === i ? { ...x, [f.key]: e.target.value } : x)))}
                />
              )}
            </Field>
          ))}
        </div>
      ))}
      <Button variant="outline" size="sm" onClick={() => setEntries([...entries, { ...newEntry }])}>
        <Plus className="mr-1 h-4 w-4" /> Add item
      </Button>
    </div>
  );
}

function CtaEditor({ block, onChange }: BlockEditorProps) {
  const d = block.data;
  return (
    <div className="space-y-3">
      <Field label="Heading">
        <Input value={d.heading ?? ""} onChange={(e) => patchData(block, onChange, { heading: e.target.value })} />
      </Field>
      <Field label="Body">
        <Textarea rows={2} value={d.body ?? ""} onChange={(e) => patchData(block, onChange, { body: e.target.value })} />
      </Field>
      <div className="grid grid-cols-2 gap-3">
        <Field label="Button label">
          <Input value={d.buttonLabel ?? ""} onChange={(e) => patchData(block, onChange, { buttonLabel: e.target.value })} />
        </Field>
        <Field label="Button link">
          <Input value={d.buttonHref ?? ""} onChange={(e) => patchData(block, onChange, { buttonHref: e.target.value })} />
        </Field>
      </div>
    </div>
  );
}

function NewsletterEditor({ block, onChange }: BlockEditorProps) {
  const d = block.data;
  return (
    <div className="space-y-3">
      <Field label="Heading">
        <Input value={d.heading ?? ""} onChange={(e) => patchData(block, onChange, { heading: e.target.value })} />
      </Field>
      <Field label="Body">
        <Textarea rows={2} value={d.body ?? ""} onChange={(e) => patchData(block, onChange, { body: e.target.value })} />
      </Field>
      <div className="grid grid-cols-2 gap-3">
        <Field label="Input placeholder">
          <Input value={d.placeholder ?? ""} onChange={(e) => patchData(block, onChange, { placeholder: e.target.value })} />
        </Field>
        <Field label="Button label">
          <Input value={d.buttonLabel ?? ""} onChange={(e) => patchData(block, onChange, { buttonLabel: e.target.value })} />
        </Field>
      </div>
    </div>
  );
}

function VideoEditor({ block, onChange }: BlockEditorProps) {
  const d = block.data;
  return (
    <div className="space-y-3">
      <Field label="Video URL (YouTube, Vimeo or file)">
        <Input value={d.url ?? ""} onChange={(e) => patchData(block, onChange, { url: e.target.value })} placeholder="https://youtube.com/watch?v=…" />
      </Field>
      <Field label="Caption">
        <Input value={d.caption ?? ""} onChange={(e) => patchData(block, onChange, { caption: e.target.value })} />
      </Field>
    </div>
  );
}

function SectionEditor({ block, onChange }: BlockEditorProps) {
  return (
    <Field label="Section heading (optional)">
      <Input
        value={block.data.heading ?? ""}
        onChange={(e) => patchData(block, onChange, { heading: e.target.value })}
        placeholder="Group heading"
      />
    </Field>
  );
}

export function BlockEditor({ block, onChange }: BlockEditorProps) {
  switch (block.type) {
    case "heading":
      return <HeadingEditor block={block} onChange={onChange} />;
    case "richText":
      return <RichTextBlockEditor block={block} onChange={onChange} />;
    case "hero":
      return <HeroEditor block={block} onChange={onChange} />;
    case "image":
      return <ImageEditor block={block} onChange={onChange} />;
    case "gallery":
      return <GalleryEditor block={block} onChange={onChange} />;
    case "quote":
      return <QuoteEditor block={block} onChange={onChange} />;
    case "table":
      return <TableEditor block={block} onChange={onChange} />;
    case "accordion":
      return (
        <EntryListEditor
          block={block}
          onChange={onChange}
          fields={[
            { key: "title", label: "Title" },
            { key: "body", label: "Body", rich: true },
          ]}
          newEntry={{ title: "", body: "" }}
        />
      );
    case "faq":
      return (
        <EntryListEditor
          block={block}
          onChange={onChange}
          headingLabel="FAQ heading (optional)"
          fields={[
            { key: "question", label: "Question" },
            { key: "answer", label: "Answer", rich: true },
          ]}
          newEntry={{ question: "", answer: "" }}
        />
      );
    case "related":
      return (
        <EntryListEditor
          block={block}
          onChange={onChange}
          headingLabel="Section heading"
          fields={[
            { key: "title", label: "Title" },
            { key: "href", label: "Link" },
            { key: "imageUrl", label: "Image URL" },
            { key: "eyebrow", label: "Eyebrow" },
          ]}
          newEntry={{ title: "", href: "" }}
        />
      );
    case "cta":
      return <CtaEditor block={block} onChange={onChange} />;
    case "newsletter":
      return <NewsletterEditor block={block} onChange={onChange} />;
    case "video":
      return <VideoEditor block={block} onChange={onChange} />;
    case "section":
      return <SectionEditor block={block} onChange={onChange} />;
    case "divider":
      return <p className="text-sm text-muted-foreground">A horizontal divider. No options.</p>;
    default:
      return null;
  }
}

/**
 * The editing canvas: an ordered, nestable list of blocks with native HTML5
 * drag-and-drop reordering, an add-block palette, and per-block actions
 * (duplicate, delete, nest into a section). The selected block expands to show
 * its editing UI inline (Notion-style).
 */
import { useState } from "react";
import {
  ChevronDown,
  ChevronUp,
  Copy,
  GripVertical,
  Plus,
  Trash2,
} from "lucide-react";
import * as Icons from "lucide-react";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@workspace/ui/dropdown-menu";
import { Button } from "@workspace/ui/button";
import { cn } from "@workspace/ui";
import { BLOCK_DEFS, BLOCK_LABELS, type BlockType, type EditorBlock } from "./model";
import { BlockEditor } from "./block-editors";
import type { EditorApi } from "./use-editor";

interface DragState {
  id: string | null;
}

function BlockIcon({ name, className }: { name: string; className?: string }) {
  const Cmp = (Icons as unknown as Record<string, React.ComponentType<{ className?: string }>>)[name];
  return Cmp ? <Cmp className={className} /> : <Icons.Square className={className} />;
}

export function AddBlockMenu({
  onAdd,
  label = "Add block",
  variant = "outline",
  size = "sm",
}: {
  onAdd: (type: BlockType) => void;
  label?: string;
  variant?: "outline" | "ghost";
  size?: "sm" | "default";
}) {
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button variant={variant} size={size}>
          <Plus className="mr-1 h-4 w-4" /> {label}
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start" className="max-h-80 w-64 overflow-y-auto">
        {BLOCK_DEFS.map((def) => (
          <DropdownMenuItem key={def.type} onClick={() => onAdd(def.type)} className="gap-2">
            <BlockIcon name={def.icon} className="h-4 w-4 text-muted-foreground" />
            <div className="flex flex-col">
              <span className="text-sm font-medium">{def.label}</span>
              <span className="text-xs text-muted-foreground">{def.description}</span>
            </div>
          </DropdownMenuItem>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

function summarize(block: EditorBlock): string {
  const d = block.data;
  switch (block.type) {
    case "heading":
      return block.text || "Empty heading";
    case "richText":
      return (d.html ?? "").replace(/<[^>]+>/g, " ").trim().slice(0, 120) || "Empty text";
    case "hero":
      return d.title || "Hero";
    case "image":
      return d.src ? d.alt || d.src : "No image set";
    case "gallery":
      return `${(d.images ?? []).length} image(s)`;
    case "quote":
      return block.text || "Empty quote";
    case "table":
      return `${(d.rows ?? []).length} row(s)`;
    case "accordion":
    case "faq":
    case "related":
      return `${(d.entries ?? []).length} item(s)`;
    case "cta":
      return d.heading || "Call to action";
    case "newsletter":
      return d.heading || "Newsletter signup";
    case "video":
      return d.url || "No video set";
    case "section":
      return d.heading || "Section";
    case "divider":
      return "Divider";
    default:
      return BLOCK_LABELS[block.type] ?? "Block";
  }
}

function DropZone({
  parentId,
  index,
  drag,
  onDrop,
}: {
  parentId: string | null;
  index: number;
  drag: DragState;
  onDrop: (parentId: string | null, index: number) => void;
}) {
  const [over, setOver] = useState(false);
  if (!drag.id) return <div className="h-1" />;
  return (
    <div
      onDragOver={(e) => {
        e.preventDefault();
        setOver(true);
      }}
      onDragLeave={() => setOver(false)}
      onDrop={(e) => {
        e.preventDefault();
        setOver(false);
        onDrop(parentId, index);
      }}
      className={cn(
        "my-0.5 h-2 rounded transition-colors",
        over ? "bg-primary" : "bg-transparent hover:bg-primary/20",
      )}
    />
  );
}

function BlockRow({
  block,
  parentId,
  index,
  siblingCount,
  editor,
  drag,
  setDrag,
}: {
  block: EditorBlock;
  parentId: string | null;
  index: number;
  siblingCount: number;
  editor: EditorApi;
  drag: DragState;
  setDrag: (d: DragState) => void;
}) {
  const selected = editor.selectedId === block.id;
  const isSection = block.type === "section";

  return (
    <div
      draggable
      onDragStart={(e) => {
        e.stopPropagation();
        e.dataTransfer.effectAllowed = "move";
        setDrag({ id: block.id });
      }}
      onDragEnd={() => setDrag({ id: null })}
      className={cn(
        "group rounded-lg border bg-card transition-shadow",
        selected ? "border-primary shadow-sm" : "border-border/60 hover:border-border",
        drag.id === block.id && "opacity-40",
      )}
    >
      <div
        className="flex items-center gap-2 px-2 py-1.5"
        onClick={() => editor.select(selected ? null : block.id)}
      >
        <GripVertical className="h-4 w-4 shrink-0 cursor-grab text-muted-foreground/60" />
        <span className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
          {BLOCK_LABELS[block.type]}
        </span>
        {!selected ? (
          <span className="ml-1 flex-1 truncate text-sm text-muted-foreground">
            {summarize(block)}
          </span>
        ) : (
          <span className="flex-1" />
        )}
        <div className="flex items-center gap-0.5 opacity-0 transition-opacity group-hover:opacity-100">
          <IconBtn
            title="Move up"
            disabled={index === 0}
            onClick={(e) => {
              e.stopPropagation();
              editor.move(block.id, parentId, index - 1);
            }}
          >
            <ChevronUp className="h-4 w-4" />
          </IconBtn>
          <IconBtn
            title="Move down"
            disabled={index >= siblingCount - 1}
            onClick={(e) => {
              e.stopPropagation();
              editor.move(block.id, parentId, index + 2);
            }}
          >
            <ChevronDown className="h-4 w-4" />
          </IconBtn>
          <IconBtn
            title="Duplicate"
            onClick={(e) => {
              e.stopPropagation();
              editor.duplicate(block.id);
            }}
          >
            <Copy className="h-4 w-4" />
          </IconBtn>
          <IconBtn
            title="Delete"
            onClick={(e) => {
              e.stopPropagation();
              editor.remove(block.id);
            }}
          >
            <Trash2 className="h-4 w-4" />
          </IconBtn>
        </div>
      </div>

      {selected ? (
        <div className="border-t border-border/60 p-3" onClick={(e) => e.stopPropagation()}>
          <BlockEditor block={block} onChange={(patch) => editor.update(block.id, patch, `${block.id}`)} />
        </div>
      ) : null}

      {isSection ? (
        <div className="border-t border-border/60 p-2 pl-6">
          <BlockList
            blocks={block.children ?? []}
            parentId={block.id}
            editor={editor}
            drag={drag}
            setDrag={setDrag}
          />
        </div>
      ) : null}
    </div>
  );
}

function BlockList({
  blocks,
  parentId,
  editor,
  drag,
  setDrag,
}: {
  blocks: EditorBlock[];
  parentId: string | null;
  editor: EditorApi;
  drag: DragState;
  setDrag: (d: DragState) => void;
}) {
  const handleDrop = (targetParent: string | null, index: number) => {
    if (drag.id) editor.move(drag.id, targetParent, index);
    setDrag({ id: null });
  };

  return (
    <div className="space-y-0.5">
      <DropZone parentId={parentId} index={0} drag={drag} onDrop={handleDrop} />
      {blocks.map((block, i) => (
        <div key={block.id}>
          <BlockRow
            block={block}
            parentId={parentId}
            index={i}
            siblingCount={blocks.length}
            editor={editor}
            drag={drag}
            setDrag={setDrag}
          />
          <DropZone parentId={parentId} index={i + 1} drag={drag} onDrop={handleDrop} />
        </div>
      ))}
      {blocks.length === 0 && parentId !== null ? (
        <div className="py-2">
          <AddBlockMenu onAdd={(t) => editor.insert(t, parentId)} label="Add to section" variant="ghost" />
        </div>
      ) : null}
    </div>
  );
}

export function EditorCanvas({ editor }: { editor: EditorApi }) {
  const [drag, setDrag] = useState<DragState>({ id: null });

  return (
    <div className="space-y-4">
      {editor.blocks.length === 0 ? (
        <div className="rounded-lg border border-dashed border-border p-10 text-center">
          <p className="text-sm text-muted-foreground">No blocks yet. Add your first block to start writing.</p>
          <div className="mt-4 flex justify-center">
            <AddBlockMenu onAdd={(t) => editor.insert(t)} label="Add block" />
          </div>
        </div>
      ) : (
        <>
          <BlockList blocks={editor.blocks} parentId={null} editor={editor} drag={drag} setDrag={setDrag} />
          <div className="flex justify-center pt-2">
            <AddBlockMenu onAdd={(t) => editor.insert(t)} label="Add block" />
          </div>
        </>
      )}
    </div>
  );
}

function IconBtn({
  children,
  onClick,
  title,
  disabled,
}: {
  children: React.ReactNode;
  onClick: (e: React.MouseEvent) => void;
  title: string;
  disabled?: boolean;
}) {
  return (
    <button
      type="button"
      title={title}
      disabled={disabled}
      onClick={onClick}
      className="rounded p-1 text-muted-foreground hover:bg-muted hover:text-foreground disabled:opacity-30"
    >
      {children}
    </button>
  );
}

/**
 * Lightweight rich-text editor built on a `contentEditable` surface.
 *
 * - Toolbar: paragraph / H2 / H3, bold / italic / underline, ordered &
 *   unordered lists, blockquote, inline code, and a link button wired to the
 *   internal-linking assistant.
 * - Clean paste: HTML from Google Docs / Word is stripped down to an allowlist
 *   of tags so editorial content never carries inline styles or `mso-` cruft.
 *
 * The component is uncontrolled (it does not re-write its own innerHTML on every
 * keystroke, which would reset the caret); it reports cleaned HTML via onChange.
 */
import { useCallback, useEffect, useRef } from "react";
import {
  Bold,
  Code,
  Italic,
  Link as LinkIcon,
  List,
  ListOrdered,
  Quote as QuoteIcon,
  Underline,
} from "lucide-react";
import { cn } from "@workspace/ui";
import { useLinkPicker } from "./link-assistant";

const ALLOWED_TAGS = new Set([
  "P", "BR", "STRONG", "B", "EM", "I", "U", "S", "A", "UL", "OL", "LI",
  "BLOCKQUOTE", "CODE", "PRE", "H2", "H3", "H4", "SPAN",
]);

/** Strip pasted HTML down to the allowlist, dropping styles, classes, comments. */
function cleanPastedHtml(html: string): string {
  if (typeof DOMParser === "undefined") return html;
  const withoutComments = html.replace(/<!--[\s\S]*?-->/g, "");
  const doc = new DOMParser().parseFromString(withoutComments, "text/html");

  const walk = (node: Node) => {
    const children = Array.from(node.childNodes);
    for (const child of children) {
      if (child.nodeType === Node.ELEMENT_NODE) {
        const el = child as HTMLElement;
        walk(el);
        if (!ALLOWED_TAGS.has(el.tagName)) {
          // Unwrap unknown tags (keep their text content / children).
          el.replaceWith(...Array.from(el.childNodes));
          continue;
        }
        for (const attr of Array.from(el.attributes)) {
          const keep = el.tagName === "A" && attr.name === "href";
          if (!keep) el.removeAttribute(attr.name);
        }
        if (el.tagName === "SPAN") {
          el.replaceWith(...Array.from(el.childNodes));
        }
      }
    }
  };
  walk(doc.body);
  return doc.body.innerHTML;
}

function exec(command: string, value?: string) {
  document.execCommand(command, false, value);
}

export interface RichTextEditorProps {
  value: string;
  onChange: (html: string) => void;
  placeholder?: string;
  className?: string;
  /** Single-line-ish minimal toolbar (used for short fields). */
  minimal?: boolean;
}

export function RichTextEditor({
  value,
  onChange,
  placeholder,
  className,
  minimal,
}: RichTextEditorProps) {
  const ref = useRef<HTMLDivElement>(null);
  const { pick } = useLinkPicker();
  const savedRange = useRef<Range | null>(null);

  // Sync external value into the DOM only when it diverges (e.g. on load /
  // undo), never on our own keystroke-driven onChange — that would move caret.
  useEffect(() => {
    const el = ref.current;
    if (el && el.innerHTML !== value) {
      el.innerHTML = value ?? "";
    }
  }, [value]);

  const emit = useCallback(() => {
    if (ref.current) onChange(ref.current.innerHTML);
  }, [onChange]);

  const saveSelection = useCallback(() => {
    const sel = window.getSelection();
    if (sel && sel.rangeCount > 0 && ref.current?.contains(sel.anchorNode)) {
      savedRange.current = sel.getRangeAt(0).cloneRange();
    }
  }, []);

  const restoreSelection = useCallback(() => {
    const sel = window.getSelection();
    if (sel && savedRange.current) {
      sel.removeAllRanges();
      sel.addRange(savedRange.current);
    }
  }, []);

  const runCommand = useCallback(
    (command: string, val?: string) => {
      ref.current?.focus();
      restoreSelection();
      exec(command, val);
      emit();
    },
    [emit, restoreSelection],
  );

  const handlePaste = useCallback(
    (e: React.ClipboardEvent<HTMLDivElement>) => {
      e.preventDefault();
      const html = e.clipboardData.getData("text/html");
      const text = e.clipboardData.getData("text/plain");
      if (html) {
        exec("insertHTML", cleanPastedHtml(html));
      } else if (text) {
        exec("insertText", text);
      }
      emit();
    },
    [emit],
  );

  const insertLink = useCallback(async () => {
    saveSelection();
    const sel = window.getSelection();
    const selectedText = sel ? sel.toString() : "";
    const result = await pick(selectedText);
    if (!result) return;
    ref.current?.focus();
    restoreSelection();
    if (selectedText) {
      exec("createLink", result.href);
    } else {
      exec(
        "insertHTML",
        `<a href="${result.href.replace(/"/g, "&quot;")}">${result.label}</a>`,
      );
    }
    emit();
  }, [emit, pick, restoreSelection, saveSelection]);

  return (
    <div className={cn("rounded-md border border-input bg-background", className)}>
      <div className="flex flex-wrap items-center gap-0.5 border-b border-border/60 p-1">
        {!minimal ? (
          <>
            <ToolbarButton label="H2" onClick={() => runCommand("formatBlock", "h2")} />
            <ToolbarButton label="H3" onClick={() => runCommand("formatBlock", "h3")} />
            <ToolbarButton label="P" onClick={() => runCommand("formatBlock", "p")} />
            <Divider />
          </>
        ) : null}
        <IconButton onClick={() => runCommand("bold")} title="Bold">
          <Bold className="h-4 w-4" />
        </IconButton>
        <IconButton onClick={() => runCommand("italic")} title="Italic">
          <Italic className="h-4 w-4" />
        </IconButton>
        <IconButton onClick={() => runCommand("underline")} title="Underline">
          <Underline className="h-4 w-4" />
        </IconButton>
        <IconButton onClick={insertLink} title="Insert link">
          <LinkIcon className="h-4 w-4" />
        </IconButton>
        {!minimal ? (
          <>
            <Divider />
            <IconButton onClick={() => runCommand("insertUnorderedList")} title="Bullet list">
              <List className="h-4 w-4" />
            </IconButton>
            <IconButton onClick={() => runCommand("insertOrderedList")} title="Numbered list">
              <ListOrdered className="h-4 w-4" />
            </IconButton>
            <IconButton onClick={() => runCommand("formatBlock", "blockquote")} title="Quote">
              <QuoteIcon className="h-4 w-4" />
            </IconButton>
            <IconButton onClick={() => runCommand("formatBlock", "pre")} title="Code block">
              <Code className="h-4 w-4" />
            </IconButton>
          </>
        ) : null}
      </div>
      <div
        ref={ref}
        contentEditable
        suppressContentEditableWarning
        role="textbox"
        aria-multiline="true"
        data-placeholder={placeholder}
        onInput={emit}
        onBlur={emit}
        onKeyUp={saveSelection}
        onMouseUp={saveSelection}
        onPaste={handlePaste}
        className={cn(
          "prose prose-sm max-w-none px-3 py-2 outline-none",
          "min-h-[2.5rem] [&[data-placeholder]:empty]:before:text-muted-foreground",
          "[&[data-placeholder]:empty]:before:content-[attr(data-placeholder)]",
        )}
      />
    </div>
  );
}

function ToolbarButton({ label, onClick }: { label: string; onClick: () => void }) {
  return (
    <button
      type="button"
      onMouseDown={(e) => e.preventDefault()}
      onClick={onClick}
      className="rounded px-2 py-1 text-xs font-semibold text-muted-foreground hover:bg-muted hover:text-foreground"
    >
      {label}
    </button>
  );
}

function IconButton({
  children,
  onClick,
  title,
}: {
  children: React.ReactNode;
  onClick: () => void;
  title: string;
}) {
  return (
    <button
      type="button"
      title={title}
      onMouseDown={(e) => e.preventDefault()}
      onClick={onClick}
      className="rounded p-1.5 text-muted-foreground hover:bg-muted hover:text-foreground"
    >
      {children}
    </button>
  );
}

function Divider() {
  return <span className="mx-1 h-5 w-px bg-border" />;
}

import React from "react";
import {
  asComponentTree,
  asRichText,
  prepareArticleHtml,
  type CTNode,
  type LexNode,
} from "./parse";

/**
 * Minimal renderable shape the article renderer consumes. The public blog's
 * `PostDetail` and any CMS draft both structurally satisfy this, so the
 * renderer stays decoupled from the API client and can render live previews of
 * unsaved content.
 */
export interface RenderableContent {
  contentHtml?: string | null;
  componentTree?: unknown;
  richText?: unknown;
}

/* ------------------------------------------------------------------ */
/* Lexical / rich-text inline + block rendering                        */
/* Handles BOTH the importer's numeric `format` bitmask and the         */
/* crawler's `format: string[]` mark arrays, plus list/table nodes.     */
/* ------------------------------------------------------------------ */

function hasFormat(
  format: number | string[] | undefined,
  bit: number,
  name: string,
): boolean {
  if (typeof format === "number") return (format & bit) !== 0;
  if (Array.isArray(format)) return format.includes(name);
  return false;
}

function renderLexInline(node: LexNode, key: number): React.ReactNode {
  if (node.type === "text") {
    let content: React.ReactNode = node.text ?? "";
    const f = node.format;
    if (hasFormat(f, 16, "code")) content = <code>{content}</code>;
    if (hasFormat(f, 1, "bold")) content = <strong>{content}</strong>;
    if (hasFormat(f, 2, "italic")) content = <em>{content}</em>;
    if (hasFormat(f, 8, "underline")) content = <u>{content}</u>;
    if (hasFormat(f, 4, "strikethrough")) content = <s>{content}</s>;
    return <React.Fragment key={key}>{content}</React.Fragment>;
  }
  if (node.type === "linebreak") return <br key={key} />;
  if (node.type === "link") {
    const url = node.fields?.url ?? node.url ?? "#";
    const external = /^https?:\/\//.test(url);
    return (
      <a
        key={key}
        href={url}
        target={external ? "_blank" : undefined}
        rel={external ? "noopener noreferrer" : undefined}
      >
        {(node.children ?? []).map((c, i) => renderLexInline(c, i))}
      </a>
    );
  }
  if (node.children) {
    return (
      <React.Fragment key={key}>
        {node.children.map((c, i) => renderLexInline(c, i))}
      </React.Fragment>
    );
  }
  return null;
}

function renderLexList(node: LexNode, key: number): React.ReactNode {
  const ordered = node.tag === "ol" || node.listType === "number";
  const ListTag = ordered ? "ol" : "ul";
  return (
    <ListTag key={key}>
      {(node.children ?? []).map((li, i) => (
        <li key={i}>
          {(li.children ?? []).map((c, j) =>
            c.type === "list" ? renderLexList(c, j) : renderLexInline(c, j),
          )}
        </li>
      ))}
    </ListTag>
  );
}

function renderLexTable(node: LexNode, key: number): React.ReactNode {
  const rows = node.children ?? [];
  return (
    <table key={key}>
      <tbody>
        {rows.map((row, i) => (
          <tr key={i}>
            {(row.children ?? []).map((cell, j) => {
              const Cell = cell.type === "tableheader" ? "th" : "td";
              return (
                <Cell key={j}>
                  {(cell.children ?? []).map((c, k) => renderLexInline(c, k))}
                </Cell>
              );
            })}
          </tr>
        ))}
      </tbody>
    </table>
  );
}

function renderLexBlock(node: LexNode, key: number): React.ReactNode {
  const children = node.children ?? [];
  switch (node.type) {
    case "heading": {
      const tag = (node.tag ?? "h2") as keyof React.JSX.IntrinsicElements;
      return React.createElement(
        tag,
        { key },
        children.map((c, i) => renderLexInline(c, i)),
      );
    }
    case "paragraph":
      if (children.length === 0) return null;
      return (
        <p key={key}>{children.map((c, i) => renderLexInline(c, i))}</p>
      );
    case "list":
      return renderLexList(node, key);
    case "table":
      return renderLexTable(node, key);
    case "quote":
      return (
        <blockquote key={key}>
          {children.map((c, i) => renderLexInline(c, i))}
        </blockquote>
      );
    default:
      if (children.length > 0) {
        return (
          <p key={key}>{children.map((c, i) => renderLexInline(c, i))}</p>
        );
      }
      return null;
  }
}

/* ------------------------------------------------------------------ */
/* componentTree rendering (crawler array + importer root shapes)       */
/* Fallback path: only used when an article has no raw `contentHtml`.    */
/* ------------------------------------------------------------------ */

function CTImage({ node }: { node: CTNode }) {
  const src = node.data?.src;
  if (!src) return null;
  const caption = node.data?.caption;
  return (
    <figure>
      <img src={src} alt={node.data?.alt ?? ""} loading="lazy" />
      {caption ? <figcaption>{caption}</figcaption> : null}
    </figure>
  );
}

function CTGallery({ node }: { node: CTNode }) {
  const images = node.data?.images ?? [];
  if (images.length === 0) return null;
  return (
    <div className="grid grid-cols-2 sm:grid-cols-3 gap-3 my-8">
      {images.map((img, i) =>
        img.src ? (
          <img
            key={i}
            src={img.src}
            alt={img.alt ?? ""}
            loading="lazy"
            className="w-full h-full object-cover rounded-lg"
          />
        ) : null,
      )}
    </div>
  );
}

function renderCTNode(node: CTNode, key: number): React.ReactNode {
  // crawler array shape (`type`) -----------------------------------
  switch (node.type) {
    case "heading": {
      const level = node.data?.level ?? 2;
      const tag = `h${Math.min(Math.max(level, 1), 6)}` as keyof React.JSX.IntrinsicElements;
      return React.createElement(tag, { key, id: node.anchorId }, node.text ?? "");
    }
    case "richText":
      return node.data?.richText
        ? renderLexBlock(node.data.richText as LexNode, key)
        : node.text
          ? <p key={key}>{node.text}</p>
          : null;
    case "list":
      return node.data?.richText
        ? renderLexList(node.data.richText as LexNode, key)
        : null;
    case "table":
      return node.data?.richText
        ? renderLexTable(node.data.richText as LexNode, key)
        : null;
    case "quote":
      return node.data?.richText ? (
        renderLexBlock(node.data.richText as LexNode, key)
      ) : node.text ? (
        <blockquote key={key}>{node.text}</blockquote>
      ) : null;
    case "image":
      return <CTImage key={key} node={node} />;
    case "gallery":
      return <CTGallery key={key} node={node} />;
    case "section":
      return (
        <section key={key} id={node.anchorId}>
          {(node.children ?? []).map((c, i) => renderCTNode(c, i))}
        </section>
      );
  }

  // importer root shape (`blockType`) ------------------------------
  switch (node.blockType) {
    case "heading":
      return (
        <h2 key={key} id={node.anchorId}>
          {node.text}
        </h2>
      );
    case "paragraph":
      return node.text ? <p key={key}>{node.text}</p> : null;
    case "list": {
      const ordered = node.data?.ordered;
      const ListTag = ordered ? "ol" : "ul";
      const items = node.data?.items ?? [];
      return (
        <ListTag key={key}>
          {items.map((item, i) => (
            <li key={i}>{item}</li>
          ))}
        </ListTag>
      );
    }
    case "section":
      return (
        <section key={key} id={node.anchorId}>
          {node.data?.heading ? <h2>{node.data.heading}</h2> : null}
          {(node.children ?? []).map((c, i) => renderCTNode(c, i))}
        </section>
      );
  }

  // unknown / chrome-only node — skip
  return null;
}

/* ------------------------------------------------------------------ */

export function ContentRenderer({ post }: { post: RenderableContent }) {
  // Primary path: the cleaned raw HTML is the faithful source of truth
  // (every inline image, caption, gallery, blockquote, table, nested list and
  // formatting run is preserved). The structured trees below are lossy and
  // only used when an article genuinely has no HTML body.
  if (post.contentHtml && post.contentHtml.trim().length > 0) {
    return <RawHtmlContent html={post.contentHtml} />;
  }

  const nodes = asComponentTree(post.componentTree);
  if (nodes && nodes.length > 0) {
    return (
      <div className="blog-prose">
        {nodes.map((node, i) => renderCTNode(node, i))}
      </div>
    );
  }

  const rich = asRichText(post.richText);
  if (rich) {
    return (
      <div className="blog-prose">
        {(rich.root.children ?? []).map((node, i) => renderLexBlock(node, i))}
      </div>
    );
  }

  return (
    <p className="text-muted-foreground italic">
      This article has no content yet.
    </p>
  );
}

function RawHtmlContent({ html }: { html: string }) {
  const safeHtml = React.useMemo(() => prepareArticleHtml(html).html, [html]);
  return (
    <div
      className="blog-prose"
      dangerouslySetInnerHTML={{ __html: safeHtml }}
    />
  );
}

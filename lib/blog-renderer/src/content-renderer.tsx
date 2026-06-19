import React from "react";
import {
  asComponentTree,
  asRichText,
  prepareArticleHtml,
  sanitizeContentHtml,
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

/** Inline sanitized rich-text HTML authored by the CMS rich-text editor. */
function CTRichHtml({ html }: { html: string }) {
  const safe = React.useMemo(() => sanitizeContentHtml(html), [html]);
  if (!safe.trim()) return null;
  return <div dangerouslySetInnerHTML={{ __html: safe }} />;
}

function CTHero({ node }: { node: CTNode }) {
  const d = node.data ?? {};
  const title = d.title ?? node.text;
  if (!title && !d.subtitle && !d.imageUrl) return null;
  return (
    <header className="not-prose my-8 overflow-hidden rounded-2xl border border-border bg-card">
      {d.imageUrl ? (
        <img
          src={d.imageUrl}
          alt={d.imageAlt ?? ""}
          loading="lazy"
          className="h-64 w-full object-cover sm:h-80"
        />
      ) : null}
      <div className="p-6 sm:p-8">
        {d.eyebrow ? (
          <p className="mb-2 text-xs font-semibold uppercase tracking-widest text-muted-foreground">
            {d.eyebrow}
          </p>
        ) : null}
        {title ? (
          <h1 className="text-3xl font-bold leading-tight sm:text-4xl">
            {title}
          </h1>
        ) : null}
        {d.subtitle ? (
          <p className="mt-3 text-lg text-muted-foreground">{d.subtitle}</p>
        ) : null}
      </div>
    </header>
  );
}

function CTAccordion({ node }: { node: CTNode }) {
  const items = node.data?.entries ?? [];
  if (items.length === 0) return null;
  return (
    <div className="not-prose my-6 divide-y divide-border rounded-xl border border-border">
      {items.map((it, i) => (
        <details key={i} className="group px-4 py-3">
          <summary className="cursor-pointer list-none font-medium [&::-webkit-details-marker]:hidden">
            {it.title ?? it.question ?? `Item ${i + 1}`}
          </summary>
          {it.body ?? it.answer ? (
            <div className="mt-2 text-muted-foreground">
              <CTRichHtml html={it.body ?? it.answer ?? ""} />
            </div>
          ) : null}
        </details>
      ))}
    </div>
  );
}

function CTFaq({ node }: { node: CTNode }) {
  const items = node.data?.entries ?? [];
  if (items.length === 0) return null;
  return (
    <section className="not-prose my-8">
      {node.data?.heading ?? node.data?.title ? (
        <h2 className="mb-4 text-2xl font-bold">
          {node.data.heading ?? node.data.title}
        </h2>
      ) : null}
      <div className="divide-y divide-border rounded-xl border border-border">
        {items.map((it, i) => (
          <details key={i} className="group px-4 py-3">
            <summary className="cursor-pointer list-none font-medium [&::-webkit-details-marker]:hidden">
              {it.question ?? it.title ?? `Question ${i + 1}`}
            </summary>
            {it.answer ?? it.body ? (
              <div className="mt-2 text-muted-foreground">
                <CTRichHtml html={it.answer ?? it.body ?? ""} />
              </div>
            ) : null}
          </details>
        ))}
      </div>
    </section>
  );
}

function CTCta({ node }: { node: CTNode }) {
  const d = node.data ?? {};
  if (!d.heading && !d.body && !d.buttonLabel) return null;
  const external = d.buttonHref ? /^https?:\/\//.test(d.buttonHref) : false;
  return (
    <aside className="not-prose my-8 rounded-2xl border border-border bg-muted/40 p-6 text-center sm:p-8">
      {d.heading ? (
        <h3 className="text-2xl font-bold">{d.heading}</h3>
      ) : null}
      {d.body ? (
        <p className="mx-auto mt-2 max-w-prose text-muted-foreground">{d.body}</p>
      ) : null}
      {d.buttonLabel ? (
        <a
          href={d.buttonHref ?? "#"}
          target={external ? "_blank" : undefined}
          rel={external ? "noopener noreferrer" : undefined}
          className="mt-4 inline-block rounded-full bg-primary px-6 py-2.5 font-semibold text-primary-foreground"
        >
          {d.buttonLabel}
        </a>
      ) : null}
    </aside>
  );
}

function CTNewsletter({ node }: { node: CTNode }) {
  const d = node.data ?? {};
  return (
    <aside className="not-prose my-8 rounded-2xl border border-dashed border-border bg-card p-6 sm:p-8">
      <h3 className="text-xl font-bold">
        {d.heading ?? "Subscribe to our newsletter"}
      </h3>
      {d.body ? <p className="mt-1 text-muted-foreground">{d.body}</p> : null}
      <div className="mt-4 flex flex-col gap-2 sm:flex-row">
        <input
          type="email"
          disabled
          placeholder={d.placeholder ?? "you@example.com"}
          className="flex-1 rounded-full border border-border bg-background px-4 py-2.5 text-sm"
        />
        <button
          type="button"
          disabled
          className="rounded-full bg-primary px-6 py-2.5 font-semibold text-primary-foreground"
        >
          {d.buttonLabel ?? "Subscribe"}
        </button>
      </div>
    </aside>
  );
}

function CTRelated({ node }: { node: CTNode }) {
  const items = node.data?.entries ?? [];
  if (items.length === 0) return null;
  return (
    <section className="not-prose my-8">
      <h2 className="mb-4 text-2xl font-bold">
        {node.data?.heading ?? node.data?.title ?? "Related articles"}
      </h2>
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {items.map((it, i) => (
          <a
            key={i}
            href={it.href ?? "#"}
            className="block overflow-hidden rounded-xl border border-border bg-card transition hover:shadow-md"
          >
            {it.imageUrl ? (
              <img
                src={it.imageUrl}
                alt=""
                loading="lazy"
                className="h-36 w-full object-cover"
              />
            ) : null}
            <div className="p-4">
              {it.eyebrow ? (
                <p className="mb-1 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                  {it.eyebrow}
                </p>
              ) : null}
              <p className="font-semibold leading-snug">
                {it.title ?? "Untitled"}
              </p>
            </div>
          </a>
        ))}
      </div>
    </section>
  );
}

function parseVideoEmbed(url: string): string | null {
  const yt = url.match(
    /(?:youtube\.com\/(?:watch\?v=|embed\/)|youtu\.be\/)([\w-]{11})/,
  );
  if (yt) return `https://www.youtube.com/embed/${yt[1]}`;
  const vimeo = url.match(/vimeo\.com\/(?:video\/)?(\d+)/);
  if (vimeo) return `https://player.vimeo.com/video/${vimeo[1]}`;
  return null;
}

function CTVideo({ node }: { node: CTNode }) {
  const url = node.data?.url;
  if (!url) return null;
  const embed = parseVideoEmbed(url);
  const isFile = /\.(mp4|webm|ogg)(\?|$)/i.test(url);
  return (
    <figure className="not-prose my-8">
      {embed ? (
        <div className="relative aspect-video overflow-hidden rounded-xl">
          <iframe
            src={embed}
            title={node.data?.caption ?? "Embedded video"}
            loading="lazy"
            allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture"
            allowFullScreen
            className="absolute inset-0 h-full w-full border-0"
          />
        </div>
      ) : isFile ? (
        <video controls src={url} className="w-full rounded-xl" />
      ) : (
        <a href={url} target="_blank" rel="noopener noreferrer">
          {url}
        </a>
      )}
      {node.data?.caption ? (
        <figcaption className="mt-2 text-center text-sm text-muted-foreground">
          {node.data.caption}
        </figcaption>
      ) : null}
    </figure>
  );
}

function CTPlainTable({ node }: { node: CTNode }) {
  const rows = node.data?.rows ?? [];
  if (rows.length === 0) return null;
  const hasHeader = node.data?.hasHeader ?? false;
  const bodyRows = hasHeader ? rows.slice(1) : rows;
  return (
    <table>
      {hasHeader && rows[0] ? (
        <thead>
          <tr>
            {rows[0].map((cell, j) => (
              <th key={j}>{cell}</th>
            ))}
          </tr>
        </thead>
      ) : null}
      <tbody>
        {bodyRows.map((row, i) => (
          <tr key={i}>
            {row.map((cell, j) => (
              <td key={j}>{cell}</td>
            ))}
          </tr>
        ))}
      </tbody>
    </table>
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
        : node.data?.html
          ? <CTRichHtml key={key} html={node.data.html} />
          : node.text
            ? <p key={key}>{node.text}</p>
            : null;
    case "list":
      return node.data?.richText
        ? renderLexList(node.data.richText as LexNode, key)
        : null;
    case "table":
      return node.data?.richText ? (
        renderLexTable(node.data.richText as LexNode, key)
      ) : node.data?.rows ? (
        <CTPlainTable key={key} node={node} />
      ) : null;
    case "quote":
      return node.data?.richText ? (
        renderLexBlock(node.data.richText as LexNode, key)
      ) : node.text ? (
        <figure key={key}>
          <blockquote>{node.text}</blockquote>
          {node.data?.cite ? (
            <figcaption className="text-sm text-muted-foreground">
              — {node.data.cite}
            </figcaption>
          ) : null}
        </figure>
      ) : null;
    case "image":
      return <CTImage key={key} node={node} />;
    case "gallery":
      return <CTGallery key={key} node={node} />;
    case "hero":
      return <CTHero key={key} node={node} />;
    case "accordion":
      return <CTAccordion key={key} node={node} />;
    case "faq":
      return <CTFaq key={key} node={node} />;
    case "cta":
      return <CTCta key={key} node={node} />;
    case "newsletter":
      return <CTNewsletter key={key} node={node} />;
    case "related":
      return <CTRelated key={key} node={node} />;
    case "video":
      return <CTVideo key={key} node={node} />;
    case "divider":
      return <hr key={key} className="my-8 border-border" />;
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

import React from "react";
import type { PostDetail } from "@workspace/api-client-react";
import {
  asComponentTree,
  asRichText,
  sanitizeContentHtml,
  type CTNode,
  type LexNode,
} from "@/lib/blog";

/* ------------------------------------------------------------------ */
/* componentTree rendering (Payload-style blocks)                      */
/* ------------------------------------------------------------------ */

function CTList({ data }: { data: CTNode & { blockType: "list" } }) {
  const { title, ordered, items } = data.data;
  const ListTag = ordered ? "ol" : "ul";
  return (
    <div className="mb-8">
      {title ? (
        <h4 className="text-xs font-semibold uppercase tracking-widest text-primary mb-3">
          {title}
        </h4>
      ) : null}
      <ListTag
        className={
          ordered
            ? "list-decimal pl-5 space-y-2 text-foreground/80"
            : "list-disc pl-5 space-y-2 text-foreground/80"
        }
      >
        {(items ?? []).map((item, i) => (
          <li key={i} className="leading-relaxed">
            {item}
          </li>
        ))}
      </ListTag>
    </div>
  );
}

function CTBlock({ node }: { node: CTNode }) {
  switch (node.blockType) {
    case "heading":
      return (
        <h2
          id={node.anchorId}
          className="font-serif text-2xl md:text-3xl text-foreground mb-6 scroll-mt-28"
        >
          {node.text}
        </h2>
      );
    case "paragraph":
      return (
        <p className="text-base md:text-lg leading-relaxed text-foreground/80 mb-6">
          {node.text}
        </p>
      );
    case "list":
      return <CTList data={node} />;
    case "section":
      return (
        <section id={node.anchorId} className="mb-14 scroll-mt-28">
          <h3 className="font-serif text-2xl md:text-3xl text-foreground mb-5">
            {node.data.heading}
          </h3>
          {(node.children ?? []).map((child, i) => (
            <CTBlock key={i} node={child} />
          ))}
        </section>
      );
    default:
      return null;
  }
}

/* ------------------------------------------------------------------ */
/* Lexical richText rendering                                          */
/* ------------------------------------------------------------------ */

const FORMAT_BOLD = 1;
const FORMAT_ITALIC = 2;

function renderLexInline(node: LexNode, key: number): React.ReactNode {
  if (node.type === "text") {
    let content: React.ReactNode = node.text ?? "";
    const format = node.format ?? 0;
    if (format & FORMAT_BOLD) content = <strong>{content}</strong>;
    if (format & FORMAT_ITALIC) content = <em>{content}</em>;
    return <React.Fragment key={key}>{content}</React.Fragment>;
  }
  if (node.type === "link") {
    const url = node.fields?.url ?? node.url ?? "#";
    const external = url.startsWith("http");
    return (
      <a
        key={key}
        href={url}
        target={external ? "_blank" : undefined}
        rel={external ? "noopener noreferrer" : undefined}
        className="text-primary underline decoration-primary/30 underline-offset-4 hover:decoration-primary transition-all"
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

function renderLexBlock(node: LexNode, key: number): React.ReactNode {
  const children = node.children ?? [];
  switch (node.type) {
    case "heading": {
      const tag = node.tag ?? "h2";
      const cls =
        tag === "h1"
          ? "font-serif text-3xl md:text-4xl text-foreground mb-6 mt-2"
          : "font-serif text-2xl md:text-3xl text-foreground mb-5 mt-10";
      return React.createElement(
        tag,
        { key, className: cls },
        children.map((c, i) => renderLexInline(c, i)),
      );
    }
    case "paragraph":
      return (
        <p
          key={key}
          className="text-base md:text-lg leading-relaxed text-foreground/80 mb-6"
        >
          {children.map((c, i) => renderLexInline(c, i))}
        </p>
      );
    case "list": {
      const ListTag = node.listType === "number" ? "ol" : "ul";
      return React.createElement(
        ListTag,
        {
          key,
          className:
            node.listType === "number"
              ? "list-decimal pl-5 space-y-2 text-foreground/80 mb-6"
              : "list-disc pl-5 space-y-2 text-foreground/80 mb-6",
        },
        children.map((c, i) => (
          <li key={i} className="leading-relaxed">
            {(c.children ?? []).map((cc, j) => renderLexInline(cc, j))}
          </li>
        )),
      );
    }
    case "quote":
      return (
        <blockquote
          key={key}
          className="border-l-4 border-primary/40 pl-6 italic text-foreground/70 my-8 text-lg"
        >
          {children.map((c, i) => renderLexInline(c, i))}
        </blockquote>
      );
    default:
      if (children.length > 0) {
        return (
          <p
            key={key}
            className="text-base md:text-lg leading-relaxed text-foreground/80 mb-6"
          >
            {children.map((c, i) => renderLexInline(c, i))}
          </p>
        );
      }
      return null;
  }
}

/* ------------------------------------------------------------------ */

export function ContentRenderer({ post }: { post: PostDetail }) {
  const tree = asComponentTree(post.componentTree);
  if (tree) {
    return (
      <div className="blog-content">
        {tree.children.map((node, i) => (
          <CTBlock key={i} node={node} />
        ))}
      </div>
    );
  }

  const rich = asRichText(post.richText);
  if (rich) {
    return (
      <div className="blog-content">
        {(rich.root.children ?? []).map((node, i) => renderLexBlock(node, i))}
      </div>
    );
  }

  if (post.contentHtml) {
    return <RawHtmlContent html={post.contentHtml} />;
  }

  return (
    <p className="text-muted-foreground italic">
      This article has no content yet.
    </p>
  );
}

function RawHtmlContent({ html }: { html: string }) {
  const safeHtml = React.useMemo(() => sanitizeContentHtml(html), [html]);
  return (
    <div
      className="prose prose-lg max-w-none prose-headings:font-serif prose-headings:text-foreground prose-p:text-foreground/80 prose-a:text-primary"
      dangerouslySetInnerHTML={{ __html: safeHtml }}
    />
  );
}

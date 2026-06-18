import { List } from "lucide-react";
import type { TreeNode } from "@/lib/post-content";

interface ContentTreeProps {
  nodes: TreeNode[];
  postTitle: string;
}

/**
 * Renders a post's Payload-style `componentTree` with the site's editorial
 * styling. Supports `heading`, `paragraph`, `list` and `section` blocks; unknown
 * blocks fall back to rendering their children so nothing is silently dropped.
 */
export function ContentTree({ nodes, postTitle }: ContentTreeProps) {
  return (
    <>
      {nodes.map((node, idx) => (
        <BlockNode key={idx} node={node} index={idx} postTitle={postTitle} />
      ))}
    </>
  );
}

function ListCard({ node }: { node: TreeNode }) {
  const items = node.data?.items ?? [];
  const ordered = node.data?.ordered === true;
  const ListTag = ordered ? "ol" : "ul";
  return (
    <div className="bg-card rounded-2xl p-8 shadow-sm border border-card-border hover-elevate transition-all duration-300">
      {node.data?.title && (
        <div className="flex items-center gap-3 mb-6 pb-4 border-b border-border/50">
          <List className="w-5 h-5 text-primary shrink-0" />
          <h3 className="font-medium text-foreground text-lg">{node.data.title}</h3>
        </div>
      )}
      <ListTag
        className={
          ordered
            ? "list-decimal pl-5 space-y-3 text-foreground/80"
            : "space-y-3 text-foreground/80"
        }
      >
        {items.map((item, idx) => (
          <li key={idx} className="leading-relaxed">
            {item}
          </li>
        ))}
      </ListTag>
    </div>
  );
}

function BlockNode({
  node,
  index,
  postTitle,
}: {
  node: TreeNode;
  index: number;
  postTitle: string;
}) {
  switch (node.blockType) {
    case "heading": {
      // The leading h1 in a componentTree typically duplicates the post title
      // (already shown in the hero), so skip that one to avoid repetition.
      if (index === 0 && node.text?.trim() === postTitle.trim()) return null;
      return (
        <h2 className="font-serif text-2xl md:text-3xl text-foreground mt-12 mb-6">
          {node.text}
        </h2>
      );
    }

    case "paragraph":
      return (
        <p className="text-base md:text-lg leading-relaxed text-foreground/80 mb-6">
          {node.text}
        </p>
      );

    case "list":
      return (
        <div className="mb-8">
          <ListCard node={node} />
        </div>
      );

    case "section": {
      const children = node.children ?? [];
      const paragraphs = children.filter((c) => c.blockType === "paragraph");
      const lists = children.filter((c) => c.blockType === "list");
      const others = children.filter(
        (c) => c.blockType !== "paragraph" && c.blockType !== "list",
      );
      return (
        <section id={node.anchorId} className="scroll-mt-24 mb-20">
          {node.data?.heading && (
            <h2 className="font-serif text-3xl md:text-4xl text-foreground mb-8">
              {node.data.heading}
            </h2>
          )}
          {paragraphs.map((p, idx) => (
            <p
              key={idx}
              className="text-base md:text-lg leading-relaxed text-foreground/80 mb-6"
            >
              {p.text}
            </p>
          ))}
          {lists.length > 0 && (
            <div className="grid md:grid-cols-2 gap-8 mt-10">
              {lists.map((l, idx) => (
                <ListCard key={idx} node={l} />
              ))}
            </div>
          )}
          {others.length > 0 && (
            <div className="mt-8">
              <ContentTree nodes={others} postTitle={postTitle} />
            </div>
          )}
        </section>
      );
    }

    default:
      if (node.children?.length) {
        return <ContentTree nodes={node.children} postTitle={postTitle} />;
      }
      if (node.text) {
        return (
          <p className="text-base md:text-lg leading-relaxed text-foreground/80 mb-6">
            {node.text}
          </p>
        );
      }
      return null;
  }
}

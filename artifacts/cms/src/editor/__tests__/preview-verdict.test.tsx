import { describe, it, expect } from "vitest";
import { createElement } from "react";
import TestRenderer, { act } from "react-test-renderer";
import type { ReactTestInstance } from "react-test-renderer";
import { ContentRenderer } from "@workspace/blog-renderer";
import { blocksToComponentTree, type EditorBlock } from "../model";

(
  globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }
).IS_REACT_ACT_ENVIRONMENT = true;

/**
 * The CMS editor preview (`EditorPreview`) renders the in-progress draft through
 * exactly these two steps: `blocksToComponentTree(blocks)` then
 * `<ContentRenderer post={{ componentTree, contentHtml: null }} />`. A migrated
 * review article loads into the editor as a single rich-text block carrying the
 * full body HTML, so this reproduces that path and asserts the verdict /
 * pros-cons heading shapes get promoted to `.verdict-callout` cards — the same
 * promotion the live blog applies via `prepareArticleHtml`. This locks the
 * preview against drifting back to plain (un-promoted) sanitized HTML.
 */

/** Collect every `dangerouslySetInnerHTML` payload in the rendered tree. */
function collectInnerHtml(renderer: TestRenderer.ReactTestRenderer): string {
  const hosts = renderer.root.findAll(
    (node: ReactTestInstance) =>
      typeof node.type === "string" &&
      Boolean(node.props?.dangerouslySetInnerHTML),
    { deep: true },
  );
  return hosts
    .map(
      (node: ReactTestInstance) =>
        (node.props.dangerouslySetInnerHTML as { __html?: string }).__html ?? "",
    )
    .join("");
}

describe("EditorPreview render pipeline — verdict callouts", () => {
  it("promotes The Good / The Bad heading shapes to verdict-callout cards", () => {
    const blocks: EditorBlock[] = [
      {
        id: "body",
        type: "richText",
        data: {
          html:
            "<h3>The Good</h3><p>Thrilling rides all day.</p>" +
            "<h3>The Bad</h3><p>Long queues at peak season.</p>",
        },
      },
    ];
    const componentTree = blocksToComponentTree(blocks);

    let renderer!: TestRenderer.ReactTestRenderer;
    act(() => {
      renderer = TestRenderer.create(
        createElement(ContentRenderer, {
          post: { componentTree, contentHtml: null },
        }),
      );
    });

    const html = collectInnerHtml(renderer);
    expect(html).toContain("verdict-callout verdict-callout--good");
    expect(html).toContain("verdict-callout verdict-callout--bad");
  });

  it("promotes a Verdict heading shape to a verdict-callout card", () => {
    const blocks: EditorBlock[] = [
      {
        id: "body",
        type: "richText",
        data: {
          html: "<h2>The Verdict</h2><p>Worth a visit if you love speed.</p>",
        },
      },
    ];
    const componentTree = blocksToComponentTree(blocks);

    let renderer!: TestRenderer.ReactTestRenderer;
    act(() => {
      renderer = TestRenderer.create(
        createElement(ContentRenderer, {
          post: { componentTree, contentHtml: null },
        }),
      );
    });

    expect(collectInnerHtml(renderer)).toContain(
      "verdict-callout verdict-callout--verdict",
    );
  });
});

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
 * Sibling of `preview-verdict.test.tsx`. The CMS editor preview
 * (`EditorPreview`) renders the in-progress draft through exactly two steps:
 * `blocksToComponentTree(blocks)` then
 * `<ContentRenderer post={{ componentTree, contentHtml: null }} />`. A migrated
 * article loads into the editor as a single rich-text block carrying the full
 * body HTML, which the renderer routes through `CTArticleHtml` →
 * `prepareArticleHtml` — the SAME pipeline the live blog applies to
 * `contentHtml`.
 *
 * The verdict test only locks in the verdict/pros-cons callout promotion. The
 * same `prepareArticleHtml` fix silently routes EVERY other migrated-markup
 * promotion through the preview too. This test pins the other special cards so
 * they can't quietly regress in the preview without anyone noticing until an
 * editor compares against the live blog: review spec cards
 * (`renderReviewSpecCard`), itinerary day balancing (`balanceItineraryDays`),
 * and merged listicle numbering (`mergeNumberedHeadings`).
 */

/**
 * Count `.days` blocks that are nested inside another `.days` block — the exact
 * corpus defect `balanceItineraryDays` repairs. A balanced widget has zero.
 * (Mirrors the helper in `lib/blog-renderer`'s parse tests.)
 */
function countNestedDays(html: string): number {
  const tokenRe = /<div\b[^>]*>|<\/div>/gi;
  const stack: boolean[] = [];
  let nested = 0;
  let m: RegExpExecArray | null;
  while ((m = tokenRe.exec(html))) {
    const tok = m[0];
    if (tok[1] === "/") {
      stack.pop();
      continue;
    }
    const clsM = tok.match(/\sclass\s*=\s*("([^"]*)"|'([^']*)')/i);
    const cls = clsM ? (clsM[2] ?? clsM[3] ?? "") : "";
    const isDays = cls.split(/\s+/).includes("days");
    if (isDays && stack.includes(true)) nested += 1;
    stack.push(isDays);
  }
  return nested;
}

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

/** Render a single migrated rich-text body block through the preview pipeline. */
function renderPreviewBody(html: string): string {
  const blocks: EditorBlock[] = [{ id: "body", type: "richText", data: { html } }];
  const componentTree = blocksToComponentTree(blocks);

  let renderer!: TestRenderer.ReactTestRenderer;
  act(() => {
    renderer = TestRenderer.create(
      createElement(ContentRenderer, {
        post: { componentTree, contentHtml: null },
      }),
    );
  });
  return collectInnerHtml(renderer);
}

describe("EditorPreview render pipeline — special article cards", () => {
  it("promotes a migrated review header into a .review-spec-card", () => {
    // The migrated Thrive review header as it appears in the corpus: a single
    // <p> of inline facts with <br>s nested inside <strong>/<span> wrappers.
    const header =
      '<p><strong><span style="color: #000000;">The Great Comet Review by: Jordan Diggory</span><br></strong>' +
      '<strong style="color: #000000;">Critic\u2019s Pic<br></strong>' +
      '<strong><span style="color: #000000;">Rating:</span>&nbsp;</strong>[star rating=\u201d8\u201d max=\u201d10\u201d]<br>' +
      "Theatre:&nbsp;Imperial Theatre &nbsp; &nbsp; &nbsp; Show Runtime:&nbsp;2 hrs. and 30 min.<br>" +
      '<a href="https://www.headout.com/broadway-musicals/x-e-4192/?stage=content" target="_blank" rel="noopener noreferrer">Natasha, Pierre &amp; The Great Comet of 1812 Tickets</a></p>';

    const html = renderPreviewBody(header);
    expect(html).toContain('class="review-spec-card"');
    expect(html).toContain('class="review-spec-card__grid"');
    expect(html).toContain(
      '<p class="review-spec-card__title">The Great Comet Review by: Jordan Diggory</p>',
    );
    // The [star] marker is converted to the .star-rating badge downstream.
    expect(html).toContain('class="star-rating"');
    expect(html).not.toContain("[star");
  });

  it("balances a malformed itinerary so the days render as siblings", () => {
    // Corpus defect: from the third day onward the closing </div> is missing,
    // so each day nests inside the previous one (runaway mobile overflow).
    const dayBlock = (n: number, closed: boolean) =>
      `<div class="days"><div class="itn-day">Day ${n}</div>` +
      `<div class="itn-flex-row-container"><div class="itn-body">x</div></div>` +
      (closed ? "</div>" : "");
    const malformed =
      `<div class="page-card">` +
      dayBlock(1, true) +
      dayBlock(2, true) +
      dayBlock(3, false) +
      dayBlock(4, false) +
      dayBlock(5, false) +
      `</div>`;

    // Guard the test itself: the malformed source really is unbalanced, so a
    // passing assertion below proves the preview pipeline did the repair.
    expect(countNestedDays(malformed)).toBeGreaterThan(0);

    const html = renderPreviewBody(malformed);
    // The repair landed: no `.days` block is nested inside another. This is the
    // assertion that actually fails if `balanceItineraryDays` regresses or is
    // dropped from the preview pipeline.
    expect(countNestedDays(html)).toBe(0);
    // All five days survive as siblings with their content intact.
    expect((html.match(/class="days"/g) ?? []).length).toBe(5);
    for (let n = 1; n <= 5; n++) expect(html).toContain(`Day ${n}`);
  });

  it("merges the standalone listicle number back into the heading", () => {
    // Attraction listicle: the number is a leading <span> inside the title.
    const attr =
      '<h2 class="attr-list-title"><span id="attr-1">1</span>Pemba Island</h2>';
    const attrHtml = renderPreviewBody(attr);
    expect(attrHtml).toContain("1. Pemba Island");
    expect(attrHtml).not.toContain('id="attr-1"');

    // Timeline listicle: the number is an orphaned <p class="number"> sibling.
    const timeline =
      '<div class="timeline"><div><p class="number">2</p>' +
      '<div class="timeline-line"></div></div>' +
      '<div class="timeline-text"><h2 class="card-title">9/11 Museum</h2></div></div>';
    const timelineHtml = renderPreviewBody(timeline);
    expect(timelineHtml).toContain("2. 9/11 Museum");
    expect(timelineHtml).not.toMatch(/<p[^>]*class="number"/);
  });
});

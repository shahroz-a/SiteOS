import { describe, expect, it } from "vitest";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { ContentRenderer, type RenderableContent } from "@workspace/blog-renderer";

/**
 * The CMS editor saves writer-inserted library images into `componentTree` and
 * nulls `contentHtml` so the structured tree is what renders. These tests prove
 * the published-blog half of that contract: an image carried in `componentTree`
 * actually paints an <img>, and a non-empty `contentHtml` would otherwise win —
 * which is exactly why the editor must null it.
 */

function render(post: RenderableContent): string {
  return renderToStaticMarkup(createElement(ContentRenderer, { post }));
}

describe("ContentRenderer — inserted componentTree images", () => {
  it("renders an image block from componentTree when there is no HTML body", () => {
    const html = render({
      contentHtml: null,
      componentTree: [
        { type: "richText", data: { html: "<p>Intro.</p>" } },
        {
          type: "image",
          data: { src: "https://cdn.headout.com/library/skyline.jpg", alt: "skyline" },
        },
      ],
    });

    expect(html).toContain('src="https://cdn.headout.com/library/skyline.jpg"');
    expect(html).toContain('alt="skyline"');
  });

  it("renders hero and gallery images carried in componentTree", () => {
    const html = render({
      contentHtml: null,
      componentTree: [
        { type: "hero", data: { title: "T", imageUrl: "https://cdn.headout.com/library/hero.jpg" } },
        {
          type: "gallery",
          data: {
            images: [
              { src: "https://cdn.headout.com/library/g1.jpg", alt: "g1" },
              { src: "https://cdn.headout.com/library/g2.jpg", alt: "g2" },
            ],
          },
        },
      ],
    });

    expect(html).toContain("https://cdn.headout.com/library/hero.jpg");
    expect(html).toContain("https://cdn.headout.com/library/g1.jpg");
    expect(html).toContain("https://cdn.headout.com/library/g2.jpg");
  });

  it("lets a non-empty contentHtml win over componentTree (why the editor nulls it)", () => {
    const html = render({
      contentHtml: "<p>Raw HTML body wins.</p>",
      componentTree: [
        {
          type: "image",
          data: { src: "https://cdn.headout.com/library/ignored.jpg", alt: "ignored" },
        },
      ],
    });

    expect(html).toContain("Raw HTML body wins.");
    expect(html).not.toContain("https://cdn.headout.com/library/ignored.jpg");
  });
});

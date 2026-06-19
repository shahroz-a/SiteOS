import { describe, it, expect } from "vitest";
import {
  decodeEntities,
  extractHtmlContent,
  extractTreeContent,
} from "../extract";

describe("decodeEntities", () => {
  it("decodes named and numeric entities", () => {
    expect(decodeEntities("Ben &amp; Jerry&#39;s &#x2014; yum &nbsp;")).toBe(
      "Ben & Jerry's \u2014 yum \u00a0",
    );
  });
});

describe("extractHtmlContent", () => {
  it("returns empty for null/empty html", () => {
    expect(extractHtmlContent(null)).toEqual({
      blocks: [],
      images: [],
      links: [],
    });
  });

  it("splits block-level text and ignores scripts/styles", () => {
    const html = `
      <style>.x{color:red}</style>
      <h1>Title</h1>
      <p>First paragraph with a <a href="/blog/x">link</a>.</p>
      <script>var pagespeed = 1;</script>
      <ul><li>One</li><li>Two</li></ul>
    `;
    const { blocks } = extractHtmlContent(html);
    expect(blocks).toEqual([
      "Title",
      "First paragraph with a link.",
      "One",
      "Two",
    ]);
  });

  it("extracts image src + alt and link href + text", () => {
    const html = `
      <p>Look: <img src="https://cdn-img.headout.com/a.jpg?w=8" alt="A &amp; B"></p>
      <a href="https://www.headout.com/things">Things to do</a>
    `;
    const { images, links } = extractHtmlContent(html);
    expect(images).toEqual([
      { url: "https://cdn-img.headout.com/a.jpg?w=8", alt: "A & B" },
    ]);
    expect(links).toEqual([
      { url: "https://www.headout.com/things", text: "Things to do" },
    ]);
  });
});

describe("extractTreeContent", () => {
  it("walks the crawler array shape (type discriminator, data.src)", () => {
    const tree = [
      { type: "heading", data: { heading: "Best things to do", level: 2 } },
      { type: "paragraph", text: "A lovely paragraph." },
      {
        type: "image",
        data: { src: "https://cdn-img.headout.com/x.jpg", alt: "X" },
      },
      {
        type: "richText",
        data: {
          richText: {
            type: "paragraph",
            children: [
              { type: "text", text: "Visit " },
              {
                type: "link",
                url: "https://www.headout.com/go",
                children: [{ type: "text", text: "Headout" }],
              },
            ],
          },
        },
      },
    ];
    const { blocks, images, links } = extractTreeContent(tree);
    expect(blocks).toEqual([
      "Best things to do",
      "A lovely paragraph.",
      "Visit Headout",
    ]);
    expect(images).toEqual([
      { url: "https://cdn-img.headout.com/x.jpg", alt: "X" },
    ]);
    expect(links).toEqual([
      { url: "https://www.headout.com/go", text: "Headout" },
    ]);
  });

  it("walks the importer root-object shape (blockType, data.url)", () => {
    const tree = {
      type: "root",
      children: [
        { blockType: "heading", data: { heading: "Intro" } },
        { blockType: "paragraph", text: "Body copy." },
        {
          blockType: "image",
          data: { url: "https://cdn-img.headout.com/y.png", alt: "Y" },
        },
      ],
    };
    const { blocks, images } = extractTreeContent(tree);
    expect(blocks).toEqual(["Intro", "Body copy."]);
    expect(images).toEqual([
      { url: "https://cdn-img.headout.com/y.png", alt: "Y" },
    ]);
  });

  it("returns empty for non-object input", () => {
    expect(extractTreeContent(null)).toEqual({
      blocks: [],
      images: [],
      links: [],
    });
  });
});

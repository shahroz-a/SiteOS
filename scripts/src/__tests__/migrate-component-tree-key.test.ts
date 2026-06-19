import { describe, it, expect } from "vitest";
import {
  renameTreeKey,
  migrateComponentTree,
} from "../migrate-component-tree-key";

describe("renameTreeKey", () => {
  it("renames a node's own `type` to `blockType`", () => {
    const node = { type: "heading", text: "Hi" };
    const changed = renameTreeKey(node);
    expect(changed).toBe(true);
    expect(node).toEqual({ blockType: "heading", text: "Hi" });
    expect("type" in node).toBe(false);
  });

  it("recurses into children only", () => {
    const tree = [
      {
        type: "section",
        children: [
          { type: "heading", text: "A" },
          { type: "richText", data: { html: "<p>x</p>" } },
        ],
      },
    ];
    const changed = renameTreeKey(tree);
    expect(changed).toBe(true);
    expect(tree).toEqual([
      {
        blockType: "section",
        children: [
          { blockType: "heading", text: "A" },
          { blockType: "richText", data: { html: "<p>x</p>" } },
        ],
      },
    ]);
  });

  it("NEVER touches Lexical nodes inside `data` (keyed `type` legitimately)", () => {
    const node = {
      type: "richText",
      data: {
        richText: {
          type: "paragraph",
          children: [{ type: "text", text: "hello" }],
        },
      },
    };
    renameTreeKey(node);
    expect((node as Record<string, unknown>).blockType).toBe("richText");
    // The Lexical subtree under `data` stays keyed `type`.
    const data = (node as { data: { richText: { type: string; children: Array<{ type: string }> } } }).data;
    expect(data.richText.type).toBe("paragraph");
    expect(data.richText.children[0].type).toBe("text");
  });

  it("is idempotent — a node already keyed `blockType` is untouched", () => {
    const node = { blockType: "heading", text: "Hi" };
    const changed = renameTreeKey(node);
    expect(changed).toBe(false);
    expect(node).toEqual({ blockType: "heading", text: "Hi" });
  });

  it("does not duplicate when both keys somehow exist (keeps blockType)", () => {
    const node = { type: "stale", blockType: "heading" } as Record<
      string,
      unknown
    >;
    const changed = renameTreeKey(node);
    expect(changed).toBe(false);
    expect(node.blockType).toBe("heading");
    // existing `type` is left as-is (idempotent guard only renames when no blockType)
    expect(node.type).toBe("stale");
  });

  it("running twice yields the same result (stable)", () => {
    const tree = [
      { type: "heading", text: "A", children: [{ type: "image", data: {} }] },
    ];
    renameTreeKey(tree);
    const once = JSON.parse(JSON.stringify(tree));
    renameTreeKey(tree);
    expect(tree).toEqual(once);
  });
});

describe("migrateComponentTree", () => {
  it("handles the crawler top-level array shape", () => {
    const { tree, changed } = migrateComponentTree([
      { type: "heading", text: "A" },
    ]);
    expect(changed).toBe(true);
    expect(tree).toEqual([{ blockType: "heading", text: "A" }]);
  });

  it("handles the importer root-object shape", () => {
    const { tree, changed } = migrateComponentTree({
      type: "root",
      children: [{ type: "heading", text: "A" }],
    });
    expect(changed).toBe(true);
    expect(tree).toEqual({
      blockType: "root",
      children: [{ blockType: "heading", text: "A" }],
    });
  });

  it("returns null/undefined unchanged", () => {
    expect(migrateComponentTree(null)).toEqual({ tree: null, changed: false });
    expect(migrateComponentTree(undefined)).toEqual({
      tree: undefined,
      changed: false,
    });
  });

  it("reports no change for an already-migrated tree", () => {
    const { changed } = migrateComponentTree([
      { blockType: "heading", text: "A" },
    ]);
    expect(changed).toBe(false);
  });
});

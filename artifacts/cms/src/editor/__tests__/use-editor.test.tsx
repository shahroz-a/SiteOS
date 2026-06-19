import { describe, it, expect } from "vitest";
import { createElement } from "react";
import TestRenderer, { act } from "react-test-renderer";
import { useEditor, type EditorApi } from "../use-editor";
import type { EditorBlock } from "../model";

/**
 * Minimal `renderHook` over react-test-renderer (no DOM needed): a probe
 * component calls the hook and stashes the latest api on a ref so tests can
 * drive it through `run(...)` and read the resulting state.
 */
function renderEditor(initial: EditorBlock[] = []) {
  const ref: { current: EditorApi | null } = { current: null };
  function Probe() {
    ref.current = useEditor(initial);
    return null;
  }
  let renderer: TestRenderer.ReactTestRenderer | null = null;
  act(() => {
    renderer = TestRenderer.create(createElement(Probe));
  });
  return {
    get api(): EditorApi {
      if (!ref.current) throw new Error("hook not rendered");
      return ref.current;
    },
    run(fn: (api: EditorApi) => void) {
      act(() => {
        fn(ref.current!);
      });
    },
    unmount() {
      act(() => {
        renderer?.unmount();
      });
    },
  };
}

describe("useEditor — insert & select", () => {
  it("appends an inserted block and selects it", () => {
    const h = renderEditor();
    h.run((a) => a.insert("heading"));
    expect(h.api.blocks).toHaveLength(1);
    expect(h.api.selectedId).toBe(h.api.blocks[0]!.id);
    expect(h.api.canUndo).toBe(true);
    expect(h.api.canRedo).toBe(false);
    h.unmount();
  });
});

describe("useEditor — undo / redo", () => {
  it("undoes and redoes an insert", () => {
    const h = renderEditor();
    h.run((a) => a.insert("heading"));
    const id = h.api.selectedId!;
    expect(h.api.blocks).toHaveLength(1);

    h.run((a) => a.undo());
    expect(h.api.blocks).toHaveLength(0);
    expect(h.api.canRedo).toBe(true);

    h.run((a) => a.redo());
    expect(h.api.blocks).toHaveLength(1);
    expect(h.api.blocks[0]!.id).toBe(id);
    h.unmount();
  });

  it("walks back through multiple discrete edits one step at a time", () => {
    const h = renderEditor();
    h.run((a) => a.insert("heading"));
    const id = h.api.selectedId!;
    h.run((a) => a.update(id, { text: "a" }));
    h.run((a) => a.update(id, { text: "ab" }));
    expect(h.api.findBlock(id)!.text).toBe("ab");

    h.run((a) => a.undo());
    expect(h.api.findBlock(id)!.text).toBe("a");
    h.run((a) => a.undo());
    expect(h.api.findBlock(id)!.text).toBe("");
    h.unmount();
  });

  it("coalesces consecutive edits sharing a key into one history entry", () => {
    const h = renderEditor();
    h.run((a) => a.insert("heading"));
    const id = h.api.selectedId!;
    const key = `text:${id}`;
    h.run((a) => a.update(id, { text: "a" }, key));
    h.run((a) => a.update(id, { text: "ab" }, key));
    h.run((a) => a.update(id, { text: "abc" }, key));
    expect(h.api.findBlock(id)!.text).toBe("abc");

    // A single undo rolls back all three coalesced keystrokes to the insert.
    h.run((a) => a.undo());
    expect(h.api.findBlock(id)!.text).toBe("");
    h.unmount();
  });

  it("clears the redo stack after a fresh edit", () => {
    const h = renderEditor();
    h.run((a) => a.insert("heading"));
    h.run((a) => a.undo());
    expect(h.api.canRedo).toBe(true);
    h.run((a) => a.insert("quote"));
    expect(h.api.canRedo).toBe(false);
    h.unmount();
  });

  it("no-ops undo/redo at the ends of history", () => {
    const h = renderEditor();
    h.run((a) => a.undo());
    expect(h.api.blocks).toHaveLength(0);
    h.run((a) => a.redo());
    expect(h.api.blocks).toHaveLength(0);
    h.unmount();
  });
});

describe("useEditor — reorder (move)", () => {
  it("reorders top-level siblings", () => {
    const h = renderEditor();
    h.run((a) => a.insert("heading"));
    const id1 = h.api.selectedId!;
    h.run((a) => a.insert("quote"));
    const id2 = h.api.selectedId!;
    expect(h.api.blocks.map((b) => b.id)).toEqual([id1, id2]);

    h.run((a) => a.move(id2, null, 0));
    expect(h.api.blocks.map((b) => b.id)).toEqual([id2, id1]);

    h.run((a) => a.undo());
    expect(h.api.blocks.map((b) => b.id)).toEqual([id1, id2]);
    h.unmount();
  });
});

describe("useEditor — nest (move into a section)", () => {
  it("moves a block into a section's children", () => {
    const h = renderEditor();
    h.run((a) => a.insert("section"));
    const sectionId = h.api.selectedId!;
    h.run((a) => a.insert("heading"));
    const headingId = h.api.selectedId!;
    expect(h.api.blocks).toHaveLength(2);

    h.run((a) => a.move(headingId, sectionId, 0));
    expect(h.api.blocks.map((b) => b.id)).toEqual([sectionId]);
    const section = h.api.findBlock(sectionId)!;
    expect(section.children?.map((c) => c.id)).toEqual([headingId]);
    h.unmount();
  });

  it("refuses to drop a section into its own descendant", () => {
    const h = renderEditor();
    h.run((a) => a.insert("section"));
    const sectionId = h.api.selectedId!;
    h.run((a) => a.insert("heading"));
    const headingId = h.api.selectedId!;
    h.run((a) => a.move(headingId, sectionId, 0));

    const before = h.api.blocks;
    h.run((a) => a.move(sectionId, headingId, 0));
    // Unchanged: section still at root holding the heading.
    expect(h.api.blocks).toBe(before);
    expect(h.api.findBlock(sectionId)!.children?.map((c) => c.id)).toEqual([headingId]);
    h.unmount();
  });
});

describe("useEditor — duplicate & delete", () => {
  it("duplicates a block in place with a fresh id and selects the copy", () => {
    const h = renderEditor();
    h.run((a) => a.insert("heading"));
    const id = h.api.selectedId!;
    h.run((a) => a.update(id, { text: "original" }));

    h.run((a) => a.duplicate(id));
    expect(h.api.blocks).toHaveLength(2);
    const copyId = h.api.selectedId!;
    expect(copyId).not.toBe(id);
    expect(h.api.blocks.map((b) => b.id)).toEqual([id, copyId]);
    expect(h.api.findBlock(copyId)!.text).toBe("original");
    h.unmount();
  });

  it("deep-clones nested children with fresh ids on duplicate", () => {
    const h = renderEditor();
    h.run((a) => a.insert("section"));
    const sectionId = h.api.selectedId!;
    h.run((a) => a.insert("heading"));
    const headingId = h.api.selectedId!;
    h.run((a) => a.move(headingId, sectionId, 0));

    h.run((a) => a.duplicate(sectionId));
    const copyId = h.api.selectedId!;
    const copy = h.api.findBlock(copyId)!;
    expect(copy.children).toHaveLength(1);
    expect(copy.children![0]!.id).not.toBe(headingId);
    h.unmount();
  });

  it("removes a block and clears selection when the deleted block was selected", () => {
    const h = renderEditor();
    h.run((a) => a.insert("heading"));
    const id = h.api.selectedId!;
    h.run((a) => a.remove(id));
    expect(h.api.blocks).toHaveLength(0);
    expect(h.api.selectedId).toBeNull();

    h.run((a) => a.undo());
    expect(h.api.blocks).toHaveLength(1);
    h.unmount();
  });
});

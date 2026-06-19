/**
 * Editor state: the block tree plus selection and undo/redo history.
 *
 * All structural operations (insert / move / nest / duplicate / delete) and
 * field edits go through the reducer so every change is undoable. Consecutive
 * edits to the same field of the same block are coalesced into one history entry
 * so typing doesn't flood the undo stack.
 */
import { useCallback, useMemo, useReducer } from "react";
import { createBlock, genId, type BlockType, type EditorBlock } from "./model";

const HISTORY_LIMIT = 100;

export interface EditorState {
  blocks: EditorBlock[];
  selectedId: string | null;
  past: EditorBlock[][];
  future: EditorBlock[][];
  /** Coalescing key for the last mutation; UPDATEs with the same key merge. */
  coalesceKey: string | null;
}

type Action =
  | { type: "RESET"; blocks: EditorBlock[] }
  | { type: "SELECT"; id: string | null }
  | { type: "INSERT"; block: EditorBlock; parentId: string | null; index: number }
  | { type: "UPDATE"; id: string; patch: Partial<EditorBlock>; coalesceKey?: string }
  | { type: "MOVE"; id: string; parentId: string | null; index: number }
  | { type: "DUPLICATE"; id: string }
  | { type: "DELETE"; id: string }
  | { type: "UNDO" }
  | { type: "REDO" };

/* ---------------- pure tree helpers ---------------- */

function findById(blocks: EditorBlock[], id: string): EditorBlock | null {
  for (const b of blocks) {
    if (b.id === id) return b;
    if (b.children) {
      const found = findById(b.children, id);
      if (found) return found;
    }
  }
  return null;
}

/** Remove a block by id, returning the new tree and the removed block. */
function removeById(
  blocks: EditorBlock[],
  id: string,
): { tree: EditorBlock[]; removed: EditorBlock | null } {
  let removed: EditorBlock | null = null;
  const tree: EditorBlock[] = [];
  for (const b of blocks) {
    if (b.id === id) {
      removed = b;
      continue;
    }
    if (b.children) {
      const r = removeById(b.children, id);
      if (r.removed) removed = r.removed;
      tree.push({ ...b, children: r.tree });
    } else {
      tree.push(b);
    }
  }
  return { tree, removed };
}

/** Insert `block` at `index` within `parentId` (null = root). */
function insertAt(
  blocks: EditorBlock[],
  parentId: string | null,
  index: number,
  block: EditorBlock,
): EditorBlock[] {
  if (parentId === null) {
    const next = blocks.slice();
    next.splice(Math.max(0, Math.min(index, next.length)), 0, block);
    return next;
  }
  return blocks.map((b) => {
    if (b.id === parentId) {
      const children = (b.children ?? []).slice();
      children.splice(Math.max(0, Math.min(index, children.length)), 0, block);
      return { ...b, children };
    }
    if (b.children) return { ...b, children: insertAt(b.children, parentId, index, block) };
    return b;
  });
}

function updateById(blocks: EditorBlock[], id: string, patch: Partial<EditorBlock>): EditorBlock[] {
  return blocks.map((b) => {
    if (b.id === id) {
      return {
        ...b,
        ...patch,
        data: patch.data ? { ...b.data, ...patch.data } : b.data,
      };
    }
    if (b.children) return { ...b, children: updateById(b.children, id, patch) };
    return b;
  });
}

/** Deep clone with fresh ids (for duplicate). */
function cloneWithIds(block: EditorBlock): EditorBlock {
  return {
    ...block,
    id: genId(),
    data: { ...block.data, ...(block.data.images ? { images: block.data.images.map((i) => ({ ...i })) } : {}), ...(block.data.entries ? { entries: block.data.entries.map((e) => ({ ...e })) } : {}), ...(block.data.rows ? { rows: block.data.rows.map((r) => r.slice()) } : {}) },
    children: block.children ? block.children.map(cloneWithIds) : undefined,
  };
}

/** True if `ancestorId` is `id` or contains it (prevents dropping into self). */
function isSelfOrDescendant(blocks: EditorBlock[], ancestorId: string, id: string): boolean {
  if (ancestorId === id) return true;
  const anc = findById(blocks, ancestorId);
  if (!anc?.children) return false;
  return findById(anc.children, id) !== null;
}

/* ---------------- reducer ---------------- */

function pushHistory(state: EditorState, nextBlocks: EditorBlock[], coalesceKey?: string): EditorState {
  // Coalesce consecutive edits sharing a key into the previous history entry.
  if (coalesceKey && coalesceKey === state.coalesceKey) {
    return { ...state, blocks: nextBlocks, future: [] };
  }
  const past = [...state.past, state.blocks].slice(-HISTORY_LIMIT);
  return { ...state, blocks: nextBlocks, past, future: [], coalesceKey: coalesceKey ?? null };
}

function reducer(state: EditorState, action: Action): EditorState {
  switch (action.type) {
    case "RESET":
      return { blocks: action.blocks, selectedId: null, past: [], future: [], coalesceKey: null };
    case "SELECT":
      return { ...state, selectedId: action.id };
    case "INSERT": {
      const next = insertAt(state.blocks, action.parentId, action.index, action.block);
      return { ...pushHistory(state, next), selectedId: action.block.id };
    }
    case "UPDATE": {
      const next = updateById(state.blocks, action.id, action.patch);
      return pushHistory(state, next, action.coalesceKey);
    }
    case "DELETE": {
      const { tree } = removeById(state.blocks, action.id);
      const sel = state.selectedId === action.id ? null : state.selectedId;
      return { ...pushHistory(state, tree), selectedId: sel };
    }
    case "DUPLICATE": {
      const original = findById(state.blocks, action.id);
      if (!original) return state;
      const copy = cloneWithIds(original);
      // Insert directly after the original at its own level.
      const { tree } = removeById(state.blocks, action.id);
      // Re-derive index by walking siblings of the original.
      const next = insertAfter(state.blocks, action.id, copy);
      void tree;
      return { ...pushHistory(state, next), selectedId: copy.id };
    }
    case "MOVE": {
      if (isSelfOrDescendant(state.blocks, action.id, action.parentId ?? "")) return state;
      const { tree, removed } = removeById(state.blocks, action.id);
      if (!removed) return state;
      const next = insertAt(tree, action.parentId, action.index, removed);
      return { ...pushHistory(state, next), selectedId: removed.id };
    }
    case "UNDO": {
      if (state.past.length === 0) return state;
      const previous = state.past[state.past.length - 1]!;
      const past = state.past.slice(0, -1);
      return { ...state, blocks: previous, past, future: [state.blocks, ...state.future], coalesceKey: null };
    }
    case "REDO": {
      if (state.future.length === 0) return state;
      const next = state.future[0]!;
      const future = state.future.slice(1);
      return { ...state, blocks: next, past: [...state.past, state.blocks], future, coalesceKey: null };
    }
    default:
      return state;
  }
}

/** Insert `block` immediately after the sibling identified by `afterId`. */
function insertAfter(blocks: EditorBlock[], afterId: string, block: EditorBlock): EditorBlock[] {
  const idx = blocks.findIndex((b) => b.id === afterId);
  if (idx >= 0) {
    const next = blocks.slice();
    next.splice(idx + 1, 0, block);
    return next;
  }
  return blocks.map((b) =>
    b.children ? { ...b, children: insertAfter(b.children, afterId, block) } : b,
  );
}

export interface EditorApi {
  blocks: EditorBlock[];
  selectedId: string | null;
  canUndo: boolean;
  canRedo: boolean;
  select: (id: string | null) => void;
  reset: (blocks: EditorBlock[]) => void;
  insert: (type: BlockType, parentId?: string | null, index?: number) => void;
  insertBlock: (block: EditorBlock, parentId?: string | null, index?: number) => void;
  update: (id: string, patch: Partial<EditorBlock>, coalesceKey?: string) => void;
  move: (id: string, parentId: string | null, index: number) => void;
  duplicate: (id: string) => void;
  remove: (id: string) => void;
  undo: () => void;
  redo: () => void;
  findBlock: (id: string) => EditorBlock | null;
}

export function useEditor(initial: EditorBlock[]): EditorApi {
  const [state, dispatch] = useReducer(reducer, {
    blocks: initial,
    selectedId: null,
    past: [],
    future: [],
    coalesceKey: null,
  });

  const insert = useCallback((type: BlockType, parentId: string | null = null, index?: number) => {
    const block = createBlock(type);
    dispatch({ type: "INSERT", block, parentId, index: index ?? Number.MAX_SAFE_INTEGER });
  }, []);

  const insertBlock = useCallback(
    (block: EditorBlock, parentId: string | null = null, index?: number) => {
      dispatch({ type: "INSERT", block, parentId, index: index ?? Number.MAX_SAFE_INTEGER });
    },
    [],
  );

  return useMemo<EditorApi>(
    () => ({
      blocks: state.blocks,
      selectedId: state.selectedId,
      canUndo: state.past.length > 0,
      canRedo: state.future.length > 0,
      select: (id) => dispatch({ type: "SELECT", id }),
      reset: (blocks) => dispatch({ type: "RESET", blocks }),
      insert,
      insertBlock,
      update: (id, patch, coalesceKey) => dispatch({ type: "UPDATE", id, patch, coalesceKey }),
      move: (id, parentId, index) => dispatch({ type: "MOVE", id, parentId, index }),
      duplicate: (id) => dispatch({ type: "DUPLICATE", id }),
      remove: (id) => dispatch({ type: "DELETE", id }),
      undo: () => dispatch({ type: "UNDO" }),
      redo: () => dispatch({ type: "REDO" }),
      findBlock: (id) => findById(state.blocks, id),
    }),
    [state, insert, insertBlock],
  );
}

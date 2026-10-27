import * as H from '../shared/helpers.mts';

export const AWAY_KEY = 'p:';

export interface TreeGroup { key: string; owner: string; depth: number; here: boolean; outline: boolean }
interface Placed { key: string; depth: number; groups: readonly TreeGroup[]; setSize: number; posInSet: number }
export type FolderItem = Placed & { kind: 'folder'; node: FolderNode; open: boolean; kids: boolean; here: boolean };
export type NoteItem = Placed & { kind: 'note'; note: OutlineRow; away: boolean };
export type HeadingItem = Placed & { kind: 'heading'; noteId: string; index: number; text: string };
export type TreeItem = FolderItem | NoteItem | HeadingItem;

export interface TreeInput {
  outline: Readonly<Record<string, OutlineRow[]>>;
  tree: readonly FolderNode[];
  scope: FolderNode | null;
  sort: SortKey;
  open: ReadonlySet<string>;
  here: ReadonlySet<string>;
  revealing: boolean;
  currentId: string | null;
  activeKey: string | null;
  headings: readonly { level: number; text: string }[];
}

export function chooseActive(items: readonly TreeItem[], id: string | null, activeKey: string | null) {
  if (!id) return -1;
  let first = -1;
  for (let i = 0; i < items.length; i++) {
    const item = items[i];
    if (item.kind !== 'note' || item.note.id !== id) continue;
    if (item.key === activeKey) return i;
    if (first < 0) first = i;
  }
  return first;
}

function numberSiblings(items: TreeItem[]) {
  const parentOf = (item: TreeItem) => (item.groups.length ? item.groups[item.groups.length - 1].key : '');
  const sizes = new Map<string, number>();
  for (const item of items) { const p = parentOf(item); const n = (sizes.get(p) || 0) + 1; sizes.set(p, n); item.posInSet = n; }
  for (const item of items) item.setSize = sizes.get(parentOf(item)) || 0;
}

export function treeItems(input: TreeInput) {
  const { outline, open, here } = input;
  const items: TreeItem[] = [];
  const pinnedFirst = (notes: OutlineRow[], book: boolean) => (book ? { pins: [], rest: notes } : { pins: notes.filter((n) => n.pinned), rest: notes.filter((n) => !n.pinned) });
  const noteItem = (note: OutlineRow, depth: number, groups: readonly TreeGroup[], away: boolean) => {
    items.push({ kind: 'note', key: (away ? AWAY_KEY : 'n:') + note.id, note, away, depth, groups, setSize: 0, posInSet: 0 });
  };
  const folderItem = (node: FolderNode, depth: number, groups: readonly TreeGroup[]) => {
    const notes = outline[node.id] || [];
    const kids = node.children.length + notes.length > 0;
    const isHere = here.has(node.id);
    const isOpen = kids && (open.has(node.id) || (isHere && input.revealing));
    const key = 'f:' + node.id;
    items.push({ kind: 'folder', key, node, open: isOpen, kids, here: isHere, depth, groups, setSize: 0, posInSet: 0 });
    if (isOpen) folderContents(node, depth + 1, [...groups, { key: 'g:' + key, owner: key, depth, here: isHere, outline: false }]);
  };
  const fillLevel = (folderId: string | null, pins: OutlineRow[], folders: readonly FolderNode[], rest: OutlineRow[], depth: number, groups: readonly TreeGroup[]) => {
    pins.forEach((n) => noteItem(n, depth, groups, n.folderId !== folderId));
    folders.forEach((c) => folderItem(c, depth, groups));
    rest.forEach((n) => noteItem(n, depth, groups, false));
  };
  const folderContents = (node: FolderNode, depth: number, groups: readonly TreeGroup[]) => {
    const { pins, rest } = pinnedFirst(outline[node.id] || [], node.book);
    fillLevel(node.id, pins, node.children, rest, depth, groups);
  };
  if (input.scope) folderContents(input.scope, 0, []);
  else {
    const everyPin = H.sortNotes(Object.values(outline).flat().filter((n) => n.pinned), input.sort);
    fillLevel(null, everyPin, input.tree, (outline[''] || []).filter((n) => !n.pinned), 0, []);
  }
  const active = chooseActive(items, input.currentId, input.activeKey);
  const chosen = items[active];
  if (chosen && chosen.kind === 'note' && input.headings.length >= 2) {
    const minLevel = Math.min(...input.headings.map((h) => h.level));
    const groups = [...chosen.groups, { key: 'g:' + chosen.key, owner: chosen.key, depth: chosen.depth, here: true, outline: true }];
    const headings: HeadingItem[] = input.headings.map((h, index) => ({
      kind: 'heading', key: 'h:' + chosen.note.id + ':' + index, noteId: chosen.note.id, index, text: h.text,
      depth: chosen.depth + 1 + (h.level - minLevel), groups, setSize: 0, posInSet: 0,
    }));
    items.splice(active + 1, 0, ...headings);
  }
  numberSiblings(items);
  return { items, active };
}

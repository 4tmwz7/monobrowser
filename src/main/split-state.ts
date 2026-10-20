// Pure bookkeeping of split-view groups: which two tabs are shown side by side and how the
// space is divided. A tab belongs to at most one group. No Electron imports.
import { clampSplitRatio, DEFAULT_SPLIT_RATIO, type SplitSide } from "./split-layout.js";

export type SplitGroup = {
  id: number;
  left: number;
  right: number;
  ratio: number;
  /** The workspace the split lives in; both tabs belong to it. */
  workspaceId: string;
};

export const DEFAULT_SPLIT_WORKSPACE = "main";

export type SplitRegistry = {
  groups: () => SplitGroup[];
  /** Creates a group (left | right); any group already containing either tab is dissolved first. */
  create: (left: number, right: number, ratio?: number, workspaceId?: string) => SplitGroup | null;
  groupOf: (tabId: number) => SplitGroup | null;
  partnerOf: (tabId: number) => number | null;
  sideOf: (group: SplitGroup, tabId: number) => SplitSide | null;
  setRatio: (groupId: number, ratio: number) => SplitGroup | null;
  /** Dissolves the group that contains the tab; returns it (or null). */
  dissolve: (tabId: number) => SplitGroup | null;
  /** Dissolves every group of a workspace; returns the removed groups. */
  dissolveWorkspace: (workspaceId: string) => SplitGroup[];
  clear: () => void;
};

export const createSplitRegistry = (): SplitRegistry => {
  let groups: SplitGroup[] = [];
  let nextId = 1;
  const groupOf = (tabId: number): SplitGroup | null =>
    groups.find((group) => group.left === tabId || group.right === tabId) ?? null;
  return {
    groups: () => groups.map((group) => ({ ...group })),
    create: (left, right, ratio, workspaceId) => {
      if (!Number.isInteger(left) || !Number.isInteger(right) || left === right) return null;
      groups = groups.filter((group) => ![left, right].some((id) => group.left === id || group.right === id));
      const group: SplitGroup = { id: nextId++, left, right, ratio: clampSplitRatio(ratio ?? DEFAULT_SPLIT_RATIO), workspaceId: workspaceId || DEFAULT_SPLIT_WORKSPACE };
      groups.push(group);
      return group;
    },
    groupOf,
    partnerOf: (tabId) => {
      const group = groupOf(tabId);
      if (!group) return null;
      return group.left === tabId ? group.right : group.left;
    },
    sideOf: (group, tabId) => (group.left === tabId ? "left" : group.right === tabId ? "right" : null),
    setRatio: (groupId, ratio) => {
      const group = groups.find((entry) => entry.id === groupId);
      if (!group) return null;
      group.ratio = clampSplitRatio(ratio);
      return group;
    },
    dissolve: (tabId) => {
      const group = groupOf(tabId);
      if (!group) return null;
      groups = groups.filter((entry) => entry !== group);
      return group;
    },
    dissolveWorkspace: (workspaceId) => {
      const removed = groups.filter((group) => group.workspaceId === workspaceId);
      groups = groups.filter((group) => group.workspaceId !== workspaceId);
      return removed.map((group) => ({ ...group }));
    },
    clear: () => { groups = []; },
  };
};

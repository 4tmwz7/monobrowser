// Persistence of split views, independent of session.json: splits are stored as URL pairs and
// matched against the restored tabs (each restored tab can join at most one split).
// Private tabs never reach this file. No Electron imports.
import { isRestorableUrl } from "./session-store.js";
import { clampSplitRatio } from "./split-layout.js";

const MAIN_WORKSPACE = "main";
export type StoredSplit = { leftUrl: string; rightUrl: string; ratio: number; workspaceId: string };
export type SplitSourceTab = { id: number; url: string; isPrivate: boolean; internal: boolean };
export type RestoredSplit = { left: number; right: number; ratio: number; workspaceId: string };

const MAX_STORED_SPLITS = 50;

export const buildStoredSplits = (
  groups: { left: number; right: number; ratio: number; workspaceId?: string }[],
  tabs: SplitSourceTab[],
): StoredSplit[] => {
  const byId = new Map(tabs.map((tab) => [tab.id, tab]));
  const result: StoredSplit[] = [];
  for (const group of groups) {
    const left = byId.get(group.left);
    const right = byId.get(group.right);
    if (!left || !right) continue;
    if (left.isPrivate || right.isPrivate || left.internal || right.internal) continue;
    if (!isRestorableUrl(left.url) || !isRestorableUrl(right.url)) continue;
    result.push({ leftUrl: left.url, rightUrl: right.url, ratio: clampSplitRatio(group.ratio), workspaceId: group.workspaceId || MAIN_WORKSPACE });
  }
  return result.slice(0, MAX_STORED_SPLITS);
};

/** Validates the (untrusted) split file. */
export const normalizeStoredSplits = (value: unknown): StoredSplit[] => {
  const list = Array.isArray(value) ? value : (typeof value === "object" && value !== null ? (value as { splits?: unknown }).splits : null);
  if (!Array.isArray(list)) return [];
  const result: StoredSplit[] = [];
  for (const entry of list.slice(0, MAX_STORED_SPLITS)) {
    if (typeof entry !== "object" || entry === null) continue;
    const raw = entry as Record<string, unknown>;
    if (!isRestorableUrl(raw.leftUrl) || !isRestorableUrl(raw.rightUrl)) continue;
    const workspaceId = typeof raw.workspaceId === "string" && raw.workspaceId.length > 0 && raw.workspaceId.length <= 64 ? raw.workspaceId : MAIN_WORKSPACE;
    result.push({ leftUrl: raw.leftUrl, rightUrl: raw.rightUrl, ratio: clampSplitRatio(raw.ratio), workspaceId });
  }
  return result;
};

/** Pairs stored splits with restored tabs by URL and workspace; a tab is used at most once. */
export const matchStoredSplits = (stored: StoredSplit[], restored: { id: number; url: string; workspaceId?: string }[]): RestoredSplit[] => {
  const used = new Set<number>();
  const take = (url: string, workspaceId: string): number | null => {
    const found = restored.find((tab) => tab.url === url && (tab.workspaceId ?? MAIN_WORKSPACE) === workspaceId && !used.has(tab.id));
    if (!found) return null;
    used.add(found.id);
    return found.id;
  };
  const result: RestoredSplit[] = [];
  for (const split of stored) {
    const left = take(split.leftUrl, split.workspaceId);
    if (left === null) continue;
    const right = take(split.rightUrl, split.workspaceId);
    if (right === null) {
      used.delete(left);
      continue;
    }
    result.push({ left, right, ratio: split.ratio, workspaceId: split.workspaceId });
  }
  return result;
};

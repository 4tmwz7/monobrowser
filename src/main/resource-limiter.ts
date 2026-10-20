// Czysta logika ograniczników zasobów (RAM / CPU). Bez zależności od Electrona i systemu.

export type SleepCandidate = {
  id: number;
  /** Szacowana pamięć karty w KB (workingSetSize jej procesu); 0 = nieznana. */
  memKb: number;
  lastActiveAt: number;
  pinned: boolean;
  audible: boolean;
};

export const UNKNOWN_TAB_MEMORY_KB = 100 * 1024;
export const RAM_HYSTERESIS = 0.1;

export const sumMemoryKb = (metrics: ReadonlyArray<{ memory?: { workingSetSize?: number } }>): number =>
  metrics.reduce((sum, metric) => sum + (Number(metric.memory?.workingSetSize) || 0), 0);

/**
 * Chooses tabs to put to sleep so that usage drops below limit * (1 - hysteresis).
 * Order: ordinary tabs (least recently used first), then pinned, then audible, then pinned+audible.
 * Returns [] while usage is within the limit.
 */
export const selectTabsToSleep = (
  usageKb: number,
  limitKb: number,
  candidates: readonly SleepCandidate[],
  hysteresis: number = RAM_HYSTERESIS,
): number[] => {
  if (!(usageKb > limitKb) || limitKb <= 0) return [];
  const target = limitKb * (1 - hysteresis);
  const rank = (tab: SleepCandidate): number => (tab.pinned ? 1 : 0) + (tab.audible ? 2 : 0);
  const ordered = [...candidates].sort((a, b) => rank(a) - rank(b) || a.lastActiveAt - b.lastActiveAt || a.id - b.id);
  const picked: number[] = [];
  let remaining = usageKb;
  for (const tab of ordered) {
    if (remaining <= target) break;
    picked.push(tab.id);
    remaining -= tab.memKb > 0 ? tab.memKb : UNKNOWN_TAB_MEMORY_KB;
  }
  return picked;
};

/**
 * Estimates per-tab memory from process metrics. Tabs sharing one OS process split its memory evenly.
 */
export const estimateTabMemoryKb = (
  tabPids: ReadonlyMap<number, number | null>,
  memoryByPid: ReadonlyMap<number, number>,
): Map<number, number> => {
  const sharing = new Map<number, number>();
  for (const pid of tabPids.values()) {
    if (pid) sharing.set(pid, (sharing.get(pid) ?? 0) + 1);
  }
  const result = new Map<number, number>();
  for (const [tabId, pid] of tabPids) {
    result.set(tabId, pid ? (memoryByPid.get(pid) ?? 0) / (sharing.get(pid) ?? 1) : 0);
  }
  return result;
};

/** Parses a Linux cpulist such as "0-3,8,10-11". */
export const parseCpuList = (text: string): number[] => {
  const cpus = new Set<number>();
  for (const part of text.trim().split(",")) {
    const match = /^(\d+)(?:-(\d+))?$/.exec(part.trim());
    if (!match) continue;
    const start = Number(match[1]);
    const end = match[2] === undefined ? start : Number(match[2]);
    if (end < start || end - start > 4096) continue;
    for (let cpu = start; cpu <= end; cpu += 1) cpus.add(cpu);
  }
  return [...cpus].sort((a, b) => a - b);
};

export const cpuListFromStatus = (statusText: string): number[] => {
  const match = /^Cpus_allowed_list:\s*(.+)$/m.exec(statusText);
  return match ? parseCpuList(match[1]) : [];
};

export const defaultCpuList = (total: number): number[] => Array.from({ length: Math.max(1, total) }, (_, index) => index);

/** Bit mask with the first `threads` CPUs of `cpus`. */
export const cpuMask = (cpus: readonly number[], threads: number): bigint => {
  let mask = 0n;
  for (const cpu of cpus.slice(0, Math.max(1, Math.floor(threads)))) mask |= 1n << BigInt(cpu);
  return mask;
};

export const tasksetArgs = (mask: bigint, pid: number): string[] => ["-a", "-p", mask.toString(16), String(pid)];

/** Windows affinity is a 64-bit mask limited to one processor group; keep it positive (63 bits). */
export const windowsAffinityMask = (cpus: readonly number[], threads: number): bigint =>
  cpuMask(cpus.filter((cpu) => cpu < 63), threads);

export const isValidPid = (pid: unknown): pid is number => typeof pid === "number" && Number.isInteger(pid) && pid > 0;

export const buildPowerShellAffinityScript = (pids: readonly number[], mask: bigint): string => {
  const safePids = pids.filter(isValidPid);
  if (safePids.length === 0 || mask <= 0n) return "";
  return `Get-Process -Id ${safePids.join(",")} -ErrorAction SilentlyContinue | ForEach-Object { try { $_.ProcessorAffinity = [IntPtr][long]${mask.toString(10)} } catch {} }`;
};

/** Soft value of "Max nice priority" from /proc/self/limits (null when unknown). */
export const parseMaxNicePriority = (limitsText: string): number | null => {
  const match = /^Max nice priority\s+(\S+)/m.exec(limitsText);
  if (!match) return null;
  if (match[1] === "unlimited") return 40;
  const value = Number(match[1]);
  return Number.isFinite(value) ? value : null;
};

/** Raising nice (lowering priority) is only reversible without root when RLIMIT_NICE allows going back. */
export const canRestoreNiceness = (maxNicePriority: number | null, baselineNice: number): boolean =>
  maxNicePriority !== null && 20 - maxNicePriority <= baselineNice;

export const buildSystemdRunArgs = (limitMb: number, command: readonly string[]): string[] => [
  "--user",
  "--scope",
  "--quiet",
  "-p",
  `MemoryMax=${Math.max(1, Math.floor(limitMb))}M`,
  "-p",
  "MemorySwapMax=0",
  "--",
  ...command,
];

export const HARD_LIMIT_ENV = "MONOBROWSER_HARD_LIMIT_MB";

export const shouldRelaunchUnderScope = (input: {
  platform: string;
  enabled: boolean;
  hard: boolean;
  env: Readonly<Record<string, string | undefined>>;
}): boolean => input.platform === "linux" && input.enabled && input.hard && !input.env[HARD_LIMIT_ENV];

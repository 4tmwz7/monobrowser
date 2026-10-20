// Środowisko uruchomieniowe ograniczników RAM / CPU. Logika decyzyjna jest w resource-limiter.ts.
import { execFile, spawn, spawnSync } from "node:child_process";
import fsSync from "node:fs";
import os from "node:os";
import type { ExperimentalSettings } from "./experimental-settings.js";
import {
  buildPowerShellAffinityScript,
  buildSystemdRunArgs,
  canRestoreNiceness,
  cpuListFromStatus,
  cpuMask,
  defaultCpuList,
  estimateTabMemoryKb,
  HARD_LIMIT_ENV,
  isValidPid,
  parseMaxNicePriority,
  selectTabsToSleep,
  sumMemoryKb,
  tasksetArgs,
  windowsAffinityMask,
} from "./resource-limiter.js";

export type TabSnapshot = {
  id: number;
  pid: number | null;
  lastActiveAt: number;
  pinned: boolean;
  audible: boolean;
  sleeping: boolean;
  active: boolean;
  /** Not sleeping, not active, not internal/loading/devtools - may be put to sleep. */
  sleepable: boolean;
};

export type LimiterHost = {
  getMetrics: () => Array<{ pid: number; memory?: { workingSetSize?: number } }>;
  getTabSnapshots: () => TabSnapshot[];
  /** Pids that must keep normal priority (active tab, shell, overlays). */
  getForegroundPids: () => Set<number>;
  /** Puts a tab to sleep, also pinned/audible ones (caller decides the order). */
  sleepTab: (id: number) => boolean;
};

export type CpuState = "off" | "active" | "unsupported" | "no-taskset" | "no-powershell" | "error";
export type PriorityState = "off" | "active" | "unsupported" | "needs-rlimit" | "error";

export type LimiterStatus = {
  ramUsageMb: number;
  ramSleptTotal: number;
  cpuState: CpuState;
  cpuProcesses: number;
  priorityState: PriorityState;
  priorityLowered: number;
};

const RAM_INTERVAL_MS = 5000;
const CPU_INTERVAL_MS = 3000;
// A tab used/woken very recently is never put to sleep by the RAM limiter (avoids sleep/wake thrash).
const MIN_IDLE_BEFORE_SLEEP_MS = 10_000;

const readText = (file: string): string => {
  try {
    return fsSync.readFileSync(file, "utf8");
  } catch {
    return "";
  }
};

// Captured once at load, before any limiter changes the affinity of this process.
const INITIAL_CPUS: number[] = (() => {
  const total = os.availableParallelism();
  if (process.platform === "linux") {
    const list = cpuListFromStatus(readText("/proc/self/status"));
    if (list.length > 0) return list;
  }
  return defaultCpuList(total);
})();

export const getSystemInfo = (): { totalMemMb: number; maxThreads: number } => ({
  totalMemMb: Math.max(1, Math.floor(os.totalmem() / (1024 * 1024))),
  maxThreads: Math.max(1, INITIAL_CPUS.length),
});

const run = (file: string, args: string[], timeout = 4000): Promise<{ ok: boolean; missing: boolean }> =>
  new Promise((resolve) => {
    execFile(file, args, { timeout, windowsHide: true }, (error) => {
      const code = (error as NodeJS.ErrnoException | null)?.code;
      resolve({ ok: !error, missing: code === "ENOENT" });
    });
  });

let systemdRunCache: boolean | null = null;
export const isSystemdRunAvailable = (): boolean => {
  if (process.platform !== "linux") return false;
  if (systemdRunCache === null) {
    try {
      systemdRunCache = spawnSync("systemd-run", ["--version"], { stdio: "ignore", timeout: 3000 }).status === 0;
    } catch {
      systemdRunCache = false;
    }
  }
  return systemdRunCache;
};

/** Current hard limit (MB) when this process already runs inside the systemd scope, else null. */
export const getActiveHardLimitMb = (): number | null => {
  const value = Number(process.env[HARD_LIMIT_ENV]);
  return Number.isFinite(value) && value > 0 ? value : null;
};

export type RelaunchResult = "relaunched" | "unavailable" | "failed";

/**
 * Relaunches the app inside `systemd-run --user --scope -p MemoryMax=… -p MemorySwapMax=0`.
 * Verifies first (asynchronously, with a timeout) that a scope with that limit really works. "relaunched"
 * means the new process stayed alive past a short grace period and the caller must exit right away;
 * "unavailable"/"failed" mean nothing is running instead of us and the caller continues a normal start.
 * beforeSpawn releases the single-instance lock, afterFailure takes it back.
 */
export const relaunchUnderMemoryScope = async (
  limitMb: number,
  beforeSpawn: () => void,
  afterFailure: () => void,
): Promise<RelaunchResult> => {
  if (process.platform !== "linux" || !isSystemdRunAvailable()) return "unavailable";
  try {
    const probeOut = await new Promise<string | null>((resolve) => {
      execFile(
        "systemd-run",
        buildSystemdRunArgs(limitMb, ["sh", "-c", "cat /sys/fs/cgroup$(cut -d: -f3 /proc/self/cgroup)/memory.max"]),
        { encoding: "utf8", timeout: 5000, windowsHide: true },
        (error, stdout) => resolve(error ? null : String(stdout).trim()),
      );
    });
    if (probeOut !== String(limitMb * 1024 * 1024)) return "failed";
    const command = process.env.APPIMAGE ? [process.env.APPIMAGE] : [process.execPath];
    command.push(...process.argv.slice(1));
    beforeSpawn();
    const child = spawn("systemd-run", buildSystemdRunArgs(limitMb, command), {
      detached: true,
      stdio: "inherit",
      env: { ...process.env, [HARD_LIMIT_ENV]: String(limitMb) },
    });
    // systemd-run --scope execs the app in place, so an early non-zero exit/spawn error means it never started.
    const early = await new Promise<boolean>((resolve) => {
      const timer = setTimeout(() => resolve(false), 2500);
      child.once("error", () => { clearTimeout(timer); resolve(true); });
      child.once("exit", (code) => { clearTimeout(timer); resolve(code !== 0); });
    });
    if (early) {
      afterFailure();
      return "failed";
    }
    child.unref();
    return "relaunched";
  } catch {
    afterFailure();
    return "failed";
  }
};

/** Chromium moves the browser process into its own app-*.scope; limit that unit too (the helpers stay in ours). */
export const limitOwnScopeIfNeeded = (limitMb: number): void => {
  if (process.platform !== "linux") return;
  setTimeout(() => {
    const unit = /([^/]+\.scope)\s*$/m.exec(readText("/proc/self/cgroup"))?.[1];
    if (!unit || unit.startsWith("run-")) return;
    execFile(
      "systemctl",
      ["--user", "set-property", "--runtime", unit, `MemoryMax=${Math.floor(limitMb)}M`, "MemorySwapMax=0"],
      { timeout: 5000, windowsHide: true },
      () => undefined,
    );
  }, 3000).unref();
};

export class ResourceLimiter {
  private settings: ExperimentalSettings | null = null;
  private ramTimer: NodeJS.Timeout | null = null;
  private cpuTimer: NodeJS.Timeout | null = null;
  private prioritySoon: NodeJS.Timeout | null = null;
  private ramSleptTotal = 0;

  private cpuState: CpuState = "off";
  private cpuThreadsApplied = 0;
  private readonly cpuApplied = new Set<number>();
  private cpuBusy = false;
  private cpuRerun = false;
  private cpuAvailable: boolean | null = null;

  private priorityState: PriorityState = "off";
  private readonly priorityLowered = new Set<number>();
  private readonly baselineNice = process.platform === "linux" ? safeGetPriority() : 0;

  constructor(private readonly host: LimiterHost) {}

  apply(next: ExperimentalSettings): void {
    const prev = this.settings;
    this.settings = next;

    // RAM
    if (next.ramLimiterEnabled && !this.ramTimer) {
      this.ramTimer = setInterval(() => this.ramTick(), RAM_INTERVAL_MS);
      this.ramTimer.unref();
    } else if (!next.ramLimiterEnabled && this.ramTimer) {
      clearInterval(this.ramTimer);
      this.ramTimer = null;
    }
    if (next.ramLimiterEnabled && (!prev || !prev.ramLimiterEnabled || prev.ramLimitMb !== next.ramLimitMb)) {
      this.ramTick();
    }

    // CPU + priority
    const needsCpuTimer = next.cpuLimiterEnabled || next.cpuLowerBackgroundPriority;
    if (needsCpuTimer && !this.cpuTimer) {
      this.cpuTimer = setInterval(() => void this.cpuTick(), CPU_INTERVAL_MS);
      this.cpuTimer.unref();
    } else if (!needsCpuTimer && this.cpuTimer) {
      clearInterval(this.cpuTimer);
      this.cpuTimer = null;
    }
    void this.cpuTick();
  }

  /** Cheap hook for tab switches: re-evaluates background priorities soon. */
  notifyTabsChanged(): void {
    if (!this.settings?.cpuLowerBackgroundPriority || this.prioritySoon) return;
    this.prioritySoon = setTimeout(() => {
      this.prioritySoon = null;
      this.syncPriority();
    }, 150);
  }

  getStatus(): LimiterStatus {
    let usageKb = 0;
    try {
      usageKb = sumMemoryKb(this.host.getMetrics());
    } catch {
      usageKb = 0;
    }
    return {
      ramUsageMb: Math.round(usageKb / 1024),
      ramSleptTotal: this.ramSleptTotal,
      cpuState: this.cpuState,
      cpuProcesses: this.cpuApplied.size,
      priorityState: this.priorityState,
      priorityLowered: this.priorityLowered.size,
    };
  }

  dispose(): void {
    if (this.ramTimer) clearInterval(this.ramTimer);
    if (this.cpuTimer) clearInterval(this.cpuTimer);
    if (this.prioritySoon) clearTimeout(this.prioritySoon);
    this.ramTimer = this.cpuTimer = this.prioritySoon = null;
  }

  // ── RAM ───────────────────────────────────────────────────────────────────
  private ramTick(): void {
    const settings = this.settings;
    if (!settings?.ramLimiterEnabled) return;
    try {
      const metrics = this.host.getMetrics();
      const usageKb = sumMemoryKb(metrics);
      const limitKb = settings.ramLimitMb * 1024;
      if (usageKb <= limitKb) return;

      const now = Date.now();
      const snapshots = this.host.getTabSnapshots();
      const memoryByPid = new Map<number, number>();
      for (const metric of metrics) memoryByPid.set(metric.pid, Number(metric.memory?.workingSetSize) || 0);
      const perTab = estimateTabMemoryKb(new Map(snapshots.filter((t) => !t.sleeping).map((t) => [t.id, t.pid])), memoryByPid);
      const candidates = snapshots
        .filter((tab) => tab.sleepable && now - tab.lastActiveAt >= MIN_IDLE_BEFORE_SLEEP_MS)
        .map((tab) => ({
          id: tab.id,
          memKb: perTab.get(tab.id) ?? 0,
          lastActiveAt: tab.lastActiveAt,
          pinned: tab.pinned,
          audible: tab.audible,
        }));
      for (const id of selectTabsToSleep(usageKb, limitKb, candidates)) {
        if (this.host.sleepTab(id)) this.ramSleptTotal += 1;
      }
    } catch (error) {
      console.error("RAM limiter sweep failed:", error);
    }
  }

  // ── CPU affinity + priority ───────────────────────────────────────────────
  private async detectCpuAvailability(): Promise<CpuState | null> {
    if (process.platform === "linux") {
      if (this.cpuAvailable === null) this.cpuAvailable = !(await run("taskset", ["--version"])).missing;
      return this.cpuAvailable ? null : "no-taskset";
    }
    if (process.platform === "win32") return null;
    return "unsupported";
  }

  private alivePids(): number[] {
    const pids = new Set<number>([process.pid]);
    for (const metric of this.host.getMetrics()) if (isValidPid(metric.pid)) pids.add(metric.pid);
    // Chromium's zygote processes are missing from app.getAppMetrics() but renderers inherit their affinity.
    if (process.platform === "linux") for (const pid of linuxDescendantPids(process.pid)) pids.add(pid);
    return [...pids];
  }

  private async setAffinity(pids: number[], mask: bigint): Promise<boolean> {
    if (pids.length === 0) return true;
    if (process.platform === "linux") {
      const results = await Promise.all(pids.map((pid) => run("taskset", tasksetArgs(mask, pid))));
      return results.some((result) => result.ok);
    }
    const script = buildPowerShellAffinityScript(pids, mask);
    if (!script) return true;
    const result = await run("powershell.exe", ["-NoProfile", "-NonInteractive", "-WindowStyle", "Hidden", "-Command", script], 15000);
    if (result.missing) this.cpuState = "no-powershell";
    return result.ok;
  }

  private maskFor(threads: number): bigint {
    return process.platform === "win32" ? windowsAffinityMask(INITIAL_CPUS, threads) : cpuMask(INITIAL_CPUS, threads);
  }

  private async cpuTick(): Promise<void> {
    if (this.cpuBusy) {
      this.cpuRerun = true;
      return;
    }
    this.cpuBusy = true;
    try {
      const settings = this.settings;
      if (!settings) return;
      if (settings.cpuLowerBackgroundPriority || this.priorityLowered.size > 0) this.syncPriority();
      else this.priorityState = "off";

      if (!settings.cpuLimiterEnabled) {
        if (this.cpuApplied.size > 0) {
          const alive = new Set(this.alivePids());
          await this.setAffinity([...this.cpuApplied].filter((pid) => alive.has(pid)), this.maskFor(INITIAL_CPUS.length));
          this.cpuApplied.clear();
        }
        this.cpuState = "off";
        this.cpuThreadsApplied = 0;
        return;
      }

      const unavailable = await this.detectCpuAvailability();
      if (unavailable) {
        this.cpuState = unavailable;
        return;
      }
      const alive = this.alivePids();
      for (const pid of [...this.cpuApplied]) if (!alive.includes(pid)) this.cpuApplied.delete(pid);
      if (this.cpuThreadsApplied !== settings.cpuThreads) {
        this.cpuApplied.clear();
        this.cpuThreadsApplied = settings.cpuThreads;
      }
      const fresh = alive.filter((pid) => !this.cpuApplied.has(pid));
      if (fresh.length === 0) {
        if (this.cpuState === "off") this.cpuState = "active";
        return;
      }
      const ok = await this.setAffinity(fresh, this.maskFor(settings.cpuThreads));
      for (const pid of fresh) this.cpuApplied.add(pid);
      if (this.cpuState !== "no-powershell") this.cpuState = ok ? "active" : "error";
    } catch {
      this.cpuState = "error";
    } finally {
      this.cpuBusy = false;
      if (this.cpuRerun) {
        this.cpuRerun = false;
        void this.cpuTick();
      }
    }
  }

  private syncPriority(): void {
    const settings = this.settings;
    try {
      if (!settings?.cpuLowerBackgroundPriority) {
        this.restoreAllPriorities();
        this.priorityState = "off";
        return;
      }
      if (process.platform !== "linux" && process.platform !== "win32") {
        this.priorityState = "unsupported";
        return;
      }
      if (process.platform === "linux" && !canRestoreNiceness(parseMaxNicePriority(readText("/proc/self/limits")), this.baselineNice)) {
        this.priorityState = "needs-rlimit";
        return;
      }
      const foreground = this.host.getForegroundPids();
      const desired = new Set<number>();
      for (const tab of this.host.getTabSnapshots()) {
        if (tab.pid && !tab.sleeping && !tab.active && !tab.audible && !foreground.has(tab.pid)) desired.add(tab.pid);
      }
      const low = os.constants.priority.PRIORITY_BELOW_NORMAL;
      for (const pid of desired) {
        if (this.priorityLowered.has(pid)) continue;
        try {
          os.setPriority(pid, low);
          this.priorityLowered.add(pid);
        } catch {
          // Process vanished or access denied.
        }
      }
      for (const pid of [...this.priorityLowered]) {
        if (desired.has(pid)) continue;
        this.restorePriority(pid);
      }
      this.priorityState = "active";
    } catch {
      this.priorityState = "error";
    }
  }

  private restorePriority(pid: number): void {
    try {
      os.setPriority(pid, this.baselineNice);
    } catch {
      // Process already gone.
    }
    this.priorityLowered.delete(pid);
  }

  private restoreAllPriorities(): void {
    for (const pid of [...this.priorityLowered]) this.restorePriority(pid);
  }
}

/** All descendants of `root`, from the ppid field of /proc/<pid>/stat. */
function linuxDescendantPids(root: number): number[] {
  const children = new Map<number, number[]>();
  try {
    for (const entry of fsSync.readdirSync("/proc")) {
      if (!/^\d+$/.test(entry)) continue;
      const stat = readText(`/proc/${entry}/stat`);
      // "pid (comm) S ppid ..." - comm may contain spaces/parentheses, so anchor on the last ")".
      const fields = stat.slice(stat.lastIndexOf(")") + 2).split(" ");
      const ppid = Number(fields[1]);
      if (!Number.isInteger(ppid)) continue;
      const list = children.get(ppid) ?? [];
      list.push(Number(entry));
      children.set(ppid, list);
    }
  } catch {
    return [];
  }
  const result: number[] = [];
  const queue = [root];
  while (queue.length > 0) {
    for (const child of children.get(queue.pop() as number) ?? []) {
      result.push(child);
      queue.push(child);
    }
  }
  return result;
}

function safeGetPriority(): number {
  try {
    return os.getPriority();
  } catch {
    return 0;
  }
}

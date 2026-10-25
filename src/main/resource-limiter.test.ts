import assert from "node:assert/strict";
import test from "node:test";
import {
  clampRamLimitMb,
  clampThreads,
  defaultExperimentalSettings,
  mergeExperimentalSettings,
  normalizeExperimentalSettings,
} from "./experimental-settings.js";
import {
  buildPowerShellAffinityScript,
  buildSystemdRunArgs,
  canRestoreNiceness,
  cpuListFromStatus,
  cpuMask,
  estimateTabMemoryKb,
  HARD_LIMIT_ENV,
  parseCpuList,
  parseMaxNicePriority,
  selectTabsToSleep,
  shouldRelaunchUnderScope,
  sumMemoryKb,
  tasksetArgs,
  windowsAffinityMask,
} from "./resource-limiter.js";

const SYSTEM = { totalMemMb: 16384, maxThreads: 8 };

test("clampRamLimitMb snaps to 256 MB steps within [512 MB, total]", () => {
  assert.equal(clampRamLimitMb(100, 16384), 512);
  assert.equal(clampRamLimitMb(1000, 16384), 1024);
  assert.equal(clampRamLimitMb(99999, 16384), 16384);
  assert.equal(clampRamLimitMb(Number.NaN, 16384), 512);
  assert.equal(clampRamLimitMb(16000, 15900), 15900);
  assert.equal(clampRamLimitMb(1000, 256), 256);
});

test("clampThreads stays within 1..max", () => {
  assert.equal(clampThreads(0, 8), 1);
  assert.equal(clampThreads(99, 8), 8);
  assert.equal(clampThreads(3.4, 8), 3);
});

test("defaults: limiters off, RAM ~25% of system, half the threads", () => {
  const defaults = defaultExperimentalSettings(SYSTEM);
  assert.equal(defaults.ramLimiterEnabled, false);
  assert.equal(defaults.cpuLimiterEnabled, false);
  assert.equal(defaults.ramHardLimit, false);
  assert.equal(defaults.ramLimitMb, 4096);
  assert.equal(defaults.cpuThreads, 4);
});

test("merge/normalize ignore invalid fields and clamp numbers", () => {
  assert.deepEqual(normalizeExperimentalSettings("x", SYSTEM), defaultExperimentalSettings(SYSTEM));
  const merged = mergeExperimentalSettings(
    defaultExperimentalSettings(SYSTEM),
    { ramLimiterEnabled: true, ramLimitMb: 1_000_000, cpuThreads: -3, cpuLimiterEnabled: "yes", ramHardLimit: true },
    SYSTEM,
  );
  assert.equal(merged.ramLimiterEnabled, true);
  assert.equal(merged.ramLimitMb, 16384);
  assert.equal(merged.cpuThreads, 1);
  assert.equal(merged.cpuLimiterEnabled, false);
  assert.equal(merged.ramHardLimit, true);
});

test("selectTabsToSleep returns nothing while under the limit", () => {
  assert.deepEqual(selectTabsToSleep(900, 1000, [{ id: 1, memKb: 100, lastActiveAt: 1, pinned: false, audible: false }]), []);
});

test("selectTabsToSleep sleeps LRU first, pinned then audible last, stops below hysteresis target", () => {
  const tabs = [
    { id: 1, memKb: 100, lastActiveAt: 50, pinned: true, audible: false },
    { id: 2, memKb: 100, lastActiveAt: 40, pinned: false, audible: true },
    { id: 3, memKb: 100, lastActiveAt: 30, pinned: false, audible: false },
    { id: 4, memKb: 100, lastActiveAt: 10, pinned: false, audible: false },
    { id: 5, memKb: 100, lastActiveAt: 60, pinned: true, audible: true },
  ];
  assert.deepEqual(selectTabsToSleep(1100, 1000, tabs, 0.1), [4, 3]);
  assert.deepEqual(selectTabsToSleep(1450, 1000, tabs, 0.1), [4, 3, 1, 2, 5]);
  // Everything still over the limit: returns all candidates, never invents others.
  assert.deepEqual(selectTabsToSleep(9000, 1000, tabs), [4, 3, 1, 2, 5]);
});

test("selectTabsToSleep credits a default amount for tabs with unknown memory", () => {
  const picked = selectTabsToSleep(280 * 1024, 200 * 1024, [
    { id: 1, memKb: 0, lastActiveAt: 1, pinned: false, audible: false },
    { id: 2, memKb: 0, lastActiveAt: 2, pinned: false, audible: false },
  ]);
  assert.deepEqual(picked, [1]);
});

test("estimateTabMemoryKb splits shared processes", () => {
  const result = estimateTabMemoryKb(new Map([[1, 10], [2, 10], [3, 11], [4, null]]), new Map([[10, 200], [11, 90]]));
  assert.equal(result.get(1), 100);
  assert.equal(result.get(2), 100);
  assert.equal(result.get(3), 90);
  assert.equal(result.get(4), 0);
});

test("sumMemoryKb totals workingSetSize", () => {
  assert.equal(sumMemoryKb([{ memory: { workingSetSize: 10 } }, { memory: { workingSetSize: 5 } }, {}]), 15);
});

test("cpu list parsing and masks", () => {
  assert.deepEqual(parseCpuList("0-3,8,10-11"), [0, 1, 2, 3, 8, 10, 11]);
  assert.deepEqual(parseCpuList("garbage"), []);
  assert.deepEqual(cpuListFromStatus("Name:\tx\nCpus_allowed_list:\t2-3\nMems_allowed:\t1"), [2, 3]);
  assert.equal(cpuMask([0, 1, 2, 3], 2), 0b11n);
  assert.equal(cpuMask([2, 3, 8], 2), 0b1100n);
  assert.equal(cpuMask([0, 1], 0), 0b1n);
  assert.equal(windowsAffinityMask(Array.from({ length: 80 }, (_, i) => i), 80), (1n << 63n) - 1n);
});

test("command builders", () => {
  assert.deepEqual(tasksetArgs(0xffn, 42), ["-a", "-p", "ff", "42"]);
  assert.equal(
    buildPowerShellAffinityScript([10, 20, -1, 1.5], 3n),
    "Get-Process -Id 10,20 -ErrorAction SilentlyContinue | ForEach-Object { try { $_.ProcessorAffinity = [IntPtr][long]3 } catch {} }",
  );
  assert.equal(buildPowerShellAffinityScript([], 3n), "");
  assert.deepEqual(buildSystemdRunArgs(2048, ["/bin/app", "--x"]), [
    "--user", "--scope", "--quiet", "-p", "MemoryMax=2048M", "-p", "MemorySwapMax=0", "--", "/bin/app", "--x",
  ]);
});

test("nice priority detection", () => {
  const limits = "Limit  Soft Limit  Hard Limit  Units\nMax nice priority         0                    0\n";
  assert.equal(parseMaxNicePriority(limits), 0);
  assert.equal(parseMaxNicePriority("Max nice priority  unlimited  unlimited"), 40);
  assert.equal(parseMaxNicePriority(""), null);
  assert.equal(canRestoreNiceness(0, 0), false);
  assert.equal(canRestoreNiceness(20, 0), true);
  assert.equal(canRestoreNiceness(null, 0), false);
});

test("shouldRelaunchUnderScope guards against loops and other platforms", () => {
  const base = { platform: "linux", enabled: true, hard: true, env: {} as Record<string, string | undefined> };
  assert.equal(shouldRelaunchUnderScope(base), true);
  assert.equal(shouldRelaunchUnderScope({ ...base, env: { [HARD_LIMIT_ENV]: "2048" } }), false);
  assert.equal(shouldRelaunchUnderScope({ ...base, platform: "win32" }), false);
  assert.equal(shouldRelaunchUnderScope({ ...base, hard: false }), false);
  assert.equal(shouldRelaunchUnderScope({ ...base, enabled: false }), false);
});

test("local server detection is an experimental opt-in", () => {
  assert.equal(defaultExperimentalSettings(SYSTEM).detectLocalServers, false);
  const on = mergeExperimentalSettings(defaultExperimentalSettings(SYSTEM), { detectLocalServers: true }, SYSTEM);
  assert.equal(on.detectLocalServers, true);
  assert.equal(mergeExperimentalSettings(on, { detectLocalServers: "no" }, SYSTEM).detectLocalServers, true);
});

test("trustLocalhostCertificates: domyślnie wyłączone, scala tylko wartości logiczne", () => {
  assert.equal(defaultExperimentalSettings(SYSTEM).trustLocalhostCertificates, false);
  const on = mergeExperimentalSettings(defaultExperimentalSettings(SYSTEM), { trustLocalhostCertificates: true }, SYSTEM);
  assert.equal(on.trustLocalhostCertificates, true);
  assert.equal(mergeExperimentalSettings(on, { trustLocalhostCertificates: "no" }, SYSTEM).trustLocalhostCertificates, true);
});

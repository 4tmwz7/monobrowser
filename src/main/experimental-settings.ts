// Ustawienia eksperymentalne (ogranicznik RAM / CPU, wykrywanie lokalnych serwerów). Czysta logika bez zależności od Electrona.

export type ExperimentalSettings = {
  ramLimiterEnabled: boolean;
  ramLimitMb: number;
  /** Linux + systemd-run: przy następnym starcie uruchom aplikację w scope z MemoryMax. */
  ramHardLimit: boolean;
  cpuLimiterEnabled: boolean;
  cpuThreads: number;
  cpuLowerBackgroundPriority: boolean;
  /** Jednorazowe wykrywanie serwerów WWW na localhost przy starcie (localhost-scan.ts). */
  detectLocalServers: boolean;
  /** Akceptuj niezaufane certyfikaty TLS tylko dla hostów loopback (localhost, 127.x, [::1]). */
  trustLocalhostCertificates: boolean;
};

export type SystemInfo = {
  totalMemMb: number;
  maxThreads: number;
};

export const RAM_STEP_MB = 256;
export const RAM_MIN_MB = 512;

export const ramMinMb = (totalMemMb: number): number => Math.max(1, Math.min(RAM_MIN_MB, Math.floor(totalMemMb)));

/** Snaps to RAM_STEP_MB and clamps to [512 MB, total memory]. */
export const clampRamLimitMb = (value: number, totalMemMb: number): number => {
  const total = Math.max(1, Math.floor(totalMemMb));
  const min = ramMinMb(total);
  if (!Number.isFinite(value)) return min;
  const snapped = Math.round(value / RAM_STEP_MB) * RAM_STEP_MB;
  return Math.min(total, Math.max(min, snapped));
};

export const clampThreads = (value: number, maxThreads: number): number => {
  const max = Math.max(1, Math.floor(maxThreads));
  if (!Number.isFinite(value)) return max;
  return Math.min(max, Math.max(1, Math.round(value)));
};

export const defaultExperimentalSettings = (system: SystemInfo): ExperimentalSettings => ({
  ramLimiterEnabled: false,
  ramLimitMb: clampRamLimitMb(system.totalMemMb * 0.25, system.totalMemMb),
  ramHardLimit: false,
  cpuLimiterEnabled: false,
  cpuThreads: clampThreads(Math.floor(system.maxThreads / 2), system.maxThreads),
  cpuLowerBackgroundPriority: false,
  detectLocalServers: false,
  trustLocalhostCertificates: false,
});

/** Merges a (possibly partial, untrusted) patch over the current settings, ignoring invalid fields. */
export const mergeExperimentalSettings = (
  current: ExperimentalSettings,
  patch: unknown,
  system: SystemInfo,
): ExperimentalSettings => {
  const raw = typeof patch === "object" && patch !== null ? (patch as Record<string, unknown>) : {};
  const bool = (key: string, fallback: boolean): boolean => (typeof raw[key] === "boolean" ? (raw[key] as boolean) : fallback);
  const num = (key: string): number | null => (typeof raw[key] === "number" && Number.isFinite(raw[key]) ? (raw[key] as number) : null);
  const ram = num("ramLimitMb");
  const threads = num("cpuThreads");
  return {
    ramLimiterEnabled: bool("ramLimiterEnabled", current.ramLimiterEnabled),
    ramLimitMb: clampRamLimitMb(ram ?? current.ramLimitMb, system.totalMemMb),
    ramHardLimit: bool("ramHardLimit", current.ramHardLimit),
    cpuLimiterEnabled: bool("cpuLimiterEnabled", current.cpuLimiterEnabled),
    cpuThreads: clampThreads(threads ?? current.cpuThreads, system.maxThreads),
    cpuLowerBackgroundPriority: bool("cpuLowerBackgroundPriority", current.cpuLowerBackgroundPriority),
    detectLocalServers: bool("detectLocalServers", current.detectLocalServers),
    trustLocalhostCertificates: bool("trustLocalhostCertificates", current.trustLocalhostCertificates),
  };
};

export const normalizeExperimentalSettings = (value: unknown, system: SystemInfo): ExperimentalSettings =>
  mergeExperimentalSettings(defaultExperimentalSettings(system), value, system);

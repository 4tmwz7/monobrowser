// Aggregation of usage statistics over periods (today / last 7 days / last 30 days / total).
export type StatsCounters = { seconds: number; visits: number; blocked: number; downloads: number; searches: number };
export type StatsPeriod = "today" | "week" | "month" | "total";
export const STATS_PERIODS: StatsPeriod[] = ["today", "week", "month", "total"];

export const emptyCounters = (): StatsCounters => ({ seconds: 0, visits: 0, blocked: 0, downloads: 0, searches: 0 });

const pad = (value: number): string => String(value).padStart(2, "0");
export const dayKeyOf = (date: Date): string => `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;

const PERIOD_DAYS: Record<Exclude<StatsPeriod, "total">, number> = { today: 1, week: 7, month: 30 };

/**
 * Sums counters for a period. "total" returns the all-time totals (the per-day map is capped,
 * so it cannot be used for all-time sums); other periods sum the last N calendar days incl. today.
 */
export const aggregateStats = (
  totals: StatsCounters,
  days: Record<string, Partial<StatsCounters> | undefined>,
  period: StatsPeriod,
  now: Date = new Date(),
): StatsCounters => {
  if (period === "total") return { ...emptyCounters(), ...totals };
  const result = emptyCounters();
  for (let offset = 0; offset < PERIOD_DAYS[period]; offset += 1) {
    const day = days[dayKeyOf(new Date(now.getFullYear(), now.getMonth(), now.getDate() - offset))];
    if (!day) continue;
    for (const key of Object.keys(result) as (keyof StatsCounters)[]) {
      result[key] += Number(day[key]) || 0;
    }
  }
  return result;
};

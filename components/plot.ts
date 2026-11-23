import { downsampleSeries } from "@/lib/series";
import type { DerivedPoint } from "@/lib/types";

export function plot(points: DerivedPoint[], pick: (point: DerivedPoint) => number | null, limit = 2200): [number, number | null][] {
  return downsampleSeries(
    points.map((point) => ({ t: point.t, v: pick(point) })),
    limit,
  ).map((point) => [point.t, point.v]);
}

export function dailyAverage(points: DerivedPoint[]): DerivedPoint[] {
  const groups = new Map<number, DerivedPoint[]>();
  for (const point of points) {
    const day = Date.UTC(new Date(point.t).getUTCFullYear(), new Date(point.t).getUTCMonth(), new Date(point.t).getUTCDate());
    const list = groups.get(day);
    if (list) list.push(point);
    else groups.set(day, [point]);
  }
  return [...groups.entries()].sort((a, b) => a[0] - b[0]).map(([t, list]) => ({
    t,
    pBh: avg(list.map((p) => p.pBh)),
    tBh: avg(list.map((p) => p.tBh)),
    pWh: avg(list.map((p) => p.pWh)),
    tWh: avg(list.map((p) => p.tWh)),
    q: avg(list.map((p) => p.q)),
    pPerf: avg(list.map((p) => p.pPerf)),
    dpHydro: avg(list.map((p) => p.dpHydro)),
    pRes: avg(list.map((p) => p.pRes)),
    drawdown: avg(list.map((p) => p.drawdown)),
    pi: avg(list.map((p) => p.pi)),
  }));
}

function avg(values: (number | null)[]): number | null {
  const finite = values.filter((value): value is number => value != null && Number.isFinite(value));
  if (!finite.length) return null;
  return finite.reduce((sum, value) => sum + value, 0) / finite.length;
}

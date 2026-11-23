import type { Dataset, DerivedPoint, WellPassport } from "./types";
import { detectCampaigns, type Campaign } from "./gki";
import { detectBuildups, interpretBuildup, type BuildupResult } from "./kvd";
import { correctPressure, resolveDepths } from "./pressure";
import {
  cumulativeVolume,
  detectAnomalies,
  exponentialDecline,
  median,
  monthBuckets,
  pearson,
  reservoirAt,
  shutThreshold,
  type Anomaly,
  type MonthBucket,
} from "./series";

export interface HydroSummary {
  basis: "tvd" | "md";
  sensor: number;
  perf: number;
  dh: number;
  gradient: number;
  method: string;
  assumed: string[];
  dpLatest: number | null;
}

export interface FrictionSummary {
  totalDrop: number | null;
  hydrostatic: number | null;
  residual: number | null;
}

export interface WellAnalysis {
  well: WellPassport;
  derived: DerivedPoint[];
  hydro: HydroSummary | null;
  months: MonthBucket[];
  decline: { dPerYear: number; percent: number; r2: number } | null;
  buildups: BuildupResult[];
  campaigns: Campaign[];
  anomalies: Anomaly[];
  quality: { completeness: number; points: number; from: number | null; to: number | null };
  correlations: { qP: number | null; qT: number | null; pBhPwh: number | null };
  friction: FrictionSummary;
  latest: DerivedPoint | null;
  shutMax: number;
  cumulative: number;
  uptime: number;
}

export interface Analysis {
  wells: Record<string, WellAnalysis>;
  errors: { wellId: string; message: string }[];
}

export function deriveWell(dataset: Dataset, well: WellPassport): DerivedPoint[] {
  const points = dataset.series[well.id] ?? [];
  const reservoir = dataset.reservoir.filter((point) => point.wellId === well.id);
  const draft: DerivedPoint[] = points.map((point) => {
    const correction = point.pBh == null ? null : correctPressure(point.pBh, well, point.tBh);
    const pRes = reservoir.length ? reservoirAt(reservoir, point.t) : null;
    const pPerf = correction?.pPerf ?? null;
    const drawdown = pPerf != null && pRes != null ? pRes - pPerf : null;
    return {
      t: point.t,
      pBh: point.pBh,
      tBh: point.tBh,
      pWh: point.pWh,
      tWh: point.tWh,
      q: point.q,
      pPerf,
      dpHydro: correction?.dp ?? null,
      pRes,
      drawdown,
      pi: null,
    };
  });
  const shutMax = shutThreshold(draft);
  for (const point of draft) {
    if (point.q != null && point.q > shutMax && point.drawdown != null && point.drawdown > 0.2) {
      point.pi = point.q / point.drawdown;
    }
  }
  return draft;
}

export function analyzeDataset(dataset: Dataset): Analysis {
  const wells: Record<string, WellAnalysis> = {};
  const errors: Analysis["errors"] = [];
  for (const well of dataset.wells) {
    try {
      wells[well.id] = analyzeWell(dataset, well);
    } catch (error) {
      errors.push({ wellId: well.id, message: error instanceof Error ? error.message : "ошибка расчёта" });
    }
  }
  return { wells, errors };
}

export function analyzeWell(dataset: Dataset, well: WellPassport): WellAnalysis {
  const derived = deriveWell(dataset, well);
  const shutMax = shutThreshold(derived);
  const sample = derived.find((point) => point.pBh != null);
  const correction = sample?.pBh != null ? correctPressure(sample.pBh, well, sample.tBh) : null;
  const depths = resolveDepths(well);
  const hydro: HydroSummary | null =
    correction && depths
      ? {
          basis: depths.basis,
          sensor: depths.sensor,
          perf: depths.perf,
          dh: depths.perf - depths.sensor,
          gradient: correction.gradient,
          method: correction.method,
          assumed: correction.assumed,
          dpLatest: derived.reduce<number | null>((last, point) => (point.dpHydro != null ? point.dpHydro : last), null),
        }
      : null;

  const events = detectBuildups(well, derived);
  const buildups = events.map((event) => interpretBuildup(event, well, null));
  const campaigns = detectCampaigns(well, derived);
  const anomalies = detectAnomalies(derived, shutMax);
  const months = monthBuckets(derived, shutMax);
  const flowing = derived.filter((point) => point.q != null && point.q > shutMax);
  const qP = pair(flowing, (p) => p.q, (p) => p.pPerf ?? p.pBh);
  const qT = pair(flowing, (p) => p.q, (p) => p.tWh);
  const pBhPwh = pair(derived, (p) => p.pBh, (p) => p.pWh);

  const drops = flowing
    .map((point) => (point.pBh != null && point.pWh != null ? point.pBh - point.pWh : null))
    .filter((value): value is number => value != null);
  const sensorDepth = well.sensorTvd ?? well.sensorMd;
  const hydrostatic = correction && sensorDepth != null ? correction.gradient * sensorDepth : null;
  const totalDrop = drops.length ? median(drops) : null;

  let uptime = 0;
  if (derived.length > 1) {
    let flowHours = 0;
    let span = 0;
    for (let i = 1; i < derived.length; i += 1) {
      const dt = (derived[i].t - derived[i - 1].t) / 3_600_000;
      if (dt <= 0 || dt > 48) continue;
      span += dt;
      if ((derived[i - 1].q ?? 0) > shutMax) flowHours += dt;
    }
    uptime = span > 0 ? flowHours / span : 0;
  }

  return {
    well,
    derived,
    hydro,
    months,
    decline: exponentialDecline(months),
    buildups,
    campaigns,
    anomalies,
    quality: qualityOf(derived),
    correlations: { qP: qP, qT: qT, pBhPwh: pBhPwh },
    friction: {
      totalDrop,
      hydrostatic,
      residual: totalDrop != null && hydrostatic != null ? totalDrop - hydrostatic : null,
    },
    latest: [...derived].reverse().find((point) => point.q != null || point.pBh != null) ?? null,
    shutMax,
    cumulative: cumulativeVolume(derived),
    uptime,
  };
}

function pair(points: DerivedPoint[], x: (p: DerivedPoint) => number | null, y: (p: DerivedPoint) => number | null): number | null {
  const xs: number[] = [];
  const ys: number[] = [];
  for (const point of points) {
    const xv = x(point);
    const yv = y(point);
    if (xv == null || yv == null) continue;
    xs.push(xv);
    ys.push(yv);
  }
  return pearson(xs, ys);
}

function qualityOf(points: DerivedPoint[]): WellAnalysis["quality"] {
  if (!points.length) return { completeness: 0, points: 0, from: null, to: null };
  const dts: number[] = [];
  for (let i = 1; i < points.length; i += 1) {
    const dt = points[i].t - points[i - 1].t;
    if (dt > 0) dts.push(dt);
  }
  const span = points[points.length - 1].t - points[0].t;
  if (!dts.length || span <= 0) return { completeness: 1, points: points.length, from: points[0].t, to: points[points.length - 1].t };
  const sorted = [...dts].sort((a, b) => a - b);
  const med = sorted[Math.floor(sorted.length / 2)];
  let missing = 0;
  for (const dt of dts) if (dt > med * 3) missing += dt - med;
  return {
    completeness: Math.max(0, Math.min(1, 1 - missing / span)),
    points: points.length,
    from: points[0].t,
    to: points[points.length - 1].t,
  };
}

export function inRange(t: number, range: [number, number] | null): boolean {
  if (!range) return true;
  return t >= range[0] && t <= range[1];
}

export function sliceDerived(points: DerivedPoint[], range: [number, number] | null): DerivedPoint[] {
  if (!range) return points;
  return points.filter((point) => point.t >= range[0] && point.t <= range[1]);
}

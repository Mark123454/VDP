import type { DerivedPoint, ReservoirPoint } from "./types";

export const HOUR = 3_600_000;
export const DAY = 86_400_000;

export function percentile(values: number[], p: number): number {
  if (!values.length) return NaN;
  const sorted = [...values].sort((a, b) => a - b);
  const index = (sorted.length - 1) * p;
  const lo = Math.floor(index);
  const hi = Math.ceil(index);
  if (lo === hi) return sorted[lo];
  return sorted[lo] + (sorted[hi] - sorted[lo]) * (index - lo);
}

export function median(values: number[]): number {
  return percentile(values, 0.5);
}

export function mean(values: number[]): number {
  if (!values.length) return NaN;
  return values.reduce((sum, value) => sum + value, 0) / values.length;
}

export function stddev(values: number[]): number {
  if (values.length < 2) return 0;
  const avg = mean(values);
  const variance = values.reduce((sum, value) => sum + (value - avg) ** 2, 0) / (values.length - 1);
  return Math.sqrt(variance);
}

export function pearson(xs: number[], ys: number[]): number | null {
  const n = xs.length;
  if (n < 5 || ys.length !== n) return null;
  let sx = 0;
  let sy = 0;
  let sxx = 0;
  let syy = 0;
  let sxy = 0;
  for (let i = 0; i < n; i += 1) {
    sx += xs[i];
    sy += ys[i];
    sxx += xs[i] * xs[i];
    syy += ys[i] * ys[i];
    sxy += xs[i] * ys[i];
  }
  const det = Math.sqrt((n * sxx - sx * sx) * (n * syy - sy * sy));
  if (!(det > 0)) return null;
  return (n * sxy - sx * sy) / det;
}

export function linreg(xs: number[], ys: number[]): { a: number; b: number; r2: number } | null {
  const n = xs.length;
  if (n < 2 || ys.length !== n) return null;
  let sx = 0;
  let sy = 0;
  let sxx = 0;
  let sxy = 0;
  for (let i = 0; i < n; i += 1) {
    sx += xs[i];
    sy += ys[i];
    sxx += xs[i] * xs[i];
    sxy += xs[i] * ys[i];
  }
  const det = n * sxx - sx * sx;
  if (det === 0) return null;
  const b = (n * sxy - sx * sy) / det;
  const a = (sy - b * sx) / n;
  const yMean = sy / n;
  let ssTot = 0;
  let ssRes = 0;
  for (let i = 0; i < n; i += 1) {
    const fitted = a + b * xs[i];
    ssRes += (ys[i] - fitted) ** 2;
    ssTot += (ys[i] - yMean) ** 2;
  }
  const r2 = ssTot === 0 ? 1 : 1 - ssRes / ssTot;
  return { a, b, r2 };
}

export function reservoirAt(points: ReservoirPoint[], t: number): number | null {
  if (!points.length) return null;
  const sorted = [...points].sort((a, b) => a.t - b.t);
  if (t <= sorted[0].t) return sorted[0].pressure;
  const last = sorted[sorted.length - 1];
  if (t >= last.t) return last.pressure;
  for (let i = 1; i < sorted.length; i += 1) {
    if (t <= sorted[i].t) {
      const left = sorted[i - 1];
      const right = sorted[i];
      const span = right.t - left.t;
      if (span <= 0) return right.pressure;
      const f = (t - left.t) / span;
      return left.pressure + f * (right.pressure - left.pressure);
    }
  }
  return last.pressure;
}

export interface MonthBucket {
  t: number;
  label: string;
  qAvg: number | null;
  pPerfAvg: number | null;
  pBhAvg: number | null;
  pWhAvg: number | null;
  tBhAvg: number | null;
  piAvg: number | null;
  drawdownAvg: number | null;
  hoursFlow: number;
  hoursShut: number;
  volume: number;
}

export function monthBuckets(points: DerivedPoint[], shutMax: number): MonthBucket[] {
  const groups = new Map<string, DerivedPoint[]>();
  for (const point of points) {
    const d = new Date(point.t);
    const key = `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}`;
    const list = groups.get(key);
    if (list) list.push(point);
    else groups.set(key, [point]);
  }
  const keys = [...groups.keys()].sort();
  return keys.map((key) => {
    const list = groups.get(key)!;
    const flowing = list.filter((p) => p.q != null && p.q > shutMax);
    const avg = (vals: number[]) => (vals.length ? mean(vals) : null);
    let volume = 0;
    for (let i = 1; i < list.length; i += 1) {
      const dtDays = (list[i].t - list[i - 1].t) / DAY;
      if (dtDays <= 0 || dtDays > 2) continue;
      const q1 = list[i - 1].q;
      const q2 = list[i].q;
      if (q1 == null || q2 == null) continue;
      volume += ((q1 + q2) / 2) * dtDays;
    }
    const [year, month] = key.split("-").map(Number);
    return {
      t: Date.UTC(year, month - 1, 1),
      label: key,
      qAvg: avg(flowing.map((p) => p.q!)),
      pPerfAvg: avg(list.map((p) => p.pPerf).filter((v): v is number => v != null)),
      pBhAvg: avg(list.map((p) => p.pBh).filter((v): v is number => v != null)),
      pWhAvg: avg(list.map((p) => p.pWh).filter((v): v is number => v != null)),
      tBhAvg: avg(list.map((p) => p.tBh).filter((v): v is number => v != null)),
      piAvg: avg(flowing.map((p) => p.pi).filter((v): v is number => v != null && v > 0 && v < 1e5)),
      drawdownAvg: avg(flowing.map((p) => p.drawdown).filter((v): v is number => v != null && v > 0)),
      hoursFlow: flowing.length && list.length > 1 ? estimateHours(list, (p) => p.q != null && p.q > shutMax) : flowing.length ? 0 : 0,
      hoursShut: estimateHours(list, (p) => p.q != null && p.q <= shutMax),
      volume,
    };
  });
}

function estimateHours(points: DerivedPoint[], pred: (p: DerivedPoint) => boolean): number {
  let hours = 0;
  for (let i = 1; i < points.length; i += 1) {
    const dt = (points[i].t - points[i - 1].t) / HOUR;
    if (dt <= 0 || dt > 48) continue;
    if (pred(points[i - 1]) || pred(points[i])) hours += dt / (pred(points[i - 1]) && pred(points[i]) ? 1 : 2);
  }
  return hours;
}

export function exponentialDecline(months: MonthBucket[]): { dPerYear: number; percent: number; r2: number } | null {
  const rows = months.filter((m) => m.qAvg != null && m.qAvg > 0 && m.hoursFlow >= 24);
  if (rows.length < 4) return null;
  const t0 = rows[0].t;
  const xs = rows.map((m) => (m.t - t0) / (365.25 * DAY));
  const ys = rows.map((m) => Math.log(m.qAvg!));
  const fit = linreg(xs, ys);
  if (!fit || !(fit.b < 0)) return null;
  const dPerYear = -fit.b;
  return { dPerYear, percent: (1 - Math.exp(-dPerYear)) * 100, r2: fit.r2 };
}

export interface RunPoint {
  t: number;
  v: number;
}

/** Largest-triangle-three-buckets. Breaks are preserved by the caller. */
export function lttb(points: RunPoint[], threshold: number): RunPoint[] {
  if (threshold >= points.length || threshold < 3) return points;
  const sampled: RunPoint[] = [points[0]];
  const bucketSize = (points.length - 2) / (threshold - 2);
  let a = 0;
  for (let i = 0; i < threshold - 2; i += 1) {
    const avgStart = Math.floor((i + 1) * bucketSize) + 1;
    const avgEnd = Math.min(Math.floor((i + 2) * bucketSize) + 1, points.length);
    let avgT = 0;
    let avgV = 0;
    const span = Math.max(1, avgEnd - avgStart);
    for (let j = avgStart; j < avgEnd; j += 1) {
      avgT += points[j].t;
      avgV += points[j].v;
    }
    avgT /= span;
    avgV /= span;
    const rangeStart = Math.floor(i * bucketSize) + 1;
    const rangeEnd = Math.min(Math.floor((i + 1) * bucketSize) + 1, points.length - 1);
    let maxArea = -1;
    let nextA = rangeStart;
    const pointA = points[a];
    for (let j = rangeStart; j < rangeEnd; j += 1) {
      const area = Math.abs((pointA.t - avgT) * (points[j].v - pointA.v) - (pointA.t - points[j].t) * (avgV - pointA.v));
      if (area > maxArea) {
        maxArea = area;
        nextA = j;
      }
    }
    sampled.push(points[nextA]);
    a = nextA;
  }
  sampled.push(points[points.length - 1]);
  return sampled;
}

export function downsampleSeries(points: { t: number; v: number | null }[], threshold: number): { t: number; v: number | null }[] {
  if (points.length <= threshold) return points;
  const out: { t: number; v: number | null }[] = [];
  let run: RunPoint[] = [];
  const flush = () => {
    if (!run.length) return;
    const budget = Math.max(3, Math.round((threshold * run.length) / points.length));
    out.push(...lttb(run, Math.min(budget, run.length)));
    run = [];
  };
  for (const point of points) {
    if (point.v == null || !Number.isFinite(point.v)) {
      flush();
      out.push({ t: point.t, v: null });
    } else {
      run.push({ t: point.t, v: point.v });
    }
  }
  flush();
  return out;
}

export interface Anomaly {
  id: string;
  t: number;
  tEnd: number;
  kind: "spike" | "flatline" | "gap" | "inversion" | "above-reservoir" | "negative-rate" | "range";
  severity: "info" | "warning" | "critical";
  message: string;
}

export function detectAnomalies(points: DerivedPoint[], shutMax: number): Anomaly[] {
  const anomalies: Anomaly[] = [];
  if (points.length < 5) return anomalies;
  const dts: number[] = [];
  for (let i = 1; i < points.length; i += 1) {
    const dt = points[i].t - points[i - 1].t;
    if (dt > 0) dts.push(dt);
  }
  const medDt = median(dts);
  for (let i = 1; i < points.length; i += 1) {
    const dt = points[i].t - points[i - 1].t;
    if (dt > Math.max(36 * HOUR, 4 * medDt)) {
      anomalies.push({
        id: `gap-${points[i - 1].t}`,
        t: points[i - 1].t,
        tEnd: points[i].t,
        kind: "gap",
        severity: dt > 7 * DAY ? "warning" : "info",
        message: `Пропуск в ряде ${Math.round(dt / HOUR)} ч`,
      });
    }
  }

  flagSpikes(points, "pBh", "Рзаб", 0.35, anomalies);
  flagSpikes(points, "tBh", "Тзаб", 2.5, anomalies);
  flagSpikes(points, "pWh", "Руст", 0.35, anomalies);
  flagSpikes(points, "q", "дебит", Math.max(5, shutMax * 4), anomalies);
  flagFlat(points, "pBh", "Рзаб", anomalies);
  flagFlat(points, "tBh", "Тзаб", anomalies);

  pushRuns(points, anomalies, (p) => p.pBh != null && p.pWh != null && p.pWh > p.pBh + 0.25, "inversion", "warning", "Руст выше Рзаб — проверьте датчики или столбцы");
  pushRuns(
    points,
    anomalies,
    (p) => p.q != null && p.q > shutMax && p.pPerf != null && p.pRes != null && p.pPerf > p.pRes + 0.5,
    "above-reservoir",
    "warning",
    "Рвдп выше пластового на режиме — замер Рпл, градиент или датчик",
  );
  pushRuns(points, anomalies, (p) => p.q != null && p.q < -0.05, "negative-rate", "warning", "Отрицательный дебит");
  pushRuns(
    points,
    anomalies,
    (p) => (p.tBh != null && (p.tBh < -30 || p.tBh > 220)) || (p.pBh != null && (p.pBh < -0.05 || p.pBh > 150)),
    "range",
    "critical",
    "Значение вне физического диапазона",
  );
  return anomalies;
}

function valueAt(point: DerivedPoint, key: "pBh" | "tBh" | "pWh" | "q"): number | null {
  return point[key];
}

function flagSpikes(points: DerivedPoint[], key: "pBh" | "tBh" | "pWh" | "q", label: string, floor: number, out: Anomaly[]) {
  const window = 11;
  for (let i = 2; i < points.length - 2; i += 1) {
    const value = valueAt(points[i], key);
    if (value == null) continue;
    const around: number[] = [];
    for (let j = Math.max(0, i - window); j <= Math.min(points.length - 1, i + window); j += 1) {
      if (j === i) continue;
      const other = valueAt(points[j], key);
      if (other != null) around.push(other);
    }
    if (around.length < 6) continue;
    const med = median(around);
    const mad = median(around.map((v) => Math.abs(v - med))) || 0;
    const scale = Math.max(1.4826 * mad * 6, floor);
    if (Math.abs(value - med) < scale) continue;
    const left = valueAt(points[i - 1], key);
    const right = valueAt(points[i + 1], key);
    if (left == null || right == null) continue;
    if (Math.abs(left - med) > scale * 0.6 || Math.abs(right - med) > scale * 0.6) continue;
    out.push({
      id: `spike-${key}-${points[i].t}`,
      t: points[i].t,
      tEnd: points[i].t,
      kind: "spike",
      severity: "warning",
      message: `Выброс ${label}: ${value.toFixed(2)} при фоне ${med.toFixed(2)}`,
    });
  }
}

function flagFlat(points: DerivedPoint[], key: "pBh" | "tBh", label: string, out: Anomaly[]) {
  let start = 0;
  for (let i = 1; i <= points.length; i += 1) {
    const prev = valueAt(points[i - 1], key);
    const cur = i < points.length ? valueAt(points[i], key) : null;
    const same = cur != null && prev != null && Math.abs(cur - prev) <= 1e-9;
    if (same) continue;
    const run = i - start;
    const span = points[i - 1].t - points[start].t;
    if (run >= 12 && span >= 18 * HOUR && prev != null) {
      out.push({
        id: `flat-${key}-${points[start].t}`,
        t: points[start].t,
        tEnd: points[i - 1].t,
        kind: "flatline",
        severity: "critical",
        message: `${label} застыло на ${prev.toFixed(3)} на ${Math.round(span / HOUR)} ч — похоже на отказ датчика`,
      });
    }
    start = i;
  }
}

function pushRuns(
  points: DerivedPoint[],
  out: Anomaly[],
  pred: (p: DerivedPoint) => boolean,
  kind: Anomaly["kind"],
  severity: Anomaly["severity"],
  message: string,
) {
  let start = -1;
  for (let i = 0; i <= points.length; i += 1) {
    const hit = i < points.length && pred(points[i]);
    if (hit && start < 0) start = i;
    if (!hit && start >= 0) {
      out.push({
        id: `${kind}-${points[start].t}`,
        t: points[start].t,
        tEnd: points[i - 1].t,
        kind,
        severity,
        message,
      });
      start = -1;
    }
  }
}

export function cumulativeVolume(points: DerivedPoint[]): number {
  let volume = 0;
  for (let i = 1; i < points.length; i += 1) {
    const dtDays = (points[i].t - points[i - 1].t) / DAY;
    if (dtDays <= 0 || dtDays > 2) continue;
    const q1 = points[i - 1].q;
    const q2 = points[i].q;
    if (q1 == null || q2 == null) continue;
    volume += ((q1 + q2) / 2) * dtDays;
  }
  return volume;
}

export function shutThreshold(points: DerivedPoint[]): number {
  const flowing = points.map((p) => p.q).filter((q): q is number => q != null && q > 0);
  if (!flowing.length) return 0.5;
  return Math.max(0.3, 0.02 * percentile(flowing, 0.9));
}

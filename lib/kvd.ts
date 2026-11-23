import type { DerivedPoint, FluidKind, WellPassport } from "./types";
import { gasPermeabilityMd, oilPermeabilityMd, porosityFraction, radiusOfInvestigationM, skinFromHorner } from "./formulas";
import { HOUR, linreg, median, percentile } from "./series";

export interface BuildupSample {
  dtHours: number;
  p: number;
}

export interface HistorySample {
  t: number;
  p: number | null;
  q: number | null;
}

export interface BuildupEvent {
  id: string;
  wellId: string;
  start: number;
  end: number;
  pwf: number;
  qBefore: number;
  tpHours: number;
  datum: "vdp" | "sensor";
  samples: BuildupSample[];
  history: HistorySample[];
}

export interface LogPoint {
  dt: number;
  dp: number;
  der: number | null;
}

export interface HornerPoint {
  x: number;
  y: number;
  dt: number;
  inWindow: boolean;
}

export type Confidence = "высокая" | "средняя" | "низкая";

export interface BuildupResult {
  event: BuildupEvent;
  fluid: FluidKind;
  window: { dtMin: number; dtMax: number; auto: boolean };
  slope: number | null;
  slopeUnit: string;
  pStar: number | null;
  p1hr: number | null;
  r2: number | null;
  permeability: number | null;
  skin: number | null;
  radius: number | null;
  confidence: Confidence;
  notes: string[];
  horner: HornerPoint[];
  loglog: LogPoint[];
}

export function detectBuildups(well: WellPassport, points: DerivedPoint[]): BuildupEvent[] {
  if (points.length < 12) return [];
  const positive = points.map((p) => p.q).filter((q): q is number => q != null && q > 0);
  const shutMax = positive.length ? Math.max(0.3, 0.02 * percentile(positive, 0.9)) : 0.5;
  const events: BuildupEvent[] = [];
  let i = 0;
  while (i < points.length) {
    if (!isShut(points[i], shutMax)) {
      i += 1;
      continue;
    }
    let j = i;
    while (j < points.length && isShut(points[j], shutMax)) {
      if (j > i && points[j].t - points[j - 1].t > 12 * HOUR) break;
      j += 1;
    }
    const segment = points.slice(i, j);
    const duration = segment[segment.length - 1].t - segment[0].t;
    if (duration >= 8 * HOUR && segment.length >= 6 && pressureRose(segment)) {
      const event = toEvent(well, points, i, j, shutMax);
      if (event) events.push(event);
    }
    i = Math.max(j, i + 1);
  }
  return events;
}

function isShut(point: DerivedPoint, shutMax: number): boolean {
  return point.q != null && point.q <= shutMax;
}

function pressureOf(point: DerivedPoint): number | null {
  return point.pPerf ?? point.pBh;
}

function pressureRose(segment: DerivedPoint[]): boolean {
  const pressures = segment.map(pressureOf).filter((p): p is number => p != null);
  if (pressures.length < 4) return false;
  const head = pressures.slice(0, Math.max(1, Math.floor(pressures.length / 3)));
  const tail = pressures.slice(Math.floor((pressures.length * 2) / 3));
  return median(tail) > median(head) + 0.05;
}

function toEvent(well: WellPassport, points: DerivedPoint[], from: number, to: number, shutMax: number): BuildupEvent | null {
  const tShut = points[from].t;
  const before: DerivedPoint[] = [];
  for (let k = from - 1; k >= 0; k -= 1) {
    const point = points[k];
    if (!point || points[from - 1].t - point.t > 18 * HOUR) break;
    if (point.q != null && point.q > shutMax) before.push(point);
  }
  before.reverse();
  const rates = before.map((p) => p.q!).filter((q) => q > shutMax);
  const qBefore = rates.length ? median(rates) : 0;
  if (!(qBefore > 0)) return null;
  const pwfPoint = before.length ? before[before.length - 1] : null;
  const pwf = pwfPoint ? pressureOf(pwfPoint) : null;
  if (pwf == null) return null;

  let volume = 0;
  const prevEnd = findPreviousFlowStart(points, from, shutMax);
  for (let k = prevEnd + 1; k < from; k += 1) {
    const dtDays = (points[k].t - points[k - 1].t) / 86_400_000;
    if (dtDays <= 0 || dtDays > 2) continue;
    const q1 = points[k - 1].q;
    const q2 = points[k].q;
    if (q1 == null || q2 == null) continue;
    if (q1 <= shutMax && q2 <= shutMax) continue;
    volume += ((Math.max(q1, 0) + Math.max(q2, 0)) / 2) * dtDays;
  }
  const tpHours = Math.min(Math.max((volume / qBefore) * 24, 1), 24 * 365 * 8);

  const samples: BuildupSample[] = [];
  for (let k = from; k < to; k += 1) {
    const p = pressureOf(points[k]);
    const dtHours = (points[k].t - tShut) / HOUR;
    if (p == null || dtHours <= 0.02) continue;
    samples.push({ dtHours, p });
  }
  if (samples.length < 6) return null;
  const history: HistorySample[] = [];
  for (let k = 0; k < points.length; k += 1) {
    if (points[k].t < tShut - 36 * HOUR) continue;
    if (points[k].t > points[to - 1].t) break;
    history.push({ t: points[k].t, p: pressureOf(points[k]), q: points[k].q });
  }
  return {
    id: `${well.id}-${tShut}`,
    wellId: well.id,
    start: tShut,
    end: points[to - 1].t,
    pwf,
    qBefore,
    tpHours,
    datum: points.some((p) => p.pPerf != null) ? "vdp" : "sensor",
    samples,
    history,
  };
}

function findPreviousFlowStart(points: DerivedPoint[], from: number, shutMax: number): number {
  let k = from - 1;
  while (k > 0) {
    const current = points[k]?.q;
    const previous = points[k - 1]?.q;
    if (current != null && current <= shutMax && previous != null && previous <= shutMax) break;
    k -= 1;
  }
  return Math.max(0, k);
}

export function interpretBuildup(event: BuildupEvent, well: WellPassport, override?: { dtMin: number; dtMax: number } | null): BuildupResult {
  const fluid = well.fluid;
  const useP2 = fluid === "gas";
  const notes: string[] = [];
  const auto = pickRadialWindow(event.samples, event.pwf, useP2);
  const window = override && override.dtMax > override.dtMin ? { ...override, auto: false } : auto ?? fallbackWindow(event.samples);
  if (!auto && !override) notes.push("Радиальное окно не выделилось, взята середина КВД.");
  const inside = event.samples.filter((s) => s.dtHours >= window.dtMin && s.dtHours <= window.dtMax);
  const xs = inside.map((s) => Math.log10((event.tpHours + s.dtHours) / s.dtHours));
  const ys = inside.map((s) => (useP2 ? s.p * s.p : s.p));
  const fit = xs.length >= 4 ? linreg(xs, ys) : null;
  let slope: number | null = null;
  let pStar: number | null = null;
  let r2: number | null = null;
  let p1hr: number | null = null;
  if (fit && fit.b < 0) {
    slope = -fit.b;
    r2 = fit.r2;
    if (useP2) {
      pStar = fit.a > 0 ? Math.sqrt(fit.a) : null;
      const y1 = fit.a + fit.b * Math.log10(event.tpHours + 1);
      p1hr = y1 > 0 ? Math.sqrt(y1) : null;
    } else {
      pStar = fit.a;
      p1hr = fit.a + fit.b * Math.log10(event.tpHours + 1);
    }
  } else if (fit) {
    notes.push("Наклон прямой Хорнера не того знака: окно, скорее всего, не радиальный приток.");
    r2 = fit.r2;
  } else {
    notes.push("В выбранном окне меньше четырёх точек.");
  }

  const props = resolvedProps(well, event, notes);
  let permeability: number | null = null;
  let skin: number | null = null;
  let radius: number | null = null;
  if (slope != null && props) {
    if (useP2) {
      permeability = gasPermeabilityMd(event.qBefore, props.tempK, props.viscosity, props.z, slope, props.netPay);
    } else {
      permeability = oilPermeabilityMd(event.qBefore, props.volumeFactor, props.viscosity, slope, props.netPay);
    }
    if (permeability != null && p1hr != null) {
      const p1 = useP2 ? p1hr * p1hr : p1hr;
      const pwf = useP2 ? event.pwf * event.pwf : event.pwf;
      skin = skinFromHorner({
        p1hr: p1,
        pwf,
        slope,
        permeabilityMd: permeability,
        porosity: props.porosity,
        viscosity: props.viscosity,
        compressibilityPerMpa: props.compressibility,
        wellRadiusM: props.wellRadius,
      });
    }
    radius = permeability == null ? null : radiusOfInvestigationM(permeability, window.dtMax, props.porosity, props.viscosity, props.compressibility);
  } else if (slope != null && !props) {
    notes.push("Для проницаемости и скина нужна толщина пласта в паспорте.");
  }

  const decades = Math.log10(window.dtMax / Math.max(window.dtMin, 1e-3));
  let confidence: Confidence = "низкая";
  if (slope != null && r2 != null && r2 >= 0.97 && inside.length >= 8 && decades >= 0.4) confidence = "высокая";
  else if (slope != null && r2 != null && r2 >= 0.9) confidence = "средняя";
  if (props && notes.some((n) => n.startsWith("Принято"))) {
    if (confidence === "высокая") confidence = "средняя";
  }

  const horner: HornerPoint[] = event.samples.map((s) => ({
    x: Math.log10((event.tpHours + s.dtHours) / s.dtHours),
    y: useP2 ? s.p * s.p : s.p,
    dt: s.dtHours,
    inWindow: s.dtHours >= window.dtMin && s.dtHours <= window.dtMax,
  }));

  return {
    event,
    fluid,
    window: { ...window, auto: !override },
    slope,
    slopeUnit: useP2 ? "МПа²/цикл" : "МПа/цикл",
    pStar,
    p1hr,
    r2,
    permeability,
    skin,
    radius,
    confidence,
    notes,
    horner,
    loglog: buildLogLog(event.samples, event.pwf, useP2),
  };
}

function fallbackWindow(samples: BuildupSample[]): { dtMin: number; dtMax: number } {
  const dts = samples.map((s) => s.dtHours).sort((a, b) => a - b);
  const min = dts[Math.floor(dts.length * 0.25)] ?? dts[0];
  const max = dts[Math.floor(dts.length * 0.9)] ?? dts[dts.length - 1];
  return { dtMin: min, dtMax: Math.max(max, min * 1.2) };
}

interface ResolvedProps {
  netPay: number;
  porosity: number;
  viscosity: number;
  volumeFactor: number;
  compressibility: number;
  wellRadius: number;
  tempK: number;
  z: number;
}

function resolvedProps(well: WellPassport, event: BuildupEvent, notes: string[]): ResolvedProps | null {
  if (well.netPay == null || !(well.netPay > 0)) return null;
  const assumed: string[] = [];
  const porosity = porosityFraction(well.porosity) ?? (well.fluid === "gas" ? 0.12 : 0.15);
  if (well.porosity == null) assumed.push(`пористость ${porosity}`);
  const viscosity = well.viscosity ?? (well.fluid === "gas" ? 0.02 : well.fluid === "water" ? 0.6 : 1);
  if (well.viscosity == null) assumed.push(`вязкость ${viscosity} мПа·с`);
  const volumeFactor = well.volumeFactor ?? (well.fluid === "water" ? 1 : 1.15);
  if (well.fluid !== "gas" && well.volumeFactor == null) assumed.push(`объёмный коэффициент ${volumeFactor}`);
  const pAvg = Math.max(event.pwf, 0.5);
  const compressibility = well.compressibility ?? (well.fluid === "gas" ? 1 / pAvg : 2e-3);
  if (well.compressibility == null) assumed.push(well.fluid === "gas" ? "сжимаемость газа ≈ 1/P" : `сжимаемость ${compressibility} 1/МПа`);
  const wellRadius = well.wellRadius ?? 0.1;
  if (well.wellRadius == null) assumed.push("радиус скважины 0,10 м");
  const tempC = well.reservoirTempC ?? 80;
  if (well.fluid === "gas" && well.reservoirTempC == null) assumed.push("Тпл 80 °C");
  const z = well.zFactor ?? 0.9;
  if (well.fluid === "gas" && well.zFactor == null) assumed.push("z = 0,90");
  if (assumed.length) notes.push(`Принято по умолчанию: ${assumed.join(", ")}.`);
  return {
    netPay: well.netPay,
    porosity,
    viscosity,
    volumeFactor,
    compressibility,
    wellRadius,
    tempK: tempC + 273.15,
    z,
  };
}

export function bourdet(dts: number[], values: number[], spacing = 0.2): (number | null)[] {
  const n = dts.length;
  const ln = dts.map((t) => Math.log(Math.max(t, 1e-9)));
  const der: (number | null)[] = Array(n).fill(null);
  for (let i = 0; i < n; i += 1) {
    let left = i - 1;
    while (left > 0 && ln[i] - ln[left] < spacing) left -= 1;
    let right = i + 1;
    while (right < n - 1 && ln[right] - ln[i] < spacing) right += 1;
    if (left < 0 || right >= n || left === i || right === i) continue;
    const dL = ln[i] - ln[left];
    const dR = ln[right] - ln[i];
    if (dL <= 0 || dR <= 0) continue;
    der[i] = ((values[i] - values[left]) / dL) * dR + ((values[right] - values[i]) / dR) * dL;
    der[i] = (der[i] as number) / (dL + dR);
  }
  return der;
}

function buildLogLog(samples: BuildupSample[], pwf: number, useP2: boolean): LogPoint[] {
  const ordered = [...samples].sort((a, b) => a.dtHours - b.dtHours);
  const dts = ordered.map((s) => s.dtHours);
  const dp = ordered.map((s) => {
    if (useP2) return s.p * s.p - pwf * pwf;
    return s.p - pwf;
  });
  const der = bourdet(dts, dp, 0.18);
  return ordered.map((s, i) => ({
    dt: s.dtHours,
    dp: dp[i],
    der: der[i] != null && der[i]! > 0 ? der[i] : null,
  }));
}

function pickRadialWindow(samples: BuildupSample[], pwf: number, useP2: boolean): { dtMin: number; dtMax: number } | null {
  const ordered = [...samples].sort((a, b) => a.dtHours - b.dtHours).filter((s) => s.dtHours >= 0.15);
  if (ordered.length < 8) return null;
  const dts = ordered.map((s) => s.dtHours);
  const y = ordered.map((s) => (useP2 ? s.p * s.p - pwf * pwf : s.p - pwf));
  const der = bourdet(dts, y, 0.22);
  const usable: { dt: number; der: number }[] = [];
  for (let i = 0; i < der.length; i += 1) {
    if (der[i] != null && der[i]! > 0) usable.push({ dt: dts[i], der: der[i]! });
  }
  if (usable.length < 6) return null;
  let best: { score: number; i: number; j: number } | null = null;
  for (let i = 0; i < usable.length; i += 1) {
    for (let j = i + 4; j < usable.length; j += 1) {
      const span = Math.log10(usable[j].dt / usable[i].dt);
      if (span < 0.45 || span > 1.4) continue;
      const slice = usable.slice(i, j + 1).map((p) => p.der);
      const med = median(slice);
      if (!(med > 0)) continue;
      const mad = median(slice.map((v) => Math.abs(v - med)));
      const score = (1.4826 * mad) / med + 0.015 / Math.log10(usable[i].dt + 1.2);
      if (!best || score < best.score) best = { score, i, j };
    }
  }
  if (!best || best.score > 0.45) return null;
  const med = median(usable.slice(best.i, best.j + 1).map((p) => p.der));
  let i = best.i;
  let j = best.j;
  while (i > 0 && Math.abs(usable[i - 1].der - med) / med < 0.22) i -= 1;
  while (j < usable.length - 1 && Math.abs(usable[j + 1].der - med) / med < 0.22) j += 1;
  return { dtMin: usable[i].dt, dtMax: usable[j].dt };
}

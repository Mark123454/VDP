import type { Dataset, JournalGki, JournalKvd, ReservoirPoint, TelemetryPoint, WellPassport } from "./types";
import { GAS_K_FACTOR, OIL_K_FACTOR } from "./formulas";
import { sensorFromPerf } from "./pressure";

const HOUR = 3_600_000;
const START = Date.UTC(2023, 0, 1);
const END = Date.UTC(2026, 10, 20);

interface Shut {
  start: number;
  hours: number;
}

interface Spec {
  passport: WellPassport;
  reservoir: { t: number; p: number; note: string }[];
  q0: number;
  decline: number;
  j0: number;
  jDecline: number;
  k: number;
  tau: number;
  stim: number | null;
  gas: { a: number; b: number } | null;
  whBase: number;
  whSlope: number;
  friction: number;
  stuck: [number, number] | null;
  spike: number | null;
  gap: [number, number] | null;
  extraShuts: Shut[];
  journalKvd: JournalKvd[];
  journalGki: JournalGki[];
  seed: number;
}

function mulberry32(seed: number) {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function gauss(rng: () => number) {
  const u = Math.max(rng(), 1e-9);
  const v = rng();
  return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v);
}

function utc(y: number, m: number, d: number, h = 0) {
  return Date.UTC(y, m, d, h);
}

function yearly(month: number, day: number, hour: number): number[] {
  return [2023, 2024, 2025, 2026].map((year) => utc(year, month, day, hour));
}

const SHUT_STARTS = yearly(2, 15, 6);
const GKI_STARTS = yearly(8, 10, 0);

function inRange(t: number, start: number, hours: number) {
  return t >= start && t < start + hours * HOUR;
}

function shutAt(t: number, extra: Shut[]): Shut | null {
  for (const start of SHUT_STARTS) {
    if (inRange(t, start, 64)) return { start, hours: 64 };
  }
  for (const shut of extra) {
    if (inRange(t, shut.start, shut.hours)) return shut;
  }
  return null;
}

function gkiFactor(t: number): number | null {
  for (const start of GKI_STARTS) {
    const dt = (t - start) / HOUR;
    if (dt < 0 || dt >= 52) continue;
    if (dt < 10) return 0.42;
    if (dt < 22) return 0.7;
    if (dt < 36) return 1;
    return 1.4;
  }
  return null;
}

function isDense(t: number, extra: Shut[]): boolean {
  if (shutAt(t, extra)) return true;
  for (const start of SHUT_STARTS) {
    if (t >= start - 14 * HOUR && t < start + 68 * HOUR) return true;
  }
  for (const shut of extra) {
    if (t >= shut.start - 14 * HOUR && t < shut.start + (shut.hours + 4) * HOUR) return true;
  }
  for (const start of GKI_STARTS) {
    if (t >= start - 2 * HOUR && t < start + 54 * HOUR) return true;
  }
  return false;
}

function nextStop(t: number, next: number, extra: Shut[]): number | null {
  const marks = [
    ...SHUT_STARTS,
    ...SHUT_STARTS.map((start) => start - 14 * HOUR),
    ...extra.flatMap((shut) => [shut.start, shut.start - 14 * HOUR]),
    ...GKI_STARTS,
    ...GKI_STARTS.map((start) => start - 2 * HOUR),
  ];
  let hit: number | null = null;
  for (const mark of marks) {
    if (mark > t && mark < next && (hit == null || mark < hit)) hit = mark;
  }
  return hit;
}

function reservoirValue(spec: Spec, t: number): number {
  const pts = spec.reservoir;
  if (t <= pts[0].t) return pts[0].p;
  if (t >= pts[pts.length - 1].t) return pts[pts.length - 1].p;
  for (let i = 1; i < pts.length; i += 1) {
    if (t <= pts[i].t) {
      const f = (t - pts[i - 1].t) / (pts[i].t - pts[i - 1].t);
      return pts[i - 1].p + f * (pts[i].p - pts[i - 1].p);
    }
  }
  return pts[pts.length - 1].p;
}

function buildWell(spec: Spec): TelemetryPoint[] {
  const rng = mulberry32(spec.seed);
  const points: TelemetryPoint[] = [];
  let t = START;
  let cum = 0;
  let lastQ = spec.q0;
  let frozen: { p: number; temp: number } | null = null;
  const pushed = new Set<number>();

  const emit = (time: number, earlyShut = false) => {
    const stamp = Math.round(time);
    if (pushed.has(stamp)) return;
    if (spec.gap && stamp >= spec.gap[0] && stamp < spec.gap[1]) return;
    pushed.add(stamp);
    const years = (stamp - START) / (365.25 * 24 * HOUR);
    const pr = reservoirValue(spec, stamp);
    const seasonal = 1 + 0.02 * Math.sin(2 * Math.PI * years);
    let qBase = spec.q0 * Math.exp(-spec.decline * years) * seasonal;
    const factor = gkiFactor(stamp);
    if (factor != null) qBase *= factor;
    let j = spec.j0 * Math.exp(-spec.jDecline * years);
    if (spec.stim && stamp >= spec.stim) j *= 1.6;
    const shut = shutAt(stamp, spec.extraShuts);
    let q = qBase;
    let pPerf = spec.gas
      ? Math.sqrt(Math.max(pr * pr - spec.gas.a * q - spec.gas.b * q * q, 0.49))
      : pr - q / j;

    if (shut && stamp >= shut.start) {
      q = 0;
      const dt = (stamp - shut.start) / HOUR;
      const qBefore = lastQ > 1 ? lastQ : qBase;
      const tp = Math.min(Math.max((cum / qBefore) * 24, 24), 24 * 365 * 6);
      const pwf = spec.gas
        ? Math.sqrt(Math.max(pr * pr - spec.gas.a * qBefore - spec.gas.b * qBefore * qBefore, 0.49))
        : pr - qBefore / j;
      const tempK = (spec.passport.reservoirTempC ?? 80) + 273.15;
      const m = spec.gas
        ? (GAS_K_FACTOR * qBefore * tempK * (spec.passport.viscosity ?? 0.02) * (spec.passport.zFactor ?? 0.9)) /
          (spec.k * (spec.passport.netPay ?? 10))
        : (OIL_K_FACTOR * qBefore * (spec.passport.volumeFactor ?? 1.15) * (spec.passport.viscosity ?? 1)) /
          (spec.k * (spec.passport.netPay ?? 10));
      const approach = 1 - Math.exp(-Math.max(dt, 0.02) / spec.tau);
      if (spec.gas) {
        const p2 = pr * pr - m * Math.log10((tp + Math.max(dt, 0.05)) / Math.max(dt, 0.05));
        const radial = p2 > 0.36 ? Math.sqrt(p2) : pwf;
        pPerf = pwf + (radial - pwf) * approach;
      } else {
        const radial = pr - m * Math.log10((tp + Math.max(dt, 0.05)) / Math.max(dt, 0.05));
        pPerf = pwf + (Math.max(radial, pwf) - pwf) * approach;
      }
    } else {
      lastQ = q;
      if (points.length) {
        const prev = points[points.length - 1].t;
        const dtDays = (stamp - prev) / 86_400_000;
        if (dtDays > 0 && dtDays < 2) cum += ((q + lastQ) / 2) * dtDays;
      }
    }

    const noiseP = shut ? 0.006 : 0.018;
    pPerf += gauss(rng) * noiseP;
    if (!shut) q = Math.max(0, q * (1 + gauss(rng) * 0.012));
    const tempC = spec.passport.reservoirTempC ?? 80;
    const pSensor = sensorFromPerf(pPerf, spec.passport, tempC) ?? pPerf;
    let pBh = pSensor + gauss(rng) * noiseP * 0.4;
    const draw = Math.max(pr - pPerf, 0);
    let tBh = tempC - (spec.gas ? 0.7 : 0.12) * draw + gauss(rng) * 0.06;
    let pWh: number;
    if (spec.gas) {
      const sensor = spec.passport.sensorTvd ?? spec.passport.sensorMd ?? 1800;
      const column = 0.00055 * sensor + spec.friction * (q / spec.q0) ** 2;
      pWh = Math.max(0.3, pBh - column + gauss(rng) * 0.02);
    } else if (shut) {
      pWh = 0.62 + gauss(rng) * 0.02;
    } else {
      pWh = spec.whBase + spec.whSlope * (q / spec.q0) + gauss(rng) * 0.03;
    }
    const heat = Math.min(1.1, q / spec.q0);
    const seasonT = 9 * Math.sin(2 * Math.PI * (years - 0.08));
    const tWh = 9 + seasonT + (tBh - 9) * (0.2 + 0.38 * heat) + gauss(rng) * 0.15;

    if (spec.stuck && stamp >= spec.stuck[0] && stamp < spec.stuck[1]) {
      if (!frozen) frozen = { p: pBh, temp: tBh };
      pBh = frozen.p;
      tBh = frozen.temp;
    } else {
      frozen = null;
    }
    if (spec.spike && Math.abs(stamp - spec.spike) < 3 * HOUR) pBh += 2.6;

    points.push({
      t: stamp,
      pBh,
      tBh,
      pWh: Math.max(0.15, pWh),
      tWh,
      q,
    });
    if (earlyShut) return;
    if (shut && stamp === shut.start) {
      for (const dt of [0.08, 0.16, 0.35, 0.6]) emit(shut.start + dt * HOUR, true);
    }
  };

  while (t <= END) {
    emit(t);
    const step = isDense(t, spec.extraShuts) ? HOUR : 6 * HOUR;
    let next = t + step;
    const boundary = nextStop(t, next, spec.extraShuts);
    if (boundary) next = boundary;
    t = next;
  }
  return points.sort((a, b) => a.t - b.t);
}

function oilPassport(partial: WellPassport): WellPassport {
  return partial;
}

export function buildSample(): Dataset {
  const specs = [well124(), well217(), well305(), well418()];
  const series: Dataset["series"] = {};
  const reservoir: ReservoirPoint[] = [];
  const journalKvd: JournalKvd[] = [];
  const journalGki: JournalGki[] = [];
  for (const spec of specs) {
    series[spec.passport.id] = buildWell(spec);
    for (const point of spec.reservoir) {
      reservoir.push({ wellId: spec.passport.id, t: point.t, pressure: point.p, note: point.note });
    }
    journalKvd.push(...spec.journalKvd);
    journalGki.push(...spec.journalGki);
  }
  return {
    version: 1,
    sourceName: "Учебное месторождение",
    isSample: true,
    sourceUnits: { pressure: "MPa", rate: "m3d" },
    wells: specs.map((spec) => spec.passport),
    series,
    reservoir,
    journalKvd,
    journalGki,
  };
}

function well124(): Spec {
  const id = "124";
  return {
    passport: oilPassport({
      id,
      fluid: "oil",
      sensorMd: 2510,
      sensorTvd: 2462,
      perfTopMd: 2744,
      perfTopTvd: 2688,
      perfBottomMd: 2786,
      perfBottomTvd: 2726,
      density: 785,
      gradient: null,
      gasGravity: null,
      netPay: 9.2,
      porosity: 0.16,
      viscosity: 1.35,
      volumeFactor: 1.16,
      compressibility: 1.6e-3,
      wellRadius: 0.108,
      reservoirTempC: 84,
      zFactor: null,
    }),
    reservoir: [
      { t: utc(2023, 1, 10), p: 19.2, note: "замер глубинным манометром" },
      { t: utc(2024, 1, 12), p: 18.4, note: "замер глубинным манометром" },
      { t: utc(2025, 1, 8), p: 17.7, note: "замер глубинным манометром" },
      { t: utc(2026, 1, 6), p: 17.1, note: "замер глубинным манометром" },
    ],
    q0: 92,
    decline: 0.1,
    j0: 22,
    jDecline: 0.05,
    k: 65,
    tau: 0.55,
    stim: null,
    gas: null,
    whBase: 1.35,
    whSlope: 0.85,
    friction: 0,
    stuck: null,
    spike: null,
    gap: [utc(2025, 1, 2), utc(2025, 1, 5)],
    extraShuts: [],
    journalKvd: [2023, 2024, 2025, 2026].map((year, index) => ({
      wellId: id,
      t: utc(year, 2, 16),
      permeability: [64, 67, 62, 58][index],
      skin: [0.4, -0.2, 0.1, -0.6][index],
      pStar: [19.2, 18.4, 17.6, 17.3][index],
      note: "годовая КВД, отчёт промысла",
    })),
    journalGki: [2023, 2024, 2025, 2026].map((year, index) => ({
      wellId: id,
      t: utc(year, 8, 11),
      productivity: [21.6, 19.8, 19.4, 17.9][index],
      aof: null,
      pRes: [18.8, 18.1, 17.5, 17.2][index],
      note: "индикаторная диаграмма, 4 режима",
    })),
    seed: 124,
  };
}

function well217(): Spec {
  const id = "217";
  return {
    passport: {
      id,
      fluid: "oil",
      sensorMd: 2590,
      sensorTvd: 2520,
      perfTopMd: 2792,
      perfTopTvd: 2710,
      perfBottomMd: 2830,
      perfBottomTvd: 2744,
      density: 810,
      gradient: null,
      gasGravity: null,
      netPay: 6.4,
      porosity: 0.13,
      viscosity: 2.1,
      volumeFactor: 1.12,
      compressibility: 1.4e-3,
      wellRadius: 0.1,
      reservoirTempC: 88,
      zFactor: null,
    },
    reservoir: [
      { t: utc(2023, 1, 20), p: 21, note: "замер" },
      { t: utc(2024, 1, 18), p: 20.2, note: "замер" },
      { t: utc(2025, 1, 15), p: 19.5, note: "замер" },
      { t: utc(2026, 1, 11), p: 18.9, note: "замер" },
    ],
    q0: 46,
    decline: 0.1,
    j0: 7,
    jDecline: 0.18,
    k: 18,
    tau: 0.7,
    stim: null,
    gas: null,
    whBase: 1.05,
    whSlope: 0.7,
    friction: 0,
    stuck: null,
    spike: utc(2024, 10, 11, 12),
    gap: null,
    extraShuts: [{ start: utc(2025, 0, 18, 0), hours: 36 }],
    journalKvd: [2023, 2024, 2025, 2026].map((year, index) => ({
      wellId: id,
      t: utc(year, 2, 16),
      permeability: [19, 18, 17, 18][index],
      skin: [-4.2, -3.1, -1.4, 1.6][index],
      pStar: [21.0, 20.1, 19.0, 18.3][index],
      note: "низкая проницаемость, к концу периода депрессия выросла",
    })),
    journalGki: [2023, 2024, 2025, 2026].map((year, index) => ({
      wellId: id,
      t: utc(year, 8, 11),
      productivity: [6.4, 4.9, 3.6, 2.7][index],
      aof: null,
      pRes: [20.6, 19.9, 19.2, 19.0][index],
      note: "Кпрод по четырём режимам падает",
    })),
    seed: 217,
  };
}

function well305(): Spec {
  const id = "305";
  return {
    passport: {
      id,
      fluid: "oil",
      sensorMd: 2420,
      sensorTvd: 2388,
      perfTopMd: 2594,
      perfTopTvd: 2550,
      perfBottomMd: 2660,
      perfBottomTvd: 2612,
      density: 760,
      gradient: null,
      gasGravity: null,
      netPay: 14,
      porosity: 0.19,
      viscosity: 0.9,
      volumeFactor: 1.2,
      compressibility: 2.2e-3,
      wellRadius: 0.108,
      reservoirTempC: 76,
      zFactor: null,
    },
    reservoir: [
      { t: utc(2023, 0, 25), p: 16.8, note: "замер" },
      { t: utc(2024, 0, 22), p: 16.5, note: "замер" },
      { t: utc(2025, 0, 20), p: 16.2, note: "замер" },
      { t: utc(2026, 0, 18), p: 15.9, note: "замер" },
    ],
    q0: 110,
    decline: 0.03,
    j0: 100,
    jDecline: 0.01,
    k: 140,
    tau: 0.4,
    stim: utc(2025, 4, 20),
    gas: null,
    whBase: 1.6,
    whSlope: 1.1,
    friction: 0,
    stuck: [utc(2024, 5, 4), utc(2024, 5, 9)],
    spike: null,
    gap: null,
    extraShuts: [],
    journalKvd: [2023, 2024, 2025, 2026].map((year, index) => ({
      wellId: id,
      t: utc(year, 2, 16),
      permeability: [132, 140, 136, 140][index],
      skin: [-0.4, -0.5, -0.6, -4.8][index],
      pStar: [16.8, 16.5, 16.2, 15.9][index],
      note: index === 3 ? "после ОПЗ в мае 2025 скин ушёл в минус" : "годовая КВД",
    })),
    journalGki: [2023, 2024, 2025, 2026].map((year, index) => ({
      wellId: id,
      t: utc(year, 8, 11),
      productivity: [96, 95, 148, 150][index],
      aof: null,
      pRes: [16.7, 16.4, 16.1, 16.0][index],
      note: "установившиеся отборы",
    })),
    seed: 305,
  };
}

function well418(): Spec {
  const id = "418";
  const a = 4.3e-4;
  const b = 8e-11;
  return {
    passport: {
      id,
      fluid: "gas",
      sensorMd: 2010,
      sensorTvd: 1980,
      perfTopMd: 2188,
      perfTopTvd: 2140,
      perfBottomMd: 2240,
      perfBottomTvd: 2188,
      density: null,
      gradient: null,
      gasGravity: 0.64,
      netPay: 18,
      porosity: 0.12,
      viscosity: 0.018,
      volumeFactor: null,
      compressibility: null,
      wellRadius: 0.1,
      reservoirTempC: 72,
      zFactor: 0.86,
    },
    reservoir: [
      { t: utc(2023, 3, 2), p: 14.2, note: "замер" },
      { t: utc(2024, 3, 4), p: 13.4, note: "замер" },
      { t: utc(2025, 3, 1), p: 12.6, note: "замер" },
      { t: utc(2026, 2, 28), p: 11.9, note: "замер" },
    ],
    q0: 160_000,
    decline: 0.08,
    j0: 1,
    jDecline: 0,
    k: 32,
    tau: 0.35,
    stim: null,
    gas: { a, b },
    whBase: 0,
    whSlope: 0,
    friction: 0.35,
    stuck: null,
    spike: null,
    gap: null,
    extraShuts: [],
    journalKvd: [2023, 2024, 2025, 2026].map((year, index) => ({
      wellId: id,
      t: utc(year, 2, 16),
      permeability: [30, 26, 28, 33][index],
      skin: [24, 19, 21, 26][index],
      pStar: [14.3, 13.4, 12.8, 12.0][index],
      note: "КВД, метод P²; скин по квадрату давления",
    })),
    journalGki: [2023, 2024, 2025, 2026].map((year, index) => ({
      wellId: id,
      t: utc(year, 8, 11),
      productivity: null,
      aof: [400_000, 370_000, 340_000, 320_000][index],
      pRes: [14.0, 13.3, 12.7, 12.1][index],
      note: "ГКИ, дебит абсолютно свободный по P²",
    })),
    seed: 418,
  };
}

import type { Dataset, PressureUnit, RateUnit, TelemetryPoint } from "./types";

export const P_TO_MPA: Record<PressureUnit, number> = {
  MPa: 1,
  atm: 0.101325,
  kgs: 0.0980665,
  bar: 0.1,
  psi: 0.006894757293168,
};

export const RATE_TO_M3D: Record<RateUnit, number> = {
  m3d: 1,
  km3d: 1000,
  m3h: 24,
};

export const PRESSURE_LABEL: Record<PressureUnit, string> = {
  MPa: "МПа",
  atm: "атм",
  kgs: "кгс/см²",
  bar: "бар",
  psi: "psi",
};

export const RATE_LABEL: Record<RateUnit, string> = {
  m3d: "м³/сут",
  km3d: "тыс. м³/сут",
  m3h: "м³/ч",
};

export function pressureToMpa(value: number, unit: PressureUnit): number {
  return value * P_TO_MPA[unit];
}

export function rateToM3d(value: number, unit: RateUnit): number {
  return value * RATE_TO_M3D[unit];
}

/** Stored pressures are already MPa. This reinterprets them as if the file unit was wrong. */
export function reinterpretUnits(
  dataset: Dataset,
  next: { pressure?: PressureUnit; rate?: RateUnit },
): Dataset {
  const pressure = next.pressure ?? dataset.sourceUnits.pressure;
  const rate = next.rate ?? dataset.sourceUnits.rate;
  const kp = P_TO_MPA[pressure] / P_TO_MPA[dataset.sourceUnits.pressure];
  const kq = RATE_TO_M3D[rate] / RATE_TO_M3D[dataset.sourceUnits.rate];
  const scalePoint = (p: TelemetryPoint): TelemetryPoint => ({
    ...p,
    pBh: p.pBh == null ? null : p.pBh * kp,
    pWh: p.pWh == null ? null : p.pWh * kp,
    q: p.q == null ? null : p.q * kq,
  });
  const series: Dataset["series"] = {};
  for (const [id, points] of Object.entries(dataset.series)) {
    series[id] = points.map(scalePoint);
  }
  return {
    ...dataset,
    sourceUnits: { pressure, rate },
    series,
    reservoir: dataset.reservoir.map((r) => ({ ...r, pressure: r.pressure * kp })),
  };
}

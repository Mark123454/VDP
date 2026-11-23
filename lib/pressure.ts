import type { FluidKind, WellPassport } from "./types";

const G = 9.80665;
const R = 8.314462618;

export interface DepthPair {
  sensor: number;
  perf: number;
  basis: "tvd" | "md";
}

export interface PressureCorrection {
  pPerf: number;
  dp: number;
  gradient: number;
  basis: "tvd" | "md";
  method: string;
  assumed: string[];
}

export function resolveDepths(well: WellPassport): DepthPair | null {
  if (well.sensorTvd != null && well.perfTopTvd != null) {
    return { sensor: well.sensorTvd, perf: well.perfTopTvd, basis: "tvd" };
  }
  if (well.sensorMd != null && well.perfTopMd != null) {
    return { sensor: well.sensorMd, perf: well.perfTopMd, basis: "md" };
  }
  return null;
}

export function gasGradientMpaPerM(pressureMpa: number, well: WellPassport, tempC: number): { gradient: number; assumed: string[] } {
  const assumed: string[] = [];
  const gamma = well.gasGravity ?? 0.65;
  if (well.gasGravity == null) assumed.push("относительная плотность газа 0,65");
  const z = well.zFactor ?? 0.9;
  if (well.zFactor == null) assumed.push("z = 0,90");
  const molar = 0.028963 * gamma;
  const kelvin = tempC + 273.15;
  const pascal = Math.max(pressureMpa, 0.2) * 1e6;
  const density = (pascal * molar) / (z * R * kelvin);
  return { gradient: (density * G) / 1e6, assumed };
}

export function liquidGradient(well: WellPassport): { gradient: number; method: string; assumed: string[] } {
  if (well.gradient != null && well.gradient > 0) {
    return { gradient: well.gradient, method: "заданный градиент", assumed: [] };
  }
  const assumed: string[] = [];
  let density = well.density;
  if (density == null || !(density > 0)) {
    density = well.fluid === "water" ? 1015 : 800;
    assumed.push(well.fluid === "water" ? "плотность воды 1015 кг/м³" : "плотность нефти 800 кг/м³");
  }
  return {
    gradient: (density * G) / 1e6,
    method: well.density != null && well.density > 0 ? "плотность жидкости" : "плотность по умолчанию",
    assumed,
  };
}

export function correctPressure(pSensor: number, well: WellPassport, tempC: number | null): PressureCorrection | null {
  if (!Number.isFinite(pSensor)) return null;
  const depths = resolveDepths(well);
  if (!depths) return null;
  const dh = depths.perf - depths.sensor;
  if (well.gradient != null && well.gradient > 0 && well.fluid !== "gas") {
    const dp = well.gradient * dh;
    return {
      pPerf: pSensor + dp,
      dp,
      gradient: well.gradient,
      basis: depths.basis,
      method: "заданный градиент",
      assumed: [],
    };
  }
  if (well.fluid === "gas" && (well.gradient == null || !(well.gradient > 0))) {
    const assumed: string[] = [];
    const tC = tempC ?? well.reservoirTempC ?? 80;
    if (tempC == null && well.reservoirTempC == null) assumed.push("температура газа 80 °C");
    else if (tempC == null) assumed.push("температура газа по Тпл, нет замера Тзаб");
    const first = gasGradientMpaPerM(pSensor, well, tC);
    let pPerf = pSensor + first.gradient * dh;
    const second = gasGradientMpaPerM((pSensor + Math.max(pPerf, 0.2)) / 2, well, tC);
    pPerf = pSensor + second.gradient * dh;
    return {
      pPerf,
      dp: pPerf - pSensor,
      gradient: second.gradient,
      basis: depths.basis,
      method: "газ, ρ = PM/(zRT) по среднему давлению",
      assumed: [...assumed, ...second.assumed],
    };
  }
  const liquid = liquidGradient(well);
  const dp = liquid.gradient * dh;
  return {
    pPerf: pSensor + dp,
    dp,
    gradient: liquid.gradient,
    basis: depths.basis,
    method: liquid.method,
    assumed: liquid.assumed,
  };
}

export function sensorFromPerf(pPerf: number, well: WellPassport, tempC: number): number | null {
  const depths = resolveDepths(well);
  if (!depths) return null;
  const dh = depths.perf - depths.sensor;
  if (well.fluid === "gas" && (well.gradient == null || !(well.gradient > 0))) {
    let pSensor = pPerf;
    for (let i = 0; i < 4; i += 1) {
      const g = gasGradientMpaPerM((pSensor + pPerf) / 2, well, tempC).gradient;
      pSensor = pPerf - g * dh;
    }
    return pSensor;
  }
  const gradient = well.gradient != null && well.gradient > 0 ? well.gradient : liquidGradient(well).gradient;
  return pPerf - gradient * dh;
}

export function defaultFluidDensity(fluid: FluidKind): number {
  if (fluid === "water") return 1015;
  if (fluid === "gas") return 80;
  return 800;
}

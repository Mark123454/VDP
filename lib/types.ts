export type PressureUnit = "MPa" | "atm" | "kgs" | "bar" | "psi";
export type RateUnit = "m3d" | "km3d" | "m3h";
export type FluidKind = "oil" | "water" | "gas";

export interface UnitConfig {
  pressure: PressureUnit;
  rate: RateUnit;
}

export interface WellPassport {
  id: string;
  fluid: FluidKind;
  sensorMd: number | null;
  sensorTvd: number | null;
  perfTopMd: number | null;
  perfTopTvd: number | null;
  perfBottomMd: number | null;
  perfBottomTvd: number | null;
  /** кг/м³, жидкость в интервале датчик–ВДП */
  density: number | null;
  /** МПа/м, если задан — важнее плотности */
  gradient: number | null;
  /** относительная плотность газа по воздуху */
  gasGravity: number | null;
  /** эффективная толщина, м */
  netPay: number | null;
  /** доля, не проценты; значения > 1 читаются как проценты */
  porosity: number | null;
  /** мПа·с */
  viscosity: number | null;
  /** объёмный коэффициент, м³/м³ */
  volumeFactor: number | null;
  /** общая сжимаемость, 1/МПа */
  compressibility: number | null;
  /** радиус скважины, м */
  wellRadius: number | null;
  /** пластовая температура, °C */
  reservoirTempC: number | null;
  zFactor: number | null;
}

export interface TelemetryPoint {
  t: number;
  /** МПа на глубине датчика */
  pBh: number | null;
  tBh: number | null;
  pWh: number | null;
  tWh: number | null;
  /** м³/сут */
  q: number | null;
}

export interface ReservoirPoint {
  wellId: string;
  t: number;
  /** МПа */
  pressure: number;
  note: string;
}

export interface JournalKvd {
  wellId: string;
  t: number;
  permeability: number | null;
  skin: number | null;
  pStar: number | null;
  note: string;
}

export interface JournalGki {
  wellId: string;
  t: number;
  productivity: number | null;
  aof: number | null;
  pRes: number | null;
  note: string;
}

export interface Dataset {
  version: 1;
  sourceName: string;
  isSample: boolean;
  sourceUnits: UnitConfig;
  wells: WellPassport[];
  series: Record<string, TelemetryPoint[]>;
  reservoir: ReservoirPoint[];
  journalKvd: JournalKvd[];
  journalGki: JournalGki[];
}

export interface DerivedPoint {
  t: number;
  pBh: number | null;
  tBh: number | null;
  pWh: number | null;
  tWh: number | null;
  q: number | null;
  pPerf: number | null;
  dpHydro: number | null;
  pRes: number | null;
  drawdown: number | null;
  pi: number | null;
}

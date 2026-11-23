import * as XLSX from "xlsx";
import type {
  Dataset,
  FluidKind,
  JournalGki,
  JournalKvd,
  ReservoirPoint,
  TelemetryPoint,
  UnitConfig,
  WellPassport,
} from "./types";
import { pressureToMpa, rateToM3d } from "./units";

type Param = "pBh" | "tBh" | "pWh" | "tWh" | "q";

let workbookDate1904 = false;

export function parseWorkbook(data: ArrayBuffer, units: UnitConfig, sourceName: string): Dataset {
  const workbook = XLSX.read(data, { type: "array", cellDates: false });
  workbookDate1904 = Boolean(workbook.Workbook?.WBProps?.date1904);
  const bags = new Map<string, Map<number, TelemetryPoint>>();
  const order: string[] = [];
  const wells = new Map<string, WellPassport>();
  const reservoir: ReservoirPoint[] = [];
  const journalKvd: JournalKvd[] = [];
  const journalGki: JournalGki[] = [];
  let telemetryHits = 0;

  const remember = (id: string) => {
    const name = id.trim();
    if (!name) return;
    if (!wells.has(name)) {
      wells.set(name, emptyPassport(name));
      order.push(name);
    }
    if (!bags.has(name)) bags.set(name, new Map());
  };

  for (const sheetName of workbook.SheetNames) {
    const kind = classifySheet(sheetName);
    const sheet = workbook.Sheets[sheetName];
    if (!sheet || !kind) continue;
    const rows = matrix(sheet);
    if (kind === "passport") {
      readPassport(rows, wells, order);
      continue;
    }
    if (kind === "pres") {
      reservoir.push(...readReservoir(rows, units, remember));
      continue;
    }
    if (kind === "kvd") {
      journalKvd.push(...readJournalKvd(rows, units, remember));
      continue;
    }
    if (kind === "gki") {
      journalGki.push(...readJournalGki(rows, units, remember));
      continue;
    }
    telemetryHits += readTelemetry(rows, kind, units, bags, remember);
  }

  if (telemetryHits === 0 && order.length === 0) {
    throw new Error("Не нашёл телеметрию. Нужны листы Рзаб, Тзаб, Руст, Туст и Расходомер: первый столбец — дата, дальше скважины.");
  }

  const series: Dataset["series"] = {};
  for (const id of order) {
    const bag = bags.get(id);
    series[id] = bag ? [...bag.values()].sort((a, b) => a.t - b.t) : [];
  }
  for (const id of bags.keys()) {
    if (!series[id]) {
      remember(id);
      series[id] = [...bags.get(id)!.values()].sort((a, b) => a.t - b.t);
    }
  }

  return {
    version: 1,
    sourceName,
    isSample: false,
    sourceUnits: units,
    wells: order.map((id) => wells.get(id)!),
    series,
    reservoir,
    journalKvd,
    journalGki,
  };
}

export function datasetToSheetRows(dataset: Dataset): XLSX.WorkBook {
  const wb = XLSX.utils.book_new();
  const ids = dataset.wells.map((w) => w.id);
  const times = new Set<number>();
  for (const id of ids) for (const point of dataset.series[id] ?? []) times.add(point.t);
  const sorted = [...times].sort((a, b) => a - b);
  const index = new Map<string, Map<number, TelemetryPoint>>();
  for (const id of ids) {
    const map = new Map<number, TelemetryPoint>();
    for (const point of dataset.series[id] ?? []) map.set(point.t, point);
    index.set(id, map);
  }
  const sheets: { name: string; param: Param | null }[] = [
    { name: "Рзаб", param: "pBh" },
    { name: "Тзаб", param: "tBh" },
    { name: "Руст", param: "pWh" },
    { name: "Туст", param: "tWh" },
    { name: "Расходомер", param: "q" },
  ];
  for (const spec of sheets) {
    const header = ["Дата", ...ids];
    const body = sorted.map((t) => {
      const row: (string | number | null)[] = [formatExcelDate(t)];
      for (const id of ids) {
        const point = index.get(id)?.get(t);
        const value = point && spec.param ? point[spec.param] : null;
        row.push(value);
      }
      return row;
    });
    XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet([header, ...body]), spec.name);
  }

  const presHeader = ["Дата", "Скважина", "Рпл_МПа", "Примечание"];
  const presRows = dataset.reservoir
    .slice()
    .sort((a, b) => a.t - b.t)
    .map((r) => [formatExcelDate(r.t), r.wellId, r.pressure, r.note]);
  XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet([presHeader, ...presRows]), "Пластовое давление");

  const passHeader = [
    "Скважина",
    "Флюид",
    "Ндат_м",
    "TVDдат_м",
    "Нвдп_м",
    "TVDвдп_м",
    "Нндп_м",
    "TVDндп_м",
    "Плотность_кгм3",
    "Градиент_МПа_м",
    "ОтнПлотностьГаза",
    "hэфф_м",
    "Пористость",
    "Вязкость_мПас",
    "B",
    "ct_1наМПа",
    "rw_м",
    "Тпл_C",
    "z",
  ];
  const passRows = dataset.wells.map((w) => [
    w.id,
    w.fluid === "gas" ? "газ" : w.fluid === "water" ? "вода" : "нефть",
    w.sensorMd,
    w.sensorTvd,
    w.perfTopMd,
    w.perfTopTvd,
    w.perfBottomMd,
    w.perfBottomTvd,
    w.density,
    w.gradient,
    w.gasGravity,
    w.netPay,
    w.porosity,
    w.viscosity,
    w.volumeFactor,
    w.compressibility,
    w.wellRadius,
    w.reservoirTempC,
    w.zFactor,
  ]);
  XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet([passHeader, ...passRows]), "Паспорт");

  const kvdHeader = ["Дата", "Скважина", "k_мД", "Скин", "Pзв_МПа", "Примечание"];
  const kvdRows = dataset.journalKvd.map((r) => [formatExcelDate(r.t), r.wellId, r.permeability, r.skin, r.pStar, r.note]);
  XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet([kvdHeader, ...kvdRows]), "КВД");

  const gkiHeader = ["Дата", "Скважина", "Кпрод", "AOF", "Рпл_МПа", "Примечание"];
  const gkiRows = dataset.journalGki.map((r) => [formatExcelDate(r.t), r.wellId, r.productivity, r.aof, r.pRes, r.note]);
  XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet([gkiHeader, ...gkiRows]), "ГКИ");
  return wb;
}

export function blankTemplate(): XLSX.WorkBook {
  const wb = XLSX.utils.book_new();
  for (const name of ["Рзаб", "Тзаб", "Руст", "Туст", "Расходомер"]) {
    XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet([["Дата", "124", "217"]]), name);
  }
  XLSX.utils.book_append_sheet(
    wb,
    XLSX.utils.aoa_to_sheet([["Дата", "Скважина", "Рпл_МПа", "Примечание"]]),
    "Пластовое давление",
  );
  XLSX.utils.book_append_sheet(
    wb,
    XLSX.utils.aoa_to_sheet([
      ["Скважина", "Флюид", "Ндат_м", "TVDдат_м", "Нвдп_м", "TVDвдп_м", "Нндп_м", "TVDндп_м", "Плотность_кгм3", "Градиент_МПа_м", "ОтнПлотностьГаза", "hэфф_м", "Пористость", "Вязкость_мПас", "B", "ct_1наМПа", "rw_м", "Тпл_C", "z"],
    ]),
    "Паспорт",
  );
  XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet([["Дата", "Скважина", "k_мД", "Скин", "Pзв_МПа", "Примечание"]]), "КВД");
  XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet([["Дата", "Скважина", "Кпрод", "AOF", "Рпл_МПа", "Примечание"]]), "ГКИ");
  return wb;
}

export function downloadWorkbook(wb: XLSX.WorkBook, filename: string) {
  XLSX.writeFile(wb, filename);
}

function formatExcelDate(ms: number): string {
  const d = new Date(ms);
  const dd = String(d.getUTCDate()).padStart(2, "0");
  const mm = String(d.getUTCMonth() + 1).padStart(2, "0");
  const hh = String(d.getUTCHours()).padStart(2, "0");
  const mi = String(d.getUTCMinutes()).padStart(2, "0");
  return `${dd}.${mm}.${d.getUTCFullYear()} ${hh}:${mi}`;
}

function emptyPassport(id: string): WellPassport {
  return {
    id,
    fluid: "oil",
    sensorMd: null,
    sensorTvd: null,
    perfTopMd: null,
    perfTopTvd: null,
    perfBottomMd: null,
    perfBottomTvd: null,
    density: null,
    gradient: null,
    gasGravity: null,
    netPay: null,
    porosity: null,
    viscosity: null,
    volumeFactor: null,
    compressibility: null,
    wellRadius: null,
    reservoirTempC: null,
    zFactor: null,
  };
}

function classifySheet(name: string): Param | "pres" | "passport" | "kvd" | "gki" | null {
  const n = norm(name);
  if (/паспорт/.test(n)) return "passport";
  if (/пласт|рпл|reservoir/.test(n)) return "pres";
  if (n === "квд" || /криваявосстанов/.test(n)) return "kvd";
  if (n === "гки" || /индикатор/.test(n)) return "gki";
  if (/рзаб|pwf|bhp|давлениезаб|забойноедавлен/.test(n)) return "pBh";
  if (/тзаб|bht|температуразаб|забойнаятемп/.test(n)) return "tBh";
  if (/руст|whp|thp|давлениеуст|устьевоедавлен/.test(n)) return "pWh";
  if (/туст|wht|температурауст|устьеваятемп/.test(n)) return "tWh";
  if (/расходомер|дебит|расход|rate|flow/.test(n)) return "q";
  return null;
}

function norm(value: string): string {
  return value.toLowerCase().replace(/ё/g, "е").replace(/[^a-zа-я0-9]/g, "");
}

function matrix(sheet: XLSX.WorkSheet): unknown[][] {
  const ref = sheet["!ref"];
  if (!ref) return [];
  const range = XLSX.utils.decode_range(ref);
  const rows: unknown[][] = [];
  for (let r = range.s.r; r <= range.e.r; r += 1) {
    const row: unknown[] = [];
    let empty = true;
    for (let c = range.s.c; c <= range.e.c; c += 1) {
      const cell = sheet[XLSX.utils.encode_cell({ r, c })];
      const value = cell ? cell.v : null;
      if (value != null && value !== "") empty = false;
      row.push(value);
    }
    if (!empty) rows.push(row);
  }
  return rows;
}

function readTelemetry(
  rows: unknown[][],
  param: Param,
  units: UnitConfig,
  bags: Map<string, Map<number, TelemetryPoint>>,
  remember: (id: string) => void,
): number {
  const located = locateTable(rows);
  if (!located) return 0;
  const { header, data } = located;
  if (isLong(header)) return readLongTelemetry(header, data, param, units, bags, remember);
  let hits = 0;
  const wells = header.slice(1).map((cell, index) => ({ index: index + 1, id: headerText(cell) }));
  for (const well of wells) {
    if (!well.id || /единиц|мпа|атм|м3/.test(norm(well.id))) continue;
    remember(well.id);
  }
  for (const row of data) {
    const t = parseDateValue(row[0]);
    if (t == null) continue;
    const stamp = Math.round(t / 60_000) * 60_000;
    for (const well of wells) {
      if (!well.id) continue;
      const raw = parseNumber(row[well.index]);
      if (raw == null) continue;
      const value = param === "q" ? rateToM3d(raw, units.rate) : param === "tBh" || param === "tWh" ? raw : pressureToMpa(raw, units.pressure);
      const bag = bags.get(well.id)!;
      const point = bag.get(stamp) ?? { t: stamp, pBh: null, tBh: null, pWh: null, tWh: null, q: null };
      point[param] = value;
      bag.set(stamp, point);
      hits += 1;
    }
  }
  return hits;
}

function readLongTelemetry(
  header: unknown[],
  data: unknown[][],
  param: Param,
  units: UnitConfig,
  bags: Map<string, Map<number, TelemetryPoint>>,
  remember: (id: string) => void,
): number {
  const cols = indexHeaders(header);
  const dateCol = findCol(cols, /дата|date|время/);
  const wellCol = findCol(cols, /скважина|well/);
  const valueCol = findCol(cols, /значен|давлен|температ|дебит|расход|rate|value|рзаб|тзаб|руст|туст/);
  if (dateCol < 0 || wellCol < 0 || valueCol < 0) return 0;
  let hits = 0;
  for (const row of data) {
    const t = parseDateValue(row[dateCol]);
    const id = headerText(row[wellCol]);
    const raw = parseNumber(row[valueCol]);
    if (t == null || !id || raw == null) continue;
    remember(id);
    const stamp = Math.round(t / 60_000) * 60_000;
    const value = param === "q" ? rateToM3d(raw, units.rate) : param === "tBh" || param === "tWh" ? raw : pressureToMpa(raw, units.pressure);
    const bag = bags.get(id)!;
    const point = bag.get(stamp) ?? { t: stamp, pBh: null, tBh: null, pWh: null, tWh: null, q: null };
    point[param] = value;
    bag.set(stamp, point);
    hits += 1;
  }
  return hits;
}

function readReservoir(rows: unknown[][], units: UnitConfig, remember: (id: string) => void): ReservoirPoint[] {
  const located = locateTable(rows);
  if (!located) return [];
  if (!isLong(located.header)) {
    const points: ReservoirPoint[] = [];
    const wells = located.header.slice(1).map((cell, index) => ({ index: index + 1, id: headerText(cell) }));
    for (const row of located.data) {
      const t = parseDateValue(row[0]);
      if (t == null) continue;
      for (const well of wells) {
        const raw = parseNumber(row[well.index]);
        if (!well.id || raw == null) continue;
        remember(well.id);
        points.push({ wellId: well.id, t, pressure: pressureToMpa(raw, units.pressure), note: "" });
      }
    }
    return points;
  }
  const cols = indexHeaders(located.header);
  const dateCol = findCol(cols, /дата|date/);
  const wellCol = findCol(cols, /скважина|well/);
  const pCol = findCol(cols, /рпл|давлен|pressure|мпа/);
  const noteCol = findCol(cols, /примеч|note|коммент/);
  const points: ReservoirPoint[] = [];
  for (const row of located.data) {
    const t = parseDateValue(row[dateCol]);
    const id = headerText(row[wellCol]);
    const raw = parseNumber(row[pCol]);
    if (t == null || !id || raw == null) continue;
    remember(id);
    points.push({
      wellId: id,
      t,
      pressure: pressureToMpa(raw, units.pressure),
      note: noteCol >= 0 ? headerText(row[noteCol]) : "",
    });
  }
  return points;
}

function readPassport(rows: unknown[][], wells: Map<string, WellPassport>, order: string[]) {
  const located = locateTable(rows);
  if (!located) return;
  const fields = located.header.map((cell) => matchPassport(headerText(cell)));
  for (const row of located.data) {
    const idIndex = fields.indexOf("id");
    const id = headerText(idIndex >= 0 ? row[idIndex] : row[0]);
    if (!id) continue;
    if (!wells.has(id)) {
      wells.set(id, emptyPassport(id));
      order.push(id);
    }
    const well = wells.get(id)!;
    fields.forEach((field, index) => {
      if (!field || field === "id") return;
      if (field === "fluid") {
        well.fluid = parseFluid(headerText(row[index]));
        return;
      }
      const value = parseNumber(row[index]);
      if (value == null) return;
      well[field] = value;
    });
  }
}

function readJournalKvd(rows: unknown[][], units: UnitConfig, remember: (id: string) => void): JournalKvd[] {
  const located = locateTable(rows);
  if (!located) return [];
  const cols = indexHeaders(located.header);
  const dateCol = findCol(cols, /дата|date/);
  const wellCol = findCol(cols, /скважина|well/);
  const kCol = findCol(cols, /^k|прониц/);
  const sCol = findCol(cols, /скин|skin/);
  const pCol = findCol(cols, /pзв|рзв|p\*|пластов|давле/);
  const noteCol = findCol(cols, /примеч|note/);
  const out: JournalKvd[] = [];
  for (const row of located.data) {
    const t = parseDateValue(row[dateCol]);
    const id = headerText(row[wellCol]);
    if (t == null || !id) continue;
    remember(id);
    const p = pCol >= 0 ? parseNumber(row[pCol]) : null;
    out.push({
      wellId: id,
      t,
      permeability: kCol >= 0 ? parseNumber(row[kCol]) : null,
      skin: sCol >= 0 ? parseNumber(row[sCol]) : null,
      pStar: p == null ? null : pressureToMpa(p, units.pressure),
      note: noteCol >= 0 ? headerText(row[noteCol]) : "",
    });
  }
  return out;
}

function readJournalGki(rows: unknown[][], units: UnitConfig, remember: (id: string) => void): JournalGki[] {
  const located = locateTable(rows);
  if (!located) return [];
  const cols = indexHeaders(located.header);
  const dateCol = findCol(cols, /дата|date/);
  const wellCol = findCol(cols, /скважина|well/);
  const jCol = findCol(cols, /кпрод|продуктив|pi|j/);
  const aofCol = findCol(cols, /aof|свободн/);
  const pCol = findCol(cols, /рпл|пласт|pressure/);
  const noteCol = findCol(cols, /примеч|note/);
  const out: JournalGki[] = [];
  for (const row of located.data) {
    const t = parseDateValue(row[dateCol]);
    const id = headerText(row[wellCol]);
    if (t == null || !id) continue;
    remember(id);
    const p = pCol >= 0 ? parseNumber(row[pCol]) : null;
    const aof = aofCol >= 0 ? parseNumber(row[aofCol]) : null;
    out.push({
      wellId: id,
      t,
      productivity: jCol >= 0 ? parseNumber(row[jCol]) : null,
      aof: aof == null ? null : rateToM3d(aof, units.rate),
      pRes: p == null ? null : pressureToMpa(p, units.pressure),
      note: noteCol >= 0 ? headerText(row[noteCol]) : "",
    });
  }
  return out;
}

function matchPassport(header: string): keyof WellPassport | "id" | null {
  const n = norm(header);
  if (!n) return null;
  if (/скважина|^well$|имяскв/.test(n)) return "id";
  if (/флюид|fluid|типфлюид/.test(n)) return "fluid";
  if (n.includes("tvd") && /дат/.test(n)) return "sensorTvd";
  if (n.includes("tvd") && /ндп|низ|подошв|bottom/.test(n)) return "perfBottomTvd";
  if (n.includes("tvd") && /вдп|верх|перф|top/.test(n)) return "perfTopTvd";
  if (/ндп|подошв/.test(n)) return "perfBottomMd";
  if (/вдп|верхдыр|перфорацверх|нвдп/.test(n)) return "perfTopMd";
  if (/датчик|ндат|hдат|sensor|глубинад/.test(n)) return "sensorMd";
  if (/градиент/.test(n)) return "gradient";
  if (/отнплот|плотност.*газ|gravity|удельн.*газ/.test(n)) return "gasGravity";
  if (/плотн/.test(n)) return "density";
  if (/эфф|мощност|толщин|netpay|hэф/.test(n)) return "netPay";
  if (/порист/.test(n)) return "porosity";
  if (/вязк/.test(n)) return "viscosity";
  if (n === "b" || /объемн|volumefactor/.test(n)) return "volumeFactor";
  if (n.startsWith("ct") || /сжим/.test(n)) return "compressibility";
  if (n.startsWith("rw") || /радиусскв|радиусс/.test(n)) return "wellRadius";
  if (/тпл|трезерв|пластоваятемп/.test(n)) return "reservoirTempC";
  if (n === "z" || /zфактор|сверхсжим/.test(n)) return "zFactor";
  return null;
}

function parseFluid(value: string): FluidKind {
  const n = norm(value);
  if (/газ|gas/.test(n)) return "gas";
  if (/вод|water/.test(n)) return "water";
  return "oil";
}

function locateTable(rows: unknown[][]): { header: unknown[]; data: unknown[][] } | null {
  for (let i = 0; i < Math.min(rows.length, 8); i += 1) {
    const date = parseDateValue(rows[i][0]);
    const numeric = rows[i].slice(1).some((cell) => parseNumber(cell) != null);
    if (date != null && numeric) {
      if (i === 0) return { header: rows[0].map((_, index) => (index === 0 ? "Дата" : `Столбец ${index + 1}`)), data: rows };
      return { header: rows[i - 1], data: rows.slice(i) };
    }
  }
  if (!rows.length) return null;
  return { header: rows[0], data: rows.slice(1) };
}

function isLong(header: unknown[]): boolean {
  return header.some((cell) => /скважина|well/.test(norm(headerText(cell))));
}

function indexHeaders(header: unknown[]): string[] {
  return header.map((cell) => norm(headerText(cell)));
}

function findCol(headers: string[], pattern: RegExp): number {
  return headers.findIndex((header) => pattern.test(header));
}

function headerText(value: unknown): string {
  if (value == null) return "";
  return String(value).trim();
}

export function parseNumber(value: unknown): number | null {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value !== "string") return null;
  const s = value.trim().replace(/\s/g, "").replace(",", ".");
  if (!s || s === "-" || s === "—" || /^н\/?д$/i.test(s)) return null;
  const n = Number(s);
  return Number.isFinite(n) ? n : null;
}

export function parseDateValue(value: unknown, date1904 = workbookDate1904): number | null {
  if (value == null || value === "") return null;
  if (value instanceof Date && !Number.isNaN(value.getTime())) {
    return Date.UTC(value.getFullYear(), value.getMonth(), value.getDate(), value.getHours(), value.getMinutes(), value.getSeconds());
  }
  if (typeof value === "number" && Number.isFinite(value) && value > 20000 && value < 80000) {
    const epoch = date1904 ? Date.UTC(1904, 0, 1) : Date.UTC(1899, 11, 30);
    return epoch + Math.round(value * 86_400_000);
  }
  if (typeof value === "string") {
    const s = value.trim();
    let match = s.match(/^(\d{1,2})[./](\d{1,2})[./](\d{4})(?:[ T](\d{1,2}):(\d{2})(?::(\d{2}))?)?$/);
    if (match) return Date.UTC(+match[3], +match[2] - 1, +match[1], +(match[4] || 0), +(match[5] || 0), +(match[6] || 0));
    match = s.match(/^(\d{4})-(\d{2})-(\d{2})(?:[ T](\d{2}):(\d{2})(?::(\d{2}))?)?$/);
    if (match) return Date.UTC(+match[1], +match[2] - 1, +match[3], +(match[4] || 0), +(match[5] || 0), +(match[6] || 0));
  }
  return null;
}

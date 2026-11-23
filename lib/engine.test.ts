import { describe, expect, it } from "vitest";
import * as XLSX from "xlsx";
import { analyzeDataset } from "./analyze";
import { parseDateValue, parseNumber, parseWorkbook } from "./excel";
import { GAS_K_FACTOR, OIL_K_FACTOR, gasPermeabilityMd, oilPermeabilityMd, radiusOfInvestigationM, skinFromHorner } from "./formulas";
import { detectCampaigns } from "./gki";
import { interpretBuildup, type BuildupEvent } from "./kvd";
import { correctPressure } from "./pressure";
import { reservoirAt } from "./series";
import { buildSample } from "./sample";
import type { DerivedPoint, WellPassport } from "./types";

const PSI = 0.006894757293168;

function oilWell(partial: Partial<WellPassport> = {}): WellPassport {
  return {
    id: "T",
    fluid: "oil",
    sensorMd: 2400,
    sensorTvd: 2400,
    perfTopMd: 2500,
    perfTopTvd: 2500,
    perfBottomMd: 2540,
    perfBottomTvd: 2540,
    density: 1000,
    gradient: null,
    gasGravity: null,
    netPay: 8,
    porosity: 0.18,
    viscosity: 1.2,
    volumeFactor: 1.15,
    compressibility: 2e-3,
    wellRadius: 0.1,
    reservoirTempC: 80,
    zFactor: null,
    ...partial,
  };
}

describe("units and hydrostatic", () => {
  it("converts the SPE oil constant without drift", () => {
    const q = 40;
    const B = 1.15;
    const mu = 1.2;
    const m = 0.3;
    const h = 8;
    const k = oilPermeabilityMd(q, B, mu, m, h)!;
    const qStb = q / 0.158987294928;
    const mPsi = m / PSI;
    const hFt = h / 0.3048;
    const spe = (162.6 * qStb * B * mu) / (mPsi * hFt);
    expect(k).toBeCloseTo(spe, 6);
    expect(OIL_K_FACTOR).toBeGreaterThan(2);
    expect(OIL_K_FACTOR).toBeLessThan(2.2);
  });

  it("converts the SPE gas P² constant", () => {
    const q = 100_000;
    const T = 350;
    const mu = 0.02;
    const z = 0.9;
    const m = 5;
    const h = 10;
    const k = gasPermeabilityMd(q, T, mu, z, m, h)!;
    const qMscf = q * (35.3146667214886 / 1000);
    const mPsi2 = m / PSI ** 2;
    const hFt = h / 0.3048;
    const spe = (1637 * qMscf * (T * 1.8) * mu * z) / (mPsi2 * hFt);
    expect(k).toBeCloseTo(spe, 4);
    expect(GAS_K_FACTOR).toBeGreaterThan(0.001);
    expect(GAS_K_FACTOR).toBeLessThan(0.002);
  });

  it("adds a water column of 100 m as 0.981 MPa", () => {
    const well = oilWell({ density: 1000, sensorTvd: 0, perfTopTvd: 100 });
    const corrected = correctPressure(10, well, 40);
    expect(corrected).not.toBeNull();
    expect(corrected!.dp).toBeCloseTo((1000 * 9.80665 * 100) / 1e6, 6);
    expect(corrected!.pPerf).toBeCloseTo(10 + corrected!.dp, 6);
  });

  it("interpolates reservoir pressure and holds the ends", () => {
    const points = [
      { wellId: "T", t: 0, pressure: 20, note: "" },
      { wellId: "T", t: 100, pressure: 18, note: "" },
    ];
    expect(reservoirAt(points, 50)).toBeCloseTo(19, 6);
    expect(reservoirAt(points, -10)).toBe(20);
    expect(reservoirAt(points, 150)).toBe(18);
  });
});

describe("horner", () => {
  it("recovers permeability and skin on a textbook oil buildup", () => {
    const well = oilWell();
    const k = 50;
    const q = 40;
    const m = (OIL_K_FACTOR * q * well.volumeFactor! * well.viscosity!) / (k * well.netPay!);
    const pStar = 20;
    const tp = 300;
    const skin = 2;
    const ctPsi = well.compressibility! * PSI;
    const rwFt = well.wellRadius! / 0.3048;
    const logArg = k / (well.porosity! * well.viscosity! * ctPsi * rwFt * rwFt);
    const delta = skin / 1.1513 + Math.log10(logArg) - 3.2275;
    const p1hr = pStar - m * Math.log10(tp + 1);
    const pwf = p1hr - m * delta;
    const samples = [];
    for (let dt = 0.05; dt <= 48; dt *= 1.18) {
      const radial = pStar - m * Math.log10((tp + dt) / dt);
      const factor = 1 - Math.exp(-dt / 0.3);
      samples.push({ dtHours: dt, p: pwf + (radial - pwf) * factor });
    }
    const event: BuildupEvent = {
      id: "T-1",
      wellId: "T",
      start: 0,
      end: 48 * 3600_000,
      pwf,
      qBefore: q,
      tpHours: tp,
      datum: "vdp",
      samples,
      history: [],
    };
    const result = interpretBuildup(event, well, null);
    expect(result.permeability).toBeGreaterThan(45);
    expect(result.permeability).toBeLessThan(55);
    expect(result.skin).toBeGreaterThan(1.4);
    expect(result.skin).toBeLessThan(2.6);
    expect(result.pStar).toBeGreaterThan(19.7);
    expect(result.pStar).toBeLessThan(20.2);
    expect(result.confidence === "высокая" || result.confidence === "средняя").toBe(true);
  });

  it("uses the textbook radius of investigation", () => {
    const ct = 1e-5 / PSI;
    const ri = radiusOfInvestigationM(100, 24, 0.2, 1, ct)!;
    const riFt = 0.029 * Math.sqrt((100 * 24) / (0.2 * 1 * 1e-5));
    expect(ri).toBeCloseTo(riFt * 0.3048, 4);
  });

  it("round-trips skin", () => {
    const skin = skinFromHorner({
      p1hr: 19,
      pwf: 16,
      slope: 0.4,
      permeabilityMd: 40,
      porosity: 0.2,
      viscosity: 1,
      compressibilityPerMpa: 1e-3,
      wellRadiusM: 0.1,
    });
    expect(skin).not.toBeNull();
    const back = skinFromHorner({
      p1hr: 19,
      pwf: 16,
      slope: 0.4,
      permeabilityMd: 40,
      porosity: 0.2,
      viscosity: 1,
      compressibilityPerMpa: 1e-3,
      wellRadiusM: 0.1,
    });
    expect(back).toBeCloseTo(skin!, 8);
  });
});

describe("gki", () => {
  it("fits productivity through a known reservoir pressure", () => {
    const well = oilWell({ id: "G" });
    const pr = 18;
    const j = 10;
    const rates = [20, 40, 60, 80];
    const points: DerivedPoint[] = [];
    let t = 0;
    for (const q of rates) {
      for (let i = 0; i < 8; i += 1) {
        const pPerf = pr - q / j;
        points.push({
          t,
          pBh: pPerf - 1,
          tBh: 80,
          pWh: 1.5,
          tWh: 20,
          q,
          pPerf,
          dpHydro: 1,
          pRes: pr,
          drawdown: q / j,
          pi: j,
        });
        t += 3600_000;
      }
      t += 3600_000;
    }
    const campaigns = detectCampaigns(well, points);
    expect(campaigns).toHaveLength(1);
    expect(campaigns[0].steps).toHaveLength(4);
    expect(campaigns[0].fit?.jAnchored).toBeCloseTo(10, 1);
    expect(campaigns[0].fit?.pIntercept).toBeCloseTo(18, 1);
  });
});

describe("excel", () => {
  it("reads dates, commas and the five telemetry sheets", () => {
    const serial = (Date.UTC(2024, 0, 15, 12, 0, 0) - Date.UTC(1899, 11, 30)) / 86_400_000;
    expect(parseDateValue(serial)).toBe(Date.UTC(2024, 0, 15, 12, 0, 0));
    expect(parseDateValue("15.01.2024 12:00")).toBe(Date.UTC(2024, 0, 15, 12, 0, 0));
    expect(parseNumber("1 234,5")).toBe(1234.5);

    const wb = XLSX.utils.book_new();
    const header = ["Дата", "124", "217"];
    const row = ["15.01.2024 12:00", 10.5, "11,25"];
    XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet([header, row]), "Рзаб");
    XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet([header, ["15.01.2024 12:00", 82, 79]]), "Тзаб");
    XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet([header, ["15.01.2024 12:00", 1.4, 1.1]]), "Руст");
    XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet([header, ["15.01.2024 12:00", 22, 18]]), "Туст");
    XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet([header, ["15.01.2024 12:00", 40, 20]]), "Расходомер");
    XLSX.utils.book_append_sheet(
      wb,
      XLSX.utils.aoa_to_sheet([
        ["Скважина", "Флюид", "TVDдат_м", "TVDвдп_м", "Плотность_кгм3", "hэфф_м"],
        ["124", "нефть", 2400, 2500, 800, 9],
      ]),
      "Паспорт",
    );
    XLSX.utils.book_append_sheet(
      wb,
      XLSX.utils.aoa_to_sheet([
        ["Дата", "Скважина", "Рпл_МПа", "Примечание"],
        ["01.02.2024", "124", 180, "атмосферы в файле"],
      ]),
      "Пластовое давление",
    );
    const buffer = XLSX.write(wb, { type: "array", bookType: "xlsx" }) as ArrayBuffer;
    const dataset = parseWorkbook(buffer, { pressure: "atm", rate: "m3d" }, "файл");
    const point = dataset.series["124"][0];
    expect(point.pBh).toBeCloseTo(10.5 * 0.101325, 5);
    expect(point.tBh).toBe(82);
    expect(point.q).toBe(40);
    expect(dataset.series["217"][0].pWh).toBeCloseTo(1.1 * 0.101325, 5);
    expect(dataset.wells.find((well) => well.id === "124")?.perfTopTvd).toBe(2500);
    expect(dataset.wells.find((well) => well.id === "124")?.density).toBe(800);
    expect(dataset.reservoir[0].pressure).toBeCloseTo(180 * 0.101325, 4);
  });
});

describe("sample field", () => {
  const dataset = buildSample();
  const analysis = analyzeDataset(dataset);

  it("builds four wells and reads buildups back", () => {
    expect(dataset.wells.map((well) => well.id)).toEqual(["124", "217", "305", "418"]);
    const well = analysis.wells["124"];
    expect(well.derived.length).toBeGreaterThan(4000);
    expect(well.hydro?.dh).toBeCloseTo(2688 - 2462, 3);
    expect(well.buildups.length).toBeGreaterThanOrEqual(3);
    const interpreted = well.buildups.filter((item) => item.permeability != null);
    expect(interpreted.length).toBeGreaterThan(0);
    const closest = interpreted.reduce((best, item) => {
      const error = Math.abs((item.permeability ?? 0) - 65);
      const bestError = Math.abs((best.permeability ?? 0) - 65);
      return error < bestError ? item : best;
    });
    expect(closest.permeability).toBeGreaterThan(45);
    expect(closest.permeability).toBeLessThan(85);
    expect(well.campaigns.length).toBeGreaterThanOrEqual(3);
    expect(well.anomalies.some((item) => item.kind === "gap")).toBe(true);
    for (const item of Object.values(analysis.wells)) {
      for (const point of item.derived) {
        if (point.pBh != null) expect(point.pBh).toBeGreaterThan(0.2);
        if (point.pPerf != null) expect(point.pPerf).toBeGreaterThan(0.2);
        if (point.pWh != null) expect(point.pWh).toBeGreaterThan(0.1);
      }
    }
  });

  it("flags the stuck gauge and the spike", () => {
    expect(analysis.wells["305"].anomalies.some((item) => item.kind === "flatline")).toBe(true);
    expect(analysis.wells["217"].anomalies.some((item) => item.kind === "spike")).toBe(true);
  });

  it("keeps the gas well inside a plausible permeability", () => {
    const gas = analysis.wells["418"].buildups.filter((item) => item.permeability != null);
    expect(gas.length).toBeGreaterThan(0);
    const best = gas.reduce((a, b) => (Math.abs((a.permeability ?? 0) - 32) < Math.abs((b.permeability ?? 0) - 32) ? a : b));
    expect(best.permeability).toBeGreaterThan(18);
    expect(best.permeability).toBeLessThan(50);
  });
});

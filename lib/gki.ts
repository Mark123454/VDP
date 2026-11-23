import type { DerivedPoint, WellPassport } from "./types";
import { DAY, HOUR, linreg, median, percentile, stddev, mean } from "./series";

export interface RateStep {
  start: number;
  end: number;
  q: number;
  pPerf: number | null;
  pWh: number | null;
  pRes: number | null;
  drawdown: number | null;
  pi: number | null;
  count: number;
}

export interface CampaignFit {
  kind: "oil" | "gas";
  jAnchored: number | null;
  pIntercept: number | null;
  jIntercept: number | null;
  a: number | null;
  b: number | null;
  aof: number | null;
  vogelQmax: number | null;
  r2: number | null;
  notes: string[];
}

export interface Campaign {
  id: string;
  wellId: string;
  start: number;
  end: number;
  steps: RateStep[];
  fit: CampaignFit | null;
}

export function detectCampaigns(well: WellPassport, points: DerivedPoint[]): Campaign[] {
  const positive = points.map((p) => p.q).filter((q): q is number => q != null && q > 0);
  if (positive.length < 12) return [];
  const shutMax = Math.max(0.3, 0.02 * percentile(positive, 0.9));
  const flow = points.filter((p) => p.q != null && p.q > shutMax);
  const segments: DerivedPoint[][] = [];
  let start = 0;
  for (let i = 1; i <= flow.length; i += 1) {
    const atEnd = i === flow.length;
    const gap = !atEnd && flow[i].t - flow[i - 1].t > 8 * HOUR;
    const med = median(flow.slice(start, i).map((p) => p.q!));
    const jump = !atEnd && Math.abs(flow[i].q! - med) / Math.max(med, 1e-6) > 0.12;
    if (!atEnd && !gap && !jump) continue;
    const chunk = flow.slice(start, i);
    const hours = (chunk[chunk.length - 1].t - chunk[0].t) / HOUR;
    const qs = chunk.map((p) => p.q!);
    const cv = Math.abs(mean(qs)) > 0 ? stddev(qs) / Math.abs(mean(qs)) : 1;
    if (hours >= 5 && hours <= 80 && chunk.length >= 4 && cv < 0.055) segments.push(chunk);
    start = i;
  }
  const steps = segments.map(toStep);
  const groups: RateStep[][] = [];
  for (const step of steps) {
    const group = groups[groups.length - 1];
    if (!group || step.start - group[group.length - 1].end > 4 * DAY) groups.push([step]);
    else group.push(step);
  }
  const campaigns: Campaign[] = [];
  for (const group of groups) {
    if (group.length < 3) continue;
    const rates = group.map((s) => s.q);
    if (Math.max(...rates) / Math.min(...rates) < 1.18) continue;
    campaigns.push({
      id: `${well.id}-${group[0].start}`,
      wellId: well.id,
      start: group[0].start,
      end: group[group.length - 1].end,
      steps: group,
      fit: fitCampaign(well, group),
    });
  }
  return campaigns;
}

function toStep(chunk: DerivedPoint[]): RateStep {
  const q = median(chunk.map((p) => p.q!));
  const pPerfVals = chunk.map((p) => p.pPerf).filter((v): v is number => v != null);
  const pWhVals = chunk.map((p) => p.pWh).filter((v): v is number => v != null);
  const pResVals = chunk.map((p) => p.pRes).filter((v): v is number => v != null);
  const pPerf = pPerfVals.length ? median(pPerfVals) : null;
  const pRes = pResVals.length ? median(pResVals) : null;
  const drawdown = pPerf != null && pRes != null ? pRes - pPerf : null;
  return {
    start: chunk[0].t,
    end: chunk[chunk.length - 1].t,
    q,
    pPerf,
    pWh: pWhVals.length ? median(pWhVals) : null,
    pRes,
    drawdown,
    pi: drawdown != null && drawdown > 0.15 ? q / drawdown : null,
    count: chunk.length,
  };
}

export function fitCampaign(well: WellPassport, steps: RateStep[]): CampaignFit {
  const notes: string[] = [];
  const paired = steps.filter((s) => s.pPerf != null);
  if (paired.length < 3) {
    return emptyFit(well.fluid === "gas" ? "gas" : "oil", "Мало режимов с давлением на ВДП.");
  }
  const qs = paired.map((s) => s.q);
  const ps = paired.map((s) => s.pPerf!);
  const line = linreg(qs, ps);
  let pIntercept: number | null = null;
  let jIntercept: number | null = null;
  let r2: number | null = null;
  if (line) {
    r2 = line.r2;
    pIntercept = line.a;
    jIntercept = line.b < 0 ? -1 / line.b : null;
    if (!(line.b < 0)) notes.push("Давление на режимах не падает с дебитом: индикаторная прямая не построена.");
  }
  const anchored = steps.filter((s) => s.drawdown != null && s.drawdown > 0.15);
  let jAnchored: number | null = null;
  if (anchored.length >= 2) {
    let num = 0;
    let den = 0;
    for (const step of anchored) {
      num += step.q * step.drawdown!;
      den += step.drawdown! * step.drawdown!;
    }
    jAnchored = den > 0 ? num / den : null;
  } else {
    notes.push("Нет пластового давления на дату режимов — Кпрод относительно Рпл не посчитан.");
  }

  let a: number | null = null;
  let b: number | null = null;
  let aof: number | null = null;
  let vogelQmax: number | null = null;
  if (well.fluid === "gas") {
    const gasSteps = steps.filter((s) => s.pPerf != null && s.pRes != null && s.q > 0 && s.pRes! > s.pPerf!);
    if (gasSteps.length >= 3) {
      const x = gasSteps.map((s) => s.q);
      const y = gasSteps.map((s) => (s.pRes! ** 2 - s.pPerf! ** 2) / s.q);
      const quad = linreg(x, y);
      if (quad) {
        a = quad.a;
        b = quad.b;
        r2 = quad.r2;
        const pr = gasSteps[gasSteps.length - 1].pRes!;
        aof = solveAof(a, b, pr * pr);
        if (b != null && b < 0) notes.push("Коэффициент b < 0: квадратичная модель газа неустойчива на этих режимах.");
      }
    } else {
      notes.push("Для квадрата давления нужны Рпл и Рвдп на каждом режиме.");
    }
  } else if (jAnchored != null) {
    const oilSteps = anchored.filter((s) => s.pRes != null && s.pPerf != null && s.pPerf > 0 && s.pPerf < s.pRes!);
    if (oilSteps.length >= 3) {
      let num = 0;
      let den = 0;
      for (const step of oilSteps) {
        const ratio = step.pPerf! / step.pRes!;
        const f = 1 - 0.2 * ratio - 0.8 * ratio * ratio;
        if (f <= 0.02) continue;
        num += step.q * f;
        den += f * f;
      }
      vogelQmax = den > 0 ? num / den : null;
    }
  }
  return {
    kind: well.fluid === "gas" ? "gas" : "oil",
    jAnchored,
    pIntercept,
    jIntercept,
    a,
    b,
    aof,
    vogelQmax,
    r2,
    notes,
  };
}

function solveAof(a: number, b: number, pRes2: number): number | null {
  if (!(pRes2 > 0) || !(a > 0)) return null;
  if (Math.abs(b) < 1e-18) return pRes2 / a;
  const disc = a * a + 4 * b * pRes2;
  if (!(disc > 0) || !(b > 0)) return null;
  return (-a + Math.sqrt(disc)) / (2 * b);
}

function emptyFit(kind: "oil" | "gas", note: string): CampaignFit {
  return {
    kind,
    jAnchored: null,
    pIntercept: null,
    jIntercept: null,
    a: null,
    b: null,
    aof: null,
    vogelQmax: null,
    r2: null,
    notes: [note],
  };
}

export function iprCurve(fit: CampaignFit, qMax: number): { q: number; p: number }[] {
  if (fit.pIntercept == null || fit.jIntercept == null || !(fit.jIntercept > 0)) return [];
  const out: { q: number; p: number }[] = [];
  const steps = 24;
  for (let i = 0; i <= steps; i += 1) {
    const q = (qMax * i) / steps;
    const p = fit.pIntercept - q / fit.jIntercept;
    if (p <= 0) break;
    out.push({ q, p });
  }
  return out;
}

export function vogelCurve(pr: number, qmax: number): { q: number; p: number }[] {
  const out: { q: number; p: number }[] = [];
  for (let i = 0; i <= 24; i += 1) {
    const ratio = i / 24;
    const q = qmax * (1 - 0.2 * ratio - 0.8 * ratio * ratio);
    out.push({ q, p: pr * (1 - ratio) });
  }
  return out;
}

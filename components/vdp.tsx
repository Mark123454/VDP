"use client";

import { useMemo } from "react";
import type { EChartsCoreOption } from "echarts";
import type { WellAnalysis } from "@/lib/analyze";
import { sliceDerived } from "@/lib/analyze";
import { fmt } from "@/lib/format";
import type { WellPassport } from "@/lib/types";
import { C, timeAxis, valueAxis, baseTooltip } from "./chart-theme";
import { EChart } from "./echart";
import { Empty, Panel } from "./bits";
import { plot } from "./plot";

export function Vdp({ analysis, range }: { analysis: WellAnalysis | undefined; wellId: string; range: [number, number] | null }) {
  const points = useMemo(() => (analysis ? sliceDerived(analysis.derived, range) : []), [analysis, range]);
  const option = useMemo<EChartsCoreOption>(() => {
    if (!analysis) return {};
    return {
      animation: false,
      color: [C.pbh, C.pperf, C.pres],
      tooltip: baseTooltip(),
      legend: { textStyle: { color: "#d9d4c4" }, top: 0 },
      grid: { left: 58, right: 24, top: 36, bottom: 58 },
      dataZoom: [{ type: "inside" }, { type: "slider", height: 18, bottom: 8 }],
      xAxis: timeAxis(),
      yAxis: valueAxis("МПа"),
      series: [
        { name: "Датчик", type: "line", showSymbol: false, data: plot(points, (p) => p.pBh) },
        { name: "Верхние дыры", type: "line", showSymbol: false, data: plot(points, (p) => p.pPerf) },
        { name: "Пласт", type: "line", showSymbol: false, data: plot(points, (p) => p.pRes), lineStyle: { type: "dashed" } },
      ],
    };
  }, [analysis, points]);

  if (!analysis) return <Empty>Нет скважины.</Empty>;
  const hydro = analysis.hydro;
  const well = analysis.well;

  return (
    <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_320px]">
      <Panel title="Давление датчика и давление на ВДП">
        {hydro ? (
          <div className="h-80 md:h-[460px]">
            <EChart option={option} label="Пересчёт давления на верхние дыры перфорации" />
          </div>
        ) : (
          <Empty>В паспорте нет пары глубин. Нужны TVD датчика и TVD верхних дыр, либо обе глубины по стволу.</Empty>
        )}
      </Panel>
      <div className="grid gap-4">
        <Panel title="Поправка">
          {hydro ? (
            <div className="grid gap-3 text-sm leading-relaxed">
              <p>
                Рвдп = Рдатчик + {fmt(hydro.gradient, 5)} МПа/м × {fmt(hydro.dh, 1)} м.
                Сейчас это {hydro.dpLatest != null && hydro.dpLatest >= 0 ? "+" : ""}
                {fmt(hydro.dpLatest, 3)} МПа.
              </p>
              <p className="text-muted-foreground">
                Опора глубин: {hydro.basis === "tvd" ? "вертикальные отметки" : "глубины по стволу"}. Метод: {hydro.method}.
                {hydro.basis === "md" ? " На наклонной скважине MD завышает столб, лучше внести TVD." : ""}
              </p>
              {hydro.assumed.length ? <p className="text-muted-foreground">Принято: {hydro.assumed.join("; ")}.</p> : null}
              <p className="font-mono text-xs text-muted-foreground">
                ΔP = ρ g Δh / 10⁶, g = 9,80665. Для газа ρ = P M / (z R T), M = 0,02896 γ, одна итерация по среднему давлению.
              </p>
            </div>
          ) : (
            <p className="text-sm text-muted-foreground">Без глубин график показывает только датчик. Заполните паспорт.</p>
          )}
        </Panel>
        <Panel title="Ствол">
          <Sketch well={well} />
        </Panel>
      </div>
    </div>
  );
}

function Sketch({ well }: { well: WellPassport }) {
  const sensor = well.sensorTvd ?? well.sensorMd;
  const top = well.perfTopTvd ?? well.perfTopMd;
  const bottom = well.perfBottomTvd ?? well.perfBottomMd ?? top;
  if (sensor == null || top == null || bottom == null) {
    return <p className="text-sm text-muted-foreground">Нет глубин для схемы.</p>;
  }
  const shallow = Math.min(sensor, top, bottom);
  const deep = Math.max(sensor, top, bottom);
  const pad = Math.max(12, (deep - shallow) * 0.35);
  const viewTop = Math.max(0, shallow - pad);
  const viewBot = deep + pad;
  const y = (depth: number) => 36 + ((depth - viewTop) / Math.max(viewBot - viewTop, 1)) * 180;
  const basis = well.sensorTvd != null && well.perfTopTvd != null ? "TVD" : "MD";
  const marks = stagger([
    { y: y(sensor), label: `Датчик ${fmt(sensor, 0)} м`, color: "#e2a23a" },
    { y: y(top), label: `ВДП ${fmt(top, 0)} м`, color: "#f3d7a1" },
    { y: y(bottom), label: `НДП ${fmt(bottom, 0)} м`, color: "#9cbe6a" },
  ]);
  return (
    <svg viewBox="0 0 280 250" className="h-64 w-full">
      <text x="8" y="18" fill="#b7b39f" fontSize="11">{basis}, интервал датчик–перфорация</text>
      <line x1="78" y1="28" x2="78" y2="230" stroke="#3a3f30" strokeWidth="8" strokeLinecap="round" />
      <line x1="78" y1={y(Math.min(top, bottom))} x2="78" y2={y(Math.max(top, bottom))} stroke="#9cbe6a" strokeWidth="8" strokeLinecap="round" />
      <circle cx="78" cy={y(sensor)} r="5" fill="#e2a23a" />
      {marks.map((mark) => (
        <g key={mark.label}>
          <line x1="90" y1={mark.anchor} x2="118" y2={mark.y} stroke="#6f735f" />
          <text x="124" y={mark.y + 4} fill="#ebe6d6" fontSize="12">{mark.label}</text>
        </g>
      ))}
    </svg>
  );
}

function stagger(marks: { y: number; label: string; color: string }[]) {
  const ordered = [...marks].sort((a, b) => a.y - b.y);
  let cursor = 28;
  return ordered.map((mark) => {
    const y = Math.max(mark.y, cursor);
    cursor = y + 18;
    return { ...mark, anchor: mark.y, y };
  });
}

"use client";

import { useMemo } from "react";
import type { EChartsCoreOption } from "echarts";
import type { Analysis } from "@/lib/analyze";
import { sliceDerived } from "@/lib/analyze";
import { fmt, fmtCompact, formatStamp, fluidLabel } from "@/lib/format";
import { insightsFor } from "@/lib/insights";
import type { Dataset } from "@/lib/types";
import { C, timeAxis, valueAxis, baseTooltip } from "./chart-theme";
import { EChart } from "./echart";
import { Empty, Kpi, Panel, Severity } from "./bits";
import { plot } from "./plot";

export function Overview({
  dataset,
  analysis,
  wellId,
  range,
}: {
  dataset: Dataset;
  analysis: Analysis;
  wellId: string;
  range: [number, number] | null;
}) {
  const well = analysis.wells[wellId];
  const insights = useMemo(() => (well ? insightsFor(dataset, well, range) : []), [dataset, well, range]);
  const points = useMemo(() => (well ? sliceDerived(well.derived, range) : []), [well, range]);
  const latest = [...points].reverse().find((point) => point.pBh != null || point.q != null) ?? well?.latest ?? null;

  const option = useMemo<EChartsCoreOption>(() => {
    if (!well) return {};
    const areas = [
      ...well.buildups.filter((item) => !range || item.event.end >= range[0]).map((item) => [{ xAxis: item.event.start, itemStyle: { color: "rgba(226,162,58,0.13)" } }, { xAxis: item.event.end }]),
      ...well.campaigns.filter((item) => !range || item.end >= (range?.[0] ?? 0)).map((item) => [{ xAxis: item.start, itemStyle: { color: "rgba(156,190,106,0.12)" } }, { xAxis: item.end }]),
    ];
    return {
      animation: false,
      color: [C.pperf, C.pres, C.pbh, C.q],
      tooltip: baseTooltip(),
      legend: { textStyle: { color: "#d9d4c4" }, top: 0 },
      grid: { left: 58, right: 58, top: 36, bottom: 58 },
      dataZoom: [{ type: "inside" }, { type: "slider", height: 18, bottom: 8, borderColor: "#3a3f30", fillerColor: "rgba(226,162,58,0.15)", textStyle: { color: "#b7b39f" } }],
      xAxis: timeAxis(),
      yAxis: [valueAxis("МПа"), valueAxis("м³/сут")],
      series: [
        { name: "Рвдп", type: "line", showSymbol: false, yAxisIndex: 0, data: plot(points, (p) => p.pPerf), lineStyle: { width: 1.6 }, markArea: { data: areas } },
        { name: "Рпл", type: "line", showSymbol: false, yAxisIndex: 0, data: plot(points, (p) => p.pRes), lineStyle: { width: 1.4, type: "dashed" } },
        { name: "Рзаб датчик", type: "line", showSymbol: false, yAxisIndex: 0, data: plot(points, (p) => p.pBh), lineStyle: { width: 1, opacity: 0.85 } },
        { name: "Дебит", type: "line", showSymbol: false, yAxisIndex: 1, data: plot(points, (p) => p.q), lineStyle: { width: 1.4 }, areaStyle: { opacity: 0.08 } },
      ],
    };
  }, [well, points, range]);

  if (!well) return <Empty>Выберите скважину.</Empty>;

  return (
    <div className="grid gap-4">
      <div className="grid grid-cols-2 gap-2 lg:grid-cols-4 xl:grid-cols-8">
        <Kpi label="Дебит" value={fmtCompact(latest?.q, 1)} unit="м³/сут" />
        <Kpi label="Рзаб" value={fmt(latest?.pBh, 2)} unit="МПа" hint="На глубине датчика" />
        <Kpi label="Рвдп" value={fmt(latest?.pPerf, 2)} unit="МПа" hint="Пересчёт на верхние дыры" />
        <Kpi label="Руст" value={fmt(latest?.pWh, 2)} unit="МПа" />
        <Kpi label="Тзаб" value={fmt(latest?.tBh, 1)} unit="°C" />
        <Kpi label="Депрессия" value={fmt(latest?.drawdown, 2)} unit="МПа" />
        <Kpi label="Кпрод" value={fmtCompact(latest?.pi, 1)} unit="м³/сут/МПа" />
        <Kpi label="Рпл" value={fmt(latest?.pRes, 2)} unit="МПа" />
      </div>
      <Panel title={`${wellId} · давление на ВДП, пласт и дебит`}>
        {points.length ? (
          <div className="h-80 md:h-[460px]">
            <EChart option={option} label={`График телеметрии скважины ${wellId}`} />
          </div>
        ) : (
          <Empty>В этом периоде нет точек.</Empty>
        )}
        <p className="mt-2 text-xs text-muted-foreground">Янтарная заливка — остановка под КВД, зелёная — режимы ГКИ. Рзаб снят на датчике, Рвдп пересчитан на верхние дыры.</p>
      </Panel>
      <div className="grid gap-4 lg:grid-cols-[1.1fr_0.9fr]">
        <Panel title="Что видно по ряду">
          <ul className="grid gap-3">
            {insights.map((item) => (
              <li key={item.title} className="border-b border-border/70 pb-3 last:border-0 last:pb-0">
                <Severity level={item.severity} />
                <div className="mt-1 text-sm font-medium">{item.title}</div>
                <p className="mt-1 text-sm leading-relaxed text-muted-foreground">{item.text}</p>
              </li>
            ))}
          </ul>
        </Panel>
        <Panel title="Скважины рядом">
          <div className="overflow-x-auto">
            <table className="w-full min-w-[520px] text-left text-sm">
              <thead className="text-[11px] uppercase tracking-wider text-muted-foreground">
                <tr>
                  <th className="py-2 pr-3 font-medium">Скважина</th>
                  <th className="py-2 pr-3 font-medium">Флюид</th>
                  <th className="py-2 pr-3 font-medium">Дебит</th>
                  <th className="py-2 pr-3 font-medium">Рвдп</th>
                  <th className="py-2 pr-3 font-medium">Кпрод</th>
                  <th className="py-2 font-medium">КВД</th>
                </tr>
              </thead>
              <tbody>
                {dataset.wells.map((item) => {
                  const row = analysis.wells[item.id];
                  const last = row?.latest;
                  return (
                    <tr key={item.id} className={item.id === wellId ? "text-foreground" : "text-muted-foreground"}>
                      <td className="py-1.5 pr-3 font-medium text-foreground">{item.id}</td>
                      <td className="py-1.5 pr-3">{fluidLabel(item.fluid)}</td>
                      <td className="py-1.5 pr-3 font-mono tabular-nums">{fmtCompact(last?.q, 1)}</td>
                      <td className="py-1.5 pr-3 font-mono tabular-nums">{fmt(last?.pPerf ?? last?.pBh, 2)}</td>
                      <td className="py-1.5 pr-3 font-mono tabular-nums">{fmtCompact(last?.pi, 1)}</td>
                      <td className="py-1.5 font-mono tabular-nums">{row?.buildups.length ?? 0}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
          {latest ? <p className="mt-3 text-xs text-muted-foreground">Последняя точка {wellId}: {formatStamp(latest.t)}. Накопленная добыча {fmt(well.cumulative, 0)} м³, время в работе {fmt(well.uptime * 100, 0)}%.</p> : null}
        </Panel>
      </div>
    </div>
  );
}

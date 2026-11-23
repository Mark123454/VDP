"use client";

import { useMemo, useState } from "react";
import type { EChartsCoreOption } from "echarts";
import type { WellAnalysis } from "@/lib/analyze";
import { fmt, formatStamp, parseDayInput } from "@/lib/format";
import type { Dataset } from "@/lib/types";
import { Button } from "./ui/button";
import { Input } from "./ui/input";
import { C, timeAxis, valueAxis, baseTooltip } from "./chart-theme";
import { EChart } from "./echart";
import { Empty, Panel } from "./bits";
import { plot } from "./plot";

export function Reservoir({
  dataset,
  analysis,
  wellId,
  onChange,
}: {
  dataset: Dataset;
  analysis: WellAnalysis | undefined;
  wellId: string;
  onChange: (dataset: Dataset) => void;
}) {
  const points = dataset.reservoir.filter((item) => item.wellId === wellId).sort((a, b) => a.t - b.t);
  const [day, setDay] = useState("2026-02-01");
  const [pressure, setPressure] = useState("16.5");
  const [note, setNote] = useState("");
  const option = useMemo<EChartsCoreOption>(() => {
    if (!analysis) return {};
    return {
      animation: false,
      color: [C.pperf, C.pres],
      tooltip: baseTooltip(),
      legend: { textStyle: { color: "#d9d4c4" }, top: 0 },
      grid: { left: 58, right: 24, top: 36, bottom: 48 },
      xAxis: timeAxis(),
      yAxis: valueAxis("МПа"),
      series: [
        { name: "Рвдп", type: "line", showSymbol: false, data: plot(analysis.derived, (p) => p.pPerf), lineStyle: { opacity: 0.45 } },
        {
          name: "Замер Рпл",
          type: "line",
          data: points.map((item) => [item.t, item.pressure]),
          symbol: "diamond",
          symbolSize: 12,
          lineStyle: { type: "dashed", width: 1.4 },
        },
        {
          name: "P* по КВД",
          type: "scatter",
          data: analysis.buildups.filter((item) => item.pStar != null).map((item) => [item.event.start, item.pStar]),
          symbolSize: 10,
          itemStyle: { color: C.pbh },
        },
      ],
    };
  }, [analysis, points]);

  if (!analysis) return <Empty>Нет скважины.</Empty>;
  const rate = depletion(points);

  return (
    <div className="grid gap-4">
      <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_300px]">
        <Panel title="Пластовое давление и экстраполяция КВД">
          <div className="h-80 md:h-[420px]">
            <EChart option={option} label="Пластовое давление и P звезда по КВД" />
          </div>
          <p className="mt-2 text-xs text-muted-foreground">
            Между замерами Рпл интерполируется линейно, за пределами крайних дат держится последнее значение. P* — экстраполяция КВД на бесконечное время закрытия.
            {rate ? ` Темп по замерам: ${fmt(rate, 2)} МПа/год.` : ""}
          </p>
        </Panel>
        <Panel title="Новый замер">
          <form
            className="grid gap-3"
            onSubmit={(event) => {
              event.preventDefault();
              const t = parseDayInput(day);
              const value = Number(pressure.replace(",", "."));
              if (t == null || !Number.isFinite(value)) return;
              onChange({
                ...dataset,
                isSample: false,
                reservoir: [...dataset.reservoir.filter((item) => !(item.wellId === wellId && item.t === t)), { wellId, t, pressure: value, note }],
              });
              setNote("");
            }}
          >
            <label className="grid gap-1 text-xs text-muted-foreground">Дата<Input type="date" value={day} onChange={(event) => setDay(event.target.value)} required /></label>
            <label className="grid gap-1 text-xs text-muted-foreground">Рпл, МПа<Input value={pressure} onChange={(event) => setPressure(event.target.value)} inputMode="decimal" required /></label>
            <label className="grid gap-1 text-xs text-muted-foreground">Примечание<Input value={note} onChange={(event) => setNote(event.target.value)} /></label>
            <Button type="submit">Добавить замер</Button>
          </form>
        </Panel>
      </div>
      <Panel title="Журнал замеров">
        {points.length ? (
          <div className="overflow-x-auto">
            <table className="w-full text-left text-sm">
              <thead className="text-[11px] uppercase tracking-wider text-muted-foreground">
                <tr>
                  <th className="py-2 pr-3 font-medium">Дата</th>
                  <th className="py-2 pr-3 font-medium">Рпл, МПа</th>
                  <th className="py-2 pr-3 font-medium">Примечание</th>
                  <th className="py-2 font-medium" />
                </tr>
              </thead>
              <tbody>
                {points.map((item) => (
                  <tr key={item.t} className="border-t border-border/60">
                    <td className="py-1.5 pr-3">{formatStamp(item.t, false)}</td>
                    <td className="py-1.5 pr-3 font-mono tabular-nums">{fmt(item.pressure, 2)}</td>
                    <td className="py-1.5 pr-3 text-muted-foreground">{item.note || "—"}</td>
                    <td className="py-1.5 text-right">
                      <Button
                        size="sm"
                        variant="ghost"
                        onClick={() => onChange({ ...dataset, reservoir: dataset.reservoir.filter((row) => !(row.wellId === wellId && row.t === item.t)) })}
                      >
                        Удалить
                      </Button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <Empty>Годовых замеров пока нет. Их можно вписать здесь или загрузить листом «Пластовое давление».</Empty>
        )}
      </Panel>
    </div>
  );
}

function depletion(points: { t: number; pressure: number }[]): number | null {
  if (points.length < 2) return null;
  const years = (points[points.length - 1].t - points[0].t) / (365.25 * 86_400_000);
  if (years < 0.3) return null;
  return (points[points.length - 1].pressure - points[0].pressure) / years;
}

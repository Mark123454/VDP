"use client";

import { useMemo, useState } from "react";
import type { EChartsCoreOption } from "echarts";
import type { Analysis } from "@/lib/analyze";
import { sliceDerived } from "@/lib/analyze";
import { downloadCsv, fmt, formatStamp } from "@/lib/format";
import { median, stddev } from "@/lib/series";
import type { Dataset, DerivedPoint } from "@/lib/types";
import { Button } from "./ui/button";
import { C, WELL_COLORS, timeAxis, valueAxis, baseTooltip } from "./chart-theme";
import { EChart } from "./echart";
import { Chip, Empty, Panel } from "./bits";
import { dailyAverage, plot } from "./plot";

const SERIES = [
  { key: "pPerf", label: "Рвдп", color: C.pperf, unit: "МПа", axis: 0 },
  { key: "pBh", label: "Рзаб", color: C.pbh, unit: "МПа", axis: 0 },
  { key: "pWh", label: "Руст", color: C.pwh, unit: "МПа", axis: 0 },
  { key: "pRes", label: "Рпл", color: C.pres, unit: "МПа", axis: 0 },
  { key: "q", label: "Дебит", color: C.q, unit: "м³/сут", axis: 1 },
  { key: "tBh", label: "Тзаб", color: C.tbh, unit: "°C", axis: 2 },
  { key: "tWh", label: "Туст", color: C.twh, unit: "°C", axis: 2 },
] as const;

type Key = (typeof SERIES)[number]["key"];

export function Telemetry({
  dataset,
  analysis,
  wellId,
  range,
  cursor,
}: {
  dataset: Dataset;
  analysis: Analysis;
  wellId: string;
  range: [number, number] | null;
  cursor: number | null;
}) {
  const [on, setOn] = useState<Record<Key, boolean>>({ pPerf: true, pBh: true, pWh: false, pRes: true, q: true, tBh: false, tWh: false });
  const [bucket, setBucket] = useState<"raw" | "day">("raw");
  const [compare, setCompare] = useState<Key | null>(null);
  const well = analysis.wells[wellId];
  const points = useMemo(() => {
    const sliced = well ? sliceDerived(well.derived, range) : [];
    return bucket === "day" ? dailyAverage(sliced) : sliced;
  }, [well, range, bucket]);

  const option = useMemo<EChartsCoreOption>(() => {
    if (compare) {
      const spec = SERIES.find((item) => item.key === compare)!;
      const rowsByWell = dataset.wells.map((item) => {
        const source = analysis.wells[item.id];
        const rows = source ? sliceDerived(source.derived, range) : [];
        return dailyAverage(rows);
      });
      const positive = rowsByWell.flatMap((rows) => rows.map((point) => point[compare]).filter((value): value is number => value != null && value > 0)).sort((a, b) => a - b);
      const low = positive[Math.floor(positive.length * 0.05)] ?? 1;
      const high = positive[Math.floor(positive.length * 0.95)] ?? 1;
      const useLog = high / Math.max(low, 1e-9) > 25;
      return {
        animation: false,
        tooltip: baseTooltip(),
        legend: { textStyle: { color: "#d9d4c4" }, top: 0 },
        grid: { left: 72, right: 24, top: 36, bottom: 58 },
        dataZoom: [{ type: "inside" }, { type: "slider", height: 18, bottom: 8 }],
        xAxis: timeAxis(),
        yAxis: {
          ...valueAxis(useLog ? `${spec.unit}, лог` : spec.unit),
          type: useLog ? "log" : "value",
          scale: !useLog,
        },
        series: dataset.wells.map((item, index) => ({
          name: item.id,
          type: "line",
          showSymbol: false,
          connectNulls: false,
          data: plot(rowsByWell[index] ?? [], (point) => point[compare]).map(([t, value]) => [t, useLog && (value == null || value <= 0) ? null : value]),
          lineStyle: { width: 1.4, color: WELL_COLORS[index % WELL_COLORS.length] },
          itemStyle: { color: WELL_COLORS[index % WELL_COLORS.length] },
        })),
      };
    }
    const active = SERIES.filter((item) => on[item.key]);
    const useTemp = active.some((item) => item.axis === 2);
    const useRate = active.some((item) => item.axis === 1);
    return {
      animation: false,
      tooltip: baseTooltip(),
      legend: { textStyle: { color: "#d9d4c4" }, top: 0 },
      grid: { left: 58, right: useTemp || useRate ? 58 : 24, top: 36, bottom: 58 },
      dataZoom: [{ type: "inside" }, { type: "slider", height: 18, bottom: 8 }],
      xAxis: timeAxis(),
      yAxis: [valueAxis("МПа"), { ...valueAxis("м³/сут"), show: useRate }, { ...valueAxis("°C"), show: useTemp, position: "right", offset: useRate ? 48 : 0 }],
      series: active.map((item) => ({
        name: item.label,
        type: "line",
        showSymbol: false,
        yAxisIndex: item.axis,
        data: plot(points, (point) => point[item.key]),
        lineStyle: { width: 1.5, color: item.color },
        itemStyle: { color: item.color },
        markLine: cursor ? { symbol: "none", data: [{ xAxis: cursor }], lineStyle: { color: "#ebe6d6", type: "dashed", opacity: 0.45 }, label: { show: false } } : undefined,
      })),
    };
  }, [analysis.wells, compare, cursor, dataset.wells, on, points, range]);

  if (!well) return <Empty>Нет данных по скважине.</Empty>;

  return (
    <div className="grid gap-4">
      <Panel
        title="Телеметрия"
        action={
          <Button
            size="sm"
            variant="outline"
            onClick={() => exportRows(wellId, points)}
          >
            CSV
          </Button>
        }
      >
        <div className="mb-3 flex flex-wrap gap-2">
          {SERIES.map((item) => (
            <Chip key={item.key} active={compare ? compare === item.key : on[item.key]} onClick={() => {
              if (compare) setCompare(item.key);
              else setOn((prev) => ({ ...prev, [item.key]: !prev[item.key] }));
            }}>
              <span className="mr-1 inline-block size-2 rounded-full" style={{ background: item.color }} />
              {item.label}
            </Chip>
          ))}
          <span className="mx-1 hidden h-6 w-px bg-border sm:inline-block" />
          <Chip active={bucket === "raw"} onClick={() => setBucket("raw")}>как в файле</Chip>
          <Chip active={bucket === "day"} onClick={() => setBucket("day")}>среднее за сутки</Chip>
          <Chip active={compare != null} onClick={() => setCompare(compare ? null : "q")}>все скважины</Chip>
        </div>
        <div className="h-80 md:h-[480px]">
          <EChart option={option} label="График выбранных параметров телеметрии" />
        </div>
        {compare ? <p className="mt-2 text-xs text-muted-foreground">Сравнение идёт по суточным средним, чтобы скважины легли на одну ось времени.{compare === "q" ? " Если дебиты отличаются в десятки раз, ось логарифмическая." : ""}</p> : null}
      </Panel>
      <Panel title="Статистика периода">
        <div className="overflow-x-auto">
          <table className="w-full min-w-[640px] text-left text-sm">
            <thead className="text-[11px] uppercase tracking-wider text-muted-foreground">
              <tr>
                {["Параметр", "Мин", "Медиана", "Макс", "СКО", "Ед."].map((head) => (
                  <th key={head} className="py-2 pr-3 font-medium">{head}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {SERIES.map((item) => {
                const values = points.map((point) => point[item.key]).filter((value): value is number => value != null);
                return (
                  <tr key={item.key} className="border-t border-border/60">
                    <td className="py-1.5 pr-3">{item.label}</td>
                    <td className="py-1.5 pr-3 font-mono tabular-nums">{fmt(values.length ? Math.min(...values) : null, 2)}</td>
                    <td className="py-1.5 pr-3 font-mono tabular-nums">{fmt(values.length ? median(values) : null, 2)}</td>
                    <td className="py-1.5 pr-3 font-mono tabular-nums">{fmt(values.length ? Math.max(...values) : null, 2)}</td>
                    <td className="py-1.5 pr-3 font-mono tabular-nums">{fmt(values.length ? stddev(values) : null, 3)}</td>
                    <td className="py-1.5 text-muted-foreground">{item.unit}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </Panel>
    </div>
  );
}

function exportRows(wellId: string, points: DerivedPoint[]) {
  downloadCsv(
    `vdp-${wellId}.csv`,
    ["Дата", "Рзаб_МПа", "Тзаб_C", "Руст_МПа", "Туст_C", "Дебит_м3сут", "Рвдп_МПа", "Рпл_МПа", "Депрессия_МПа", "Кпрод"],
    points.map((point) => [
      formatStamp(point.t),
      point.pBh,
      point.tBh,
      point.pWh,
      point.tWh,
      point.q,
      point.pPerf,
      point.pRes,
      point.drawdown,
      point.pi,
    ]),
  );
}

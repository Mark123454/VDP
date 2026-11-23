"use client";

import { useMemo } from "react";
import type { EChartsCoreOption } from "echarts";
import type { WellAnalysis } from "@/lib/analyze";
import { fmt, formatStamp } from "@/lib/format";
import { C, valueAxis, baseTooltip } from "./chart-theme";
import { EChart } from "./echart";
import { Empty, Panel } from "./bits";

export function Diagnostics({
  analysis,
  onJump,
}: {
  analysis: WellAnalysis | undefined;
  onJump: (t: number) => void;
}) {
  const points = analysis?.derived ?? [];
  const flowing = points.filter((point) => analysis && point.q != null && point.q > analysis.shutMax && point.pPerf != null);
  const stride = Math.max(1, Math.ceil(flowing.length / 1800));
  const sample = flowing.filter((_, index) => index % stride === 0);

  const cross = useMemo<EChartsCoreOption>(() => ({
    animation: false,
    tooltip: baseTooltip(),
    grid: { left: 58, right: 16, top: 24, bottom: 36 },
    xAxis: { ...valueAxis(""), name: "Дебит, м³/сут" },
    yAxis: { ...valueAxis(""), name: "Рвдп, МПа" },
    visualMap: {
      show: false,
      dimension: 2,
      min: sample[0]?.t ?? 0,
      max: sample[sample.length - 1]?.t ?? 1,
      inRange: { color: ["#7eb6d6", "#e2a23a", "#e07a5f"] },
    },
    series: [{ type: "scatter", symbolSize: 5, data: sample.map((point) => [point.q, point.pPerf, point.t]) }],
  }), [sample]);

  const temps = useMemo<EChartsCoreOption>(() => ({
    animation: false,
    tooltip: baseTooltip(),
    grid: { left: 52, right: 16, top: 24, bottom: 36 },
    xAxis: { ...valueAxis(""), name: "Дебит, м³/сут" },
    yAxis: { ...valueAxis(""), name: "Туст, °C" },
    series: [{ type: "scatter", symbolSize: 5, itemStyle: { color: C.twh }, data: sample.filter((point) => point.tWh != null).map((point) => [point.q, point.tWh]) }],
  }), [sample]);

  if (!analysis) return <Empty>Нет скважины.</Empty>;
  const corr = analysis.correlations;

  return (
    <div className="grid gap-4">
      <div className="grid gap-2 md:grid-cols-4">
        <Fact label="Полнота ряда" value={`${fmt(analysis.quality.completeness * 100, 1)}%`} />
        <Fact label="Дебит и Рвдп" value={fmt(corr.qP, 2)} hint="Корреляция Пирсона на рабочих точках" />
        <Fact label="Дебит и Туст" value={fmt(corr.qT, 2)} />
        <Fact label="Рзаб и Руст" value={fmt(corr.pBhPwh, 2)} />
      </div>
      <div className="grid gap-4 lg:grid-cols-2">
        <Panel title="Дебит против давления на ВДП">
          <div className="h-72"><EChart option={cross} label="Кроссплот дебита и забойного давления" /></div>
          <p className="mt-2 text-xs text-muted-foreground">Цвет — время: от раннего холодного к позднему тёплому. Уход линии вниз при том же дебите — рост депрессии.</p>
        </Panel>
        <Panel title="Устьевая температура и дебит">
          <div className="h-72"><EChart option={temps} label="Кроссплот температуры и дебита" /></div>
          <p className="mt-2 text-xs text-muted-foreground">На нефти устье обычно теплеет с дебитом. Плоское облако при живом дебите похоже на залипший датчик температуры.</p>
        </Panel>
      </div>
      <Panel title="Ствол от датчика до устья">
        <p className="text-sm leading-relaxed text-muted-foreground">
          Медианный перепад Рзаб − Руст на работе: {fmt(analysis.friction.totalDrop, 2)} МПа.
          Гидростатика той же плотности, что и в пересчёте на ВДП, на всю глубину датчика дала бы {fmt(analysis.friction.hydrostatic, 2)} МПа.
          Остаток {fmt(analysis.friction.residual, 2)} МПа. Отрицательный остаток для нефти обычен: в НКТ смесь легче дегазированной нефти, а короткая поправка датчик–ВДП считается по пластовой плотности.
        </p>
      </Panel>
      <Panel title={`События · ${analysis.anomalies.length}`}>
        {analysis.anomalies.length ? (
          <ul className="grid gap-2">
            {analysis.anomalies.slice(0, 40).map((item) => (
              <li key={item.id} className="flex flex-wrap items-center justify-between gap-2 border-b border-border/60 pb-2 text-sm">
                <div>
                  <div className="text-xs uppercase tracking-wider text-muted-foreground">{formatStamp(item.t)}{item.tEnd !== item.t ? ` — ${formatStamp(item.tEnd)}` : ""}</div>
                  <div>{item.message}</div>
                </div>
                <ButtonJump onClick={() => onJump(item.t)} />
              </li>
            ))}
          </ul>
        ) : (
          <Empty>Явных выбросов, залипаний и дыр в ряде нет.</Empty>
        )}
      </Panel>
    </div>
  );
}

function Fact({ label, value, hint }: { label: string; value: string; hint?: string }) {
  return (
    <div className="rounded-lg border border-border bg-card px-3 py-2" title={hint}>
      <div className="text-[11px] uppercase tracking-[0.14em] text-muted-foreground">{label}</div>
      <div className="font-mono text-lg tabular-nums">{value}</div>
    </div>
  );
}

function ButtonJump({ onClick }: { onClick: () => void }) {
  return (
    <button type="button" onClick={onClick} className="rounded-md border border-border px-2 py-1 text-xs hover:bg-accent">
      На график
    </button>
  );
}

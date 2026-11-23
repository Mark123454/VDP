"use client";

import { useMemo, useState } from "react";
import type { EChartsCoreOption } from "echarts";
import type { WellAnalysis } from "@/lib/analyze";
import { fmt, fmtCompact, formatStamp, parseDayInput } from "@/lib/format";
import { iprCurve, vogelCurve, type Campaign } from "@/lib/gki";
import type { Dataset } from "@/lib/types";
import { Button } from "./ui/button";
import { Input } from "./ui/input";
import { C, timeAxis, valueAxis, baseTooltip } from "./chart-theme";
import { EChart } from "./echart";
import { Empty, Panel } from "./bits";

export function GkiPanel({
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
  const campaigns = analysis?.campaigns ?? [];
  const [id, setId] = useState<string | null>(null);
  const campaign = campaigns.find((item) => item.id === (id ?? campaigns[campaigns.length - 1]?.id)) ?? null;
  if (!analysis) return <Empty>Нет скважины.</Empty>;

  return (
    <div className="grid gap-4">
      <p className="text-sm text-muted-foreground">
        ГКИ здесь — исследование на установившихся режимах: несколько стабильных дебитов подряд и индикаторная диаграмма.
        Состав газа и конденсатный фактор из телеметрии не восстанавливаются, их место — в примечании журнала.
      </p>
      <div className="grid gap-4 xl:grid-cols-[260px_minmax(0,1fr)]">
        <Panel title={`Исследования · ${campaigns.length}`}>
          {campaigns.length ? (
            <ul className="grid gap-2">
              {campaigns.map((item) => (
                <li key={item.id}>
                  <button type="button" onClick={() => setId(item.id)} className={`w-full rounded-lg border px-3 py-2 text-left text-sm ${item.id === campaign?.id ? "border-primary/60 bg-primary/10" : "border-border hover:bg-accent"}`}>
                    <div className="font-medium">{formatStamp(item.start, false)}</div>
                    <div className="mt-1 text-xs text-muted-foreground">{item.steps.length} режима · {item.fit?.jAnchored != null ? `Кпрод ${fmtCompact(item.fit.jAnchored, 1)}` : item.fit?.aof != null ? `AOF ${fmtCompact(item.fit.aof, 0)}` : "без модели"}</div>
                  </button>
                </li>
              ))}
            </ul>
          ) : (
            <Empty>Не нашлось серии из трёх и более стабильных режимов длительностью от 5 до 80 часов.</Empty>
          )}
        </Panel>
        {campaign ? <Diagram campaign={campaign} /> : <Empty>Выберите исследование.</Empty>}
      </div>
      <Trend analysis={analysis} dataset={dataset} wellId={wellId} />
      <Journal dataset={dataset} wellId={wellId} onChange={onChange} />
    </div>
  );
}

function Diagram({ campaign }: { campaign: Campaign }) {
  const fit = campaign.fit;
  const option = useMemo<EChartsCoreOption>(() => {
    const qMax = Math.max(...campaign.steps.map((step) => step.q)) * 1.15;
    const line = fit ? iprCurve(fit, qMax) : [];
    const pr = campaign.steps.find((step) => step.pRes != null)?.pRes ?? fit?.pIntercept ?? null;
    const vogel = fit?.vogelQmax && pr ? vogelCurve(pr, fit.vogelQmax) : [];
    return {
      animation: false,
      tooltip: baseTooltip(),
      legend: { textStyle: { color: "#d9d4c4" }, top: 0 },
      grid: { left: 58, right: 16, top: 32, bottom: 36 },
      xAxis: { ...valueAxis("м³/сут"), name: "Дебит, м³/сут" },
      yAxis: { ...valueAxis("МПа"), name: "Рвдп, МПа" },
      series: [
        { name: "режимы", type: "scatter", symbolSize: 14, data: campaign.steps.filter((step) => step.pPerf != null).map((step) => [step.q, step.pPerf]), itemStyle: { color: C.pbh } },
        { name: "прямая", type: "line", showSymbol: false, data: line.map((point) => [point.q, point.p]), lineStyle: { color: C.pperf } },
        { name: "Вогель", type: "line", showSymbol: false, data: vogel.map((point) => [point.q, point.p]), lineStyle: { color: C.q, type: "dashed" } },
      ],
    };
  }, [campaign, fit]);

  return (
    <div className="grid gap-4">
      <Panel title={`${formatStamp(campaign.start)} — ${formatStamp(campaign.end, false)}`}>
        <div className="grid grid-cols-2 gap-2 md:grid-cols-4">
          <Mini label="Кпрод при Рпл" value={fmtCompact(fit?.jAnchored, 2)} unit="м³/сут/МПа" />
          <Mini label="Рпл по отсечке" value={fmt(fit?.pIntercept, 2)} unit="МПа" />
          <Mini label="Кпрод по отсечке" value={fmtCompact(fit?.jIntercept, 2)} unit="м³/сут/МПа" />
          <Mini label={fit?.kind === "gas" ? "AOF" : "Qmax Вогеля"} value={fmtCompact(fit?.kind === "gas" ? fit?.aof : fit?.vogelQmax, 0)} unit="м³/сут" />
        </div>
        <div className="mt-3 h-80"><EChart option={option} label="Индикаторная диаграмма" /></div>
        {fit?.notes.length ? <ul className="mt-3 list-disc pl-4 text-sm text-muted-foreground">{fit.notes.map((note) => <li key={note}>{note}</li>)}</ul> : null}
      </Panel>
      <Panel title="Режимы">
        <div className="overflow-x-auto">
          <table className="w-full min-w-[680px] text-left text-sm">
            <thead className="text-[11px] uppercase tracking-wider text-muted-foreground">
              <tr>{["Начало", "Часы", "Дебит", "Рвдп", "Рпл", "Депрессия", "Кпрод"].map((head) => <th key={head} className="py-2 pr-3 font-medium">{head}</th>)}</tr>
            </thead>
            <tbody>
              {campaign.steps.map((step) => (
                <tr key={step.start} className="border-t border-border/60">
                  <td className="py-1.5 pr-3">{formatStamp(step.start)}</td>
                  <td className="py-1.5 pr-3 font-mono">{fmt((step.end - step.start) / 3_600_000, 1)}</td>
                  <td className="py-1.5 pr-3 font-mono">{fmt(step.q, 1)}</td>
                  <td className="py-1.5 pr-3 font-mono">{fmt(step.pPerf, 2)}</td>
                  <td className="py-1.5 pr-3 font-mono">{fmt(step.pRes, 2)}</td>
                  <td className="py-1.5 pr-3 font-mono">{fmt(step.drawdown, 2)}</td>
                  <td className="py-1.5 font-mono">{fmtCompact(step.pi, 2)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Panel>
    </div>
  );
}

function Trend({ analysis, dataset, wellId }: { analysis: WellAnalysis; dataset: Dataset; wellId: string }) {
  const journal = dataset.journalGki.filter((item) => item.wellId === wellId);
  const option = useMemo<EChartsCoreOption>(() => ({
    animation: false,
    tooltip: baseTooltip(),
    legend: { textStyle: { color: "#d9d4c4" }, top: 0 },
    grid: { left: 64, right: 16, top: 32, bottom: 28 },
    xAxis: timeAxis(),
    yAxis: valueAxis(analysis.well.fluid === "gas" ? "м³/сут" : "м³/сут/МПа"),
    series: analysis.well.fluid === "gas"
      ? [
          { name: "AOF по телеметрии", type: "line", data: analysis.campaigns.filter((item) => item.fit?.aof != null).map((item) => [item.start, item.fit!.aof]), itemStyle: { color: C.pbh } },
          { name: "AOF журнал", type: "scatter", symbol: "diamond", symbolSize: 12, data: journal.filter((item) => item.aof != null).map((item) => [item.t, item.aof]), itemStyle: { color: C.q } },
        ]
      : [
          { name: "Кпрод по телеметрии", type: "line", data: analysis.campaigns.filter((item) => item.fit?.jAnchored != null).map((item) => [item.start, item.fit!.jAnchored]), itemStyle: { color: C.pbh } },
          { name: "Журнал", type: "scatter", symbol: "diamond", symbolSize: 12, data: journal.filter((item) => item.productivity != null).map((item) => [item.t, item.productivity]), itemStyle: { color: C.q } },
        ],
  }), [analysis, journal]);
  return (
    <Panel title="Год к году">
      <div className="h-64"><EChart option={option} label="Динамика продуктивности по годам" /></div>
    </Panel>
  );
}

function Journal({ dataset, wellId, onChange }: { dataset: Dataset; wellId: string; onChange: (dataset: Dataset) => void }) {
  const rows = dataset.journalGki.filter((item) => item.wellId === wellId).sort((a, b) => a.t - b.t);
  const [day, setDay] = useState("2026-09-11");
  const [pi, setPi] = useState("");
  const [aof, setAof] = useState("");
  const [pres, setPres] = useState("");
  const [note, setNote] = useState("");
  return (
    <Panel title="Журнал годовых ГКИ">
      <div className="overflow-x-auto">
        <table className="w-full text-left text-sm">
          <thead className="text-[11px] uppercase tracking-wider text-muted-foreground">
            <tr>{["Дата", "Кпрод", "AOF", "Рпл", "Примечание"].map((head) => <th key={head} className="py-2 pr-3 font-medium">{head}</th>)}</tr>
          </thead>
          <tbody>
            {rows.map((row) => (
              <tr key={row.t} className="border-t border-border/60">
                <td className="py-1.5 pr-3">{formatStamp(row.t, false)}</td>
                <td className="py-1.5 pr-3 font-mono">{fmtCompact(row.productivity, 1)}</td>
                <td className="py-1.5 pr-3 font-mono">{fmtCompact(row.aof, 0)}</td>
                <td className="py-1.5 pr-3 font-mono">{fmt(row.pRes, 2)}</td>
                <td className="py-1.5 text-muted-foreground">{row.note}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <form
        className="mt-4 grid gap-2 md:grid-cols-5"
        onSubmit={(event) => {
          event.preventDefault();
          const t = parseDayInput(day);
          if (t == null) return;
          const num = (value: string) => {
            const parsed = Number(value.replace(",", "."));
            return value.trim() && Number.isFinite(parsed) ? parsed : null;
          };
          onChange({ ...dataset, journalGki: [...dataset.journalGki, { wellId, t, productivity: num(pi), aof: num(aof), pRes: num(pres), note }] });
        }}
      >
        <Input type="date" value={day} onChange={(event) => setDay(event.target.value)} required />
        <Input placeholder="Кпрод" value={pi} onChange={(event) => setPi(event.target.value)} />
        <Input placeholder="AOF, м³/сут" value={aof} onChange={(event) => setAof(event.target.value)} />
        <Input placeholder="Рпл, МПа" value={pres} onChange={(event) => setPres(event.target.value)} />
        <Button type="submit" variant="secondary">Добавить</Button>
        <Input className="md:col-span-5" placeholder="примечание: пробы, КГФ, штуцер" value={note} onChange={(event) => setNote(event.target.value)} />
      </form>
    </Panel>
  );
}

function Mini({ label, value, unit }: { label: string; value: string; unit?: string }) {
  return (
    <div className="rounded-md bg-[#191c14] px-2.5 py-2">
      <div className="text-[10px] uppercase tracking-[0.14em] text-muted-foreground">{label}</div>
      <div className="font-mono text-base tabular-nums">{value} {unit ? <span className="text-xs text-muted-foreground">{unit}</span> : null}</div>
    </div>
  );
}

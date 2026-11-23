"use client";

import { useMemo, useState } from "react";
import type { EChartsCoreOption } from "echarts";
import type { WellAnalysis } from "@/lib/analyze";
import { fmt, formatStamp, parseDayInput } from "@/lib/format";
import { interpretBuildup, type BuildupResult } from "@/lib/kvd";
import type { Dataset } from "@/lib/types";
import { Button } from "./ui/button";
import { Input } from "./ui/input";
import { C, timeAxis, valueAxis, baseTooltip } from "./chart-theme";
import { EChart } from "./echart";
import { Empty, Panel } from "./bits";

export function KvdPanel({
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
  const buildups = analysis?.buildups ?? [];
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [minH, setMinH] = useState("");
  const [maxH, setMaxH] = useState("");
  const selected = buildups.find((item) => item.event.id === (selectedId ?? buildups[buildups.length - 1]?.event.id)) ?? null;
  const shown = useMemo(() => {
    if (!selected || !analysis) return selected;
    const min = Number(minH.replace(",", "."));
    const max = Number(maxH.replace(",", "."));
    if (selectedId === selected.event.id && Number.isFinite(min) && Number.isFinite(max) && max > min) {
      return interpretBuildup(selected.event, analysis.well, { dtMin: min, dtMax: max });
    }
    return selected;
  }, [analysis, maxH, minH, selected, selectedId]);

  if (!analysis) return <Empty>Нет скважины.</Empty>;

  return (
    <div className="grid gap-4">
      <div className="grid gap-4 xl:grid-cols-[280px_minmax(0,1fr)]">
        <Panel title={`Остановки · ${buildups.length}`}>
          {buildups.length ? (
            <ul className="grid max-h-[640px] gap-2 overflow-auto pr-1">
              {buildups.map((item) => (
                <li key={item.event.id}>
                  <button
                    type="button"
                    onClick={() => {
                      setSelectedId(item.event.id);
                      setMinH("");
                      setMaxH("");
                    }}
                    className={`w-full rounded-lg border px-3 py-2 text-left text-sm ${item.event.id === shown?.event.id ? "border-primary/60 bg-primary/10" : "border-border hover:bg-accent"}`}
                  >
                    <div className="font-medium">{formatStamp(item.event.start, false)}</div>
                    <div className="mt-1 text-xs text-muted-foreground">
                      {fmt((item.event.end - item.event.start) / 3_600_000, 0)} ч · {item.confidence}
                      {item.permeability != null ? ` · ${fmt(item.permeability, 0)} мД` : ""}
                    </div>
                  </button>
                </li>
              ))}
            </ul>
          ) : (
            <Empty>Длинных остановок с ростом давления не найдено. Нужен дебит около нуля хотя бы 8 часов.</Empty>
          )}
        </Panel>
        {shown ? <Report result={shown} onWindow={(min, max) => { setSelectedId(shown.event.id); setMinH(String(min)); setMaxH(String(max)); }} reset={() => { setMinH(""); setMaxH(""); }} /> : <Empty>Выберите остановку.</Empty>}
      </div>
      <Journal dataset={dataset} wellId={wellId} onChange={onChange} telemetry={buildups} />
    </div>
  );
}

function Report({ result, onWindow, reset }: { result: BuildupResult; onWindow: (min: number, max: number) => void; reset: () => void }) {
  const history = useMemo<EChartsCoreOption>(() => ({
    animation: false,
    tooltip: baseTooltip(),
    legend: { textStyle: { color: "#d9d4c4" }, top: 0 },
    grid: { left: 52, right: 52, top: 32, bottom: 28 },
    xAxis: timeAxis(),
    yAxis: [valueAxis("МПа"), valueAxis("м³/сут")],
    series: [
      { name: result.event.datum === "vdp" ? "Рвдп" : "Рзаб", type: "line", showSymbol: false, data: result.event.history.map((p) => [p.t, p.p]), lineStyle: { color: C.pperf } },
      { name: "Дебит", type: "line", yAxisIndex: 1, showSymbol: false, data: result.event.history.map((p) => [p.t, p.q]), lineStyle: { color: C.q } },
      { type: "line", markLine: { symbol: "none", data: [{ xAxis: result.event.start }], lineStyle: { color: C.pbh }, label: { formatter: "стоп", color: C.axis } }, data: [] },
    ],
  }), [result]);

  const loglog = useMemo<EChartsCoreOption>(() => ({
    animation: false,
    tooltip: baseTooltip(),
    legend: { textStyle: { color: "#d9d4c4" }, top: 0 },
    grid: { left: 58, right: 16, top: 32, bottom: 36 },
    xAxis: { type: "log", name: "Δt, ч", ...logAxis() },
    yAxis: { type: "log", name: result.fluid === "gas" ? "Δ(P²), МПа²" : "ΔP, МПа", ...logAxis() },
    series: [
      { name: result.fluid === "gas" ? "Δ(P²)" : "ΔP", type: "line", showSymbol: false, data: result.loglog.filter((p) => p.dp > 0).map((p) => [p.dt, p.dp]), lineStyle: { color: C.pperf } },
      { name: "производная", type: "line", showSymbol: false, data: result.loglog.filter((p) => p.der != null).map((p) => [p.dt, p.der]), lineStyle: { color: C.der } },
    ],
  }), [result]);

  const horner = useMemo<EChartsCoreOption>(() => {
    const fit = result.slope != null && result.pStar != null
      ? result.horner.filter((p) => p.inWindow).map((p) => [p.x, (result.fluid === "gas" ? (result.pStar as number) ** 2 : (result.pStar as number)) - (result.slope as number) * p.x])
      : [];
    return {
      animation: false,
      tooltip: baseTooltip(),
      legend: { textStyle: { color: "#d9d4c4" }, top: 0 },
      grid: { left: 58, right: 16, top: 32, bottom: 36 },
      xAxis: { type: "value", name: "log10((tp+Δt)/Δt)", inverse: true, ...logAxis() },
      yAxis: { type: "value", name: result.fluid === "gas" ? "P², МПа²" : "P, МПа", scale: true, ...logAxis() },
      series: [
        { name: "точки", type: "scatter", data: result.horner.map((p) => [p.x, p.y, p.inWindow]), symbolSize: (value: number[]) => (value[2] ? 7 : 4), itemStyle: { color: C.pwh } },
        { name: "прямая", type: "line", showSymbol: false, data: fit, lineStyle: { color: C.pbh, width: 1.6 } },
      ],
    };
  }, [result]);

  return (
    <div className="grid gap-4">
      <Panel title={`${formatStamp(result.event.start)} · ${result.fluid === "gas" ? "газ, метод P²" : "нефть или вода"} · ${result.event.datum === "vdp" ? "давление на ВДП" : "давление датчика"}`}>
        <div className="grid grid-cols-2 gap-2 md:grid-cols-4 xl:grid-cols-6">
          <Stat label="Наклон" value={fmt(result.slope, 3)} unit={result.slopeUnit} />
          <Stat label="k" value={fmt(result.permeability, 1)} unit="мД" />
          <Stat label="Скин" value={fmt(result.skin, 2)} />
          <Stat label="P*" value={fmt(result.pStar, 2)} unit="МПа" />
          <Stat label="Радиус" value={fmt(result.radius, 0)} unit="м" />
          <Stat label="Достоверность" value={result.confidence} />
        </div>
        <div className="mt-3 flex flex-wrap items-end gap-2 text-xs text-muted-foreground">
          <label className="grid gap-1">Окно от, ч<Input className="w-24" value={minH(result)} onChange={(event) => onWindow(Number(event.target.value.replace(",", ".")), result.window.dtMax)} /></label>
          <label className="grid gap-1">до, ч<Input className="w-24" defaultValue={String(Math.round(result.window.dtMax * 10) / 10)} key={`${result.event.id}-${result.window.dtMax}`} onBlur={(event) => onWindow(result.window.dtMin, Number(event.target.value.replace(",", ".")))} /></label>
          <Button size="sm" variant="outline" type="button" onClick={reset}>Автоокно</Button>
          <span>tp = {fmt(result.event.tpHours, 0)} ч, q до остановки {fmt(result.event.qBefore, 1)} м³/сут, R² {fmt(result.r2, 3)}</span>
        </div>
        {result.notes.length ? <ul className="mt-3 list-disc pl-4 text-sm text-muted-foreground">{result.notes.map((note) => <li key={note}>{note}</li>)}</ul> : null}
      </Panel>
      <div className="grid gap-4 lg:grid-cols-2">
        <Panel title="Билогарифм"><div className="h-72"><EChart option={loglog} label="Билогарифмический график КВД" /></div></Panel>
        <Panel title="Хорнер"><div className="h-72"><EChart option={horner} label="График Хорнера" /></div></Panel>
      </div>
      <Panel title="Давление и дебит вокруг остановки"><div className="h-64"><EChart option={history} label="История остановки" /></div></Panel>
    </div>
  );
}

function minH(result: BuildupResult) {
  return String(Math.round(result.window.dtMin * 100) / 100);
}

function logAxis() {
  return {
    axisLine: { lineStyle: { color: "#3a3f30" } },
    axisLabel: { color: "#b7b39f", fontSize: 11 },
    splitLine: { lineStyle: { color: "rgba(235,230,214,0.06)" } },
    nameTextStyle: { color: "#b7b39f", fontSize: 11 },
  };
}

function Stat({ label, value, unit }: { label: string; value: string; unit?: string }) {
  return (
    <div className="rounded-md bg-[#191c14] px-2.5 py-2">
      <div className="text-[10px] uppercase tracking-[0.14em] text-muted-foreground">{label}</div>
      <div className="font-mono text-base tabular-nums">{value} {unit ? <span className="text-xs text-muted-foreground">{unit}</span> : null}</div>
    </div>
  );
}

function Journal({ dataset, wellId, onChange, telemetry }: { dataset: Dataset; wellId: string; onChange: (dataset: Dataset) => void; telemetry: BuildupResult[] }) {
  const rows = dataset.journalKvd.filter((item) => item.wellId === wellId).sort((a, b) => a.t - b.t);
  const [day, setDay] = useState("2026-03-16");
  const [k, setK] = useState("");
  const [skin, setSkin] = useState("");
  const [pStar, setP] = useState("");
  const [note, setNote] = useState("");
  const option = useMemo<EChartsCoreOption>(() => ({
    animation: false,
    tooltip: baseTooltip(),
    legend: { textStyle: { color: "#d9d4c4" }, top: 0 },
    grid: { left: 52, right: 16, top: 32, bottom: 28 },
    xAxis: timeAxis(),
    yAxis: valueAxis("мД"),
    series: [
      { name: "Телеметрия", type: "scatter", symbolSize: 10, data: telemetry.filter((item) => item.permeability != null).map((item) => [item.event.start, item.permeability]), itemStyle: { color: C.pbh } },
      { name: "Журнал", type: "scatter", symbol: "diamond", symbolSize: 11, data: rows.filter((item) => item.permeability != null).map((item) => [item.t, item.permeability]), itemStyle: { color: C.q } },
    ],
  }), [rows, telemetry]);

  return (
    <Panel title="Годовой журнал КВД рядом с расчётом по телеметрии">
      <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_280px]">
        <div>
          <div className="h-56"><EChart option={option} label="Сравнение проницаемости по журналу и телеметрии" /></div>
          <div className="mt-3 overflow-x-auto">
            <table className="w-full text-left text-sm">
              <thead className="text-[11px] uppercase tracking-wider text-muted-foreground">
                <tr>{["Дата", "k, мД", "Скин", "P*, МПа", "Примечание"].map((head) => <th key={head} className="py-2 pr-3 font-medium">{head}</th>)}</tr>
              </thead>
              <tbody>
                {rows.map((row) => (
                  <tr key={row.t} className="border-t border-border/60">
                    <td className="py-1.5 pr-3">{formatStamp(row.t, false)}</td>
                    <td className="py-1.5 pr-3 font-mono">{fmt(row.permeability, 1)}</td>
                    <td className="py-1.5 pr-3 font-mono">{fmt(row.skin, 1)}</td>
                    <td className="py-1.5 pr-3 font-mono">{fmt(row.pStar, 2)}</td>
                    <td className="py-1.5 text-muted-foreground">{row.note}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
        <form
          className="grid content-start gap-2"
          onSubmit={(event) => {
            event.preventDefault();
            const t = parseDayInput(day);
            if (t == null) return;
            const num = (value: string) => {
              const parsed = Number(value.replace(",", "."));
              return value.trim() && Number.isFinite(parsed) ? parsed : null;
            };
            onChange({
              ...dataset,
              journalKvd: [...dataset.journalKvd, { wellId, t, permeability: num(k), skin: num(skin), pStar: num(pStar), note }],
            });
          }}
        >
          <p className="text-sm text-muted-foreground">Официальный результат годовой КВД, если он уже есть в отчёте.</p>
          <Input type="date" value={day} onChange={(event) => setDay(event.target.value)} required />
          <Input placeholder="k, мД" value={k} onChange={(event) => setK(event.target.value)} />
          <Input placeholder="скин" value={skin} onChange={(event) => setSkin(event.target.value)} />
          <Input placeholder="P*, МПа" value={pStar} onChange={(event) => setP(event.target.value)} />
          <Input placeholder="примечание" value={note} onChange={(event) => setNote(event.target.value)} />
          <Button type="submit" variant="secondary">Записать в журнал</Button>
        </form>
      </div>
    </Panel>
  );
}

"use client";

import { useEffect, useMemo, useState } from "react";
import { Activity, BookOpen, Droplets, FileSpreadsheet, Gauge, Layers, Stethoscope, Thermometer, Upload, Waves } from "lucide-react";
import { del, get, set } from "idb-keyval";
import { analyzeDataset, type Analysis } from "@/lib/analyze";
import { blankTemplate, datasetToSheetRows, downloadWorkbook, parseWorkbook } from "@/lib/excel";
import { buildSample } from "@/lib/sample";
import type { Dataset, PressureUnit, RateUnit } from "@/lib/types";
import { PRESSURE_LABEL, RATE_LABEL } from "@/lib/units";
import { Button } from "./ui/button";
import { Dialog, DialogContent, DialogDescription, DialogTitle } from "./ui/dialog";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "./ui/tabs";
import { Diagnostics } from "./diagnostics";
import { GkiPanel } from "./gki-panel";
import { KvdPanel } from "./kvd-panel";
import { Method } from "./method";
import { Overview } from "./overview";
import { Passport } from "./passport";
import { Reservoir } from "./reservoir";
import { Telemetry } from "./telemetry";
import { Vdp } from "./vdp";

const STORAGE_KEY = "vdp-dataset-v1";

const TABS = [
  { id: "overview", label: "Обзор", icon: Activity },
  { id: "telemetry", label: "Телеметрия", icon: Waves },
  { id: "vdp", label: "На ВДП", icon: Gauge },
  { id: "reservoir", label: "Пласт", icon: Layers },
  { id: "kvd", label: "КВД", icon: Thermometer },
  { id: "gki", label: "ГКИ", icon: Droplets },
  { id: "diagnostics", label: "Диагностика", icon: Stethoscope },
  { id: "passport", label: "Паспорт", icon: FileSpreadsheet },
  { id: "method", label: "Методика", icon: BookOpen },
];

export default function Dashboard() {
  const [dataset, setDataset] = useState<Dataset | null>(null);
  const [wellId, setWellId] = useState<string | null>(null);
  const [preset, setPreset] = useState<"all" | "90" | "365" | "730">("all");
  const [tab, setTab] = useState("overview");
  const [cursor, setCursor] = useState<number | null>(null);
  const [importOpen, setImportOpen] = useState(false);

  useEffect(() => {
    window.scrollTo({ top: 0 });
  }, [tab]);

  useEffect(() => {
    let cancel = false;
    get<Dataset>(STORAGE_KEY)
      .then((saved) => {
        if (cancel) return;
        if (saved?.version === 1 && saved.wells?.length) setDataset(saved);
        else setDataset(buildSample());
      })
      .catch(() => {
        if (!cancel) setDataset(buildSample());
      });
    return () => {
      cancel = true;
    };
  }, []);

  const analysis = useMemo<Analysis | null>(() => (dataset ? analyzeDataset(dataset) : null), [dataset]);
  const activeId = wellId && dataset?.wells.some((well) => well.id === wellId) ? wellId : dataset?.wells[0]?.id ?? "";

  const range = useMemo<[number, number] | null>(() => {
    if (!dataset || preset === "all") return null;
    const ends = dataset.wells.flatMap((well) => {
      const series = dataset.series[well.id] ?? [];
      return series.length ? [series[series.length - 1].t] : [];
    });
    if (!ends.length) return null;
    const end = Math.max(...ends);
    const days = preset === "90" ? 90 : preset === "365" ? 365 : 730;
    return [end - days * 86_400_000, end];
  }, [dataset, preset]);

  function commit(next: Dataset) {
    setDataset(next);
    set(STORAGE_KEY, next).catch(() => undefined);
  }

  if (!dataset || !analysis) {
    return (
      <main className="grid min-h-screen place-items-center px-6">
        <div className="max-w-sm text-center">
          <div className="text-xs uppercase tracking-[0.22em] text-primary">ВДП</div>
          <p className="mt-3 text-sm text-muted-foreground">Собираю ряд и считаю пересчёт, КВД и ГКИ.</p>
        </div>
      </main>
    );
  }

  const well = analysis.wells[activeId];

  return (
    <main className="min-h-screen">
      <header className="border-b border-border bg-[#12140e]/90 px-4 py-3 backdrop-blur md:px-6">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="flex items-center gap-3">
            <div className="grid h-10 w-10 place-items-center rounded-lg border border-primary/40 bg-primary/10 font-mono text-xs text-primary">ВДП</div>
            <div>
              <div className="text-sm font-semibold tracking-tight">Телеметрия на верхние дыры</div>
              <div className="text-xs text-muted-foreground">{dataset.sourceName} · {PRESSURE_LABEL[dataset.sourceUnits.pressure]} → МПа · {RATE_LABEL[dataset.sourceUnits.rate]} → м³/сут</div>
            </div>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <select className="h-9 rounded-md border border-border bg-card px-2 text-sm" value={preset} onChange={(event) => setPreset(event.target.value as typeof preset)} aria-label="Период">
              <option value="all">весь ряд</option>
              <option value="90">90 суток</option>
              <option value="365">год</option>
              <option value="730">два года</option>
            </select>
            <Button variant="outline" onClick={() => downloadWorkbook(blankTemplate(), "shablon-telemetriya.xlsx")}>Шаблон</Button>
            <Button onClick={() => setImportOpen(true)}><Upload /> Excel</Button>
          </div>
        </div>
        <div className="mt-3 flex gap-2 overflow-x-auto pb-1">
          {dataset.wells.map((item) => (
            <button
              key={item.id}
              type="button"
              onClick={() => setWellId(item.id)}
              className={`shrink-0 rounded-full border px-3 py-1 text-sm ${item.id === activeId ? "border-primary/70 bg-primary/15" : "border-border text-muted-foreground hover:bg-accent"}`}
            >
              {item.id}
            </button>
          ))}
        </div>
      </header>
      {dataset.isSample ? (
        <div className="flex flex-wrap items-center gap-x-4 gap-y-1 border-b border-border bg-[#231f14] px-4 py-2 text-sm text-amber-100/90 md:px-6">
          <span>Учебное месторождение, четыре скважины с января 2023 по ноябрь 2026. Числа синтетические. Свой Excel заменяет набор целиком.</span>
          <button type="button" className="underline" onClick={() => downloadWorkbook(datasetToSheetRows(dataset), "uchebnyy-nabor.xlsx")}>Скачать этот набор</button>
          <button
            type="button"
            className="underline"
            onClick={() => {
              del(STORAGE_KEY).catch(() => undefined);
              setDataset(buildSample());
            }}
          >
            Сбросить правки
          </button>
        </div>
      ) : null}
      <Tabs value={tab} onValueChange={setTab} className="md:grid md:grid-cols-[220px_minmax(0,1fr)]">
        <TabsList className="flex gap-1 overflow-x-auto border-b border-border p-2 md:flex md:flex-col md:border-b-0 md:border-r md:p-3">
          {TABS.map((item) => (
            <TabsTrigger key={item.id} value={item.id} className="shrink-0 md:w-full">
              <item.icon />
              {item.label}
            </TabsTrigger>
          ))}
        </TabsList>
        <div className="min-w-0 px-3 py-4 md:px-6">
          <TabsContent value="overview"><Overview dataset={dataset} analysis={analysis} wellId={activeId} range={range} /></TabsContent>
          <TabsContent value="telemetry"><Telemetry dataset={dataset} analysis={analysis} wellId={activeId} range={range} cursor={cursor} /></TabsContent>
          <TabsContent value="vdp"><Vdp analysis={well} wellId={activeId} range={range} /></TabsContent>
          <TabsContent value="reservoir"><Reservoir dataset={dataset} analysis={well} wellId={activeId} onChange={commit} /></TabsContent>
          <TabsContent value="kvd"><KvdPanel dataset={dataset} analysis={well} wellId={activeId} onChange={commit} /></TabsContent>
          <TabsContent value="gki"><GkiPanel dataset={dataset} analysis={well} wellId={activeId} onChange={commit} /></TabsContent>
          <TabsContent value="diagnostics">
            <Diagnostics
              analysis={well}
              onJump={(t) => {
                setCursor(t);
                setPreset("all");
                setTab("telemetry");
              }}
            />
          </TabsContent>
          <TabsContent value="passport"><Passport dataset={dataset} wellId={activeId} onChange={commit} /></TabsContent>
          <TabsContent value="method"><Method /></TabsContent>
        </div>
      </Tabs>
      <ImportDialog
        open={importOpen}
        onOpenChange={setImportOpen}
        onDataset={(next) => {
          commit(next);
          setWellId(next.wells[0]?.id ?? null);
          setImportOpen(false);
        }}
      />
    </main>
  );
}

function ImportDialog({ open, onOpenChange, onDataset }: { open: boolean; onOpenChange: (open: boolean) => void; onDataset: (dataset: Dataset) => void }) {
  const [pressure, setPressure] = useState<PressureUnit>("MPa");
  const [rate, setRate] = useState<RateUnit>("m3d");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  function read(file: File) {
    setBusy(true);
    setError("");
    const reader = new FileReader();
    reader.onload = () => {
      try {
        const dataset = parseWorkbook(reader.result as ArrayBuffer, { pressure, rate }, file.name);
        onDataset(dataset);
      } catch (reason) {
        setError(reason instanceof Error ? reason.message : "Файл не разобран");
      } finally {
        setBusy(false);
      }
    };
    reader.onerror = () => {
      setBusy(false);
      setError("Не удалось прочитать файл");
    };
    reader.readAsArrayBuffer(file);
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogTitle>Книга Excel</DialogTitle>
        <DialogDescription>
          Листы Рзаб, Тзаб, Руст, Туст и Расходомер. В первом столбце дата и время, в шапке имена скважин. Паспорт, пластовое давление, КВД и ГКИ подхватятся, если лежат рядом.
        </DialogDescription>
        <div className="mt-4 grid gap-3 sm:grid-cols-2">
          <label className="grid gap-1 text-xs text-muted-foreground">
            Давление в файле
            <select className="h-9 rounded-md border border-input bg-[#161910] px-2 text-sm text-foreground" value={pressure} onChange={(event) => setPressure(event.target.value as PressureUnit)}>
              <option value="MPa">МПа</option>
              <option value="atm">атм</option>
              <option value="kgs">кгс/см²</option>
              <option value="bar">бар</option>
              <option value="psi">psi</option>
            </select>
          </label>
          <label className="grid gap-1 text-xs text-muted-foreground">
            Дебит в файле
            <select className="h-9 rounded-md border border-input bg-[#161910] px-2 text-sm text-foreground" value={rate} onChange={(event) => setRate(event.target.value as RateUnit)}>
              <option value="m3d">м³/сут</option>
              <option value="km3d">тыс. м³/сут</option>
              <option value="m3h">м³/ч</option>
            </select>
          </label>
        </div>
        <label
          className="mt-4 grid cursor-pointer place-items-center rounded-xl border border-dashed border-border px-4 py-8 text-center text-sm text-muted-foreground hover:bg-accent"
          onDragOver={(event) => event.preventDefault()}
          onDrop={(event) => {
            event.preventDefault();
            const file = event.dataTransfer.files?.[0];
            if (file) read(file);
          }}
        >
          {busy ? "Читаю книгу…" : "Перетащите .xlsx или выберите файл"}
          <input
            className="sr-only"
            type="file"
            accept=".xlsx,.xls"
            onChange={(event) => {
              const file = event.target.files?.[0];
              if (file) read(file);
            }}
          />
        </label>
        {error ? <p className="mt-3 text-sm text-destructive">{error}</p> : null}
      </DialogContent>
    </Dialog>
  );
}

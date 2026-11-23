"use client";

import { useEffect, useState } from "react";
import { PRESSURE_LABEL, RATE_LABEL, reinterpretUnits } from "@/lib/units";
import type { Dataset, FluidKind, PressureUnit, RateUnit, WellPassport } from "@/lib/types";
import { Input } from "./ui/input";
import { Panel } from "./bits";

export function Passport({ dataset, wellId, onChange }: { dataset: Dataset; wellId: string; onChange: (dataset: Dataset) => void }) {
  const well = dataset.wells.find((item) => item.id === wellId);
  if (!well) return null;
  return (
    <div className="grid gap-4">
      <Panel title={`Паспорт ${well.id}`}>
        <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
          <label className="grid gap-1 text-xs text-muted-foreground">
            Флюид
            <select
              className="h-9 rounded-md border border-input bg-[#161910] px-2 text-sm"
              value={well.fluid}
              onChange={(event) => patch(dataset, wellId, { fluid: event.target.value as FluidKind }, onChange)}
            >
              <option value="oil">нефть</option>
              <option value="gas">газ</option>
              <option value="water">вода</option>
            </select>
          </label>
          <Num label="Глубина датчика, MD" unit="м" value={well.sensorMd} onChange={(sensorMd) => patch(dataset, wellId, { sensorMd }, onChange)} />
          <Num label="Датчик, TVD" unit="м" value={well.sensorTvd} onChange={(sensorTvd) => patch(dataset, wellId, { sensorTvd }, onChange)} />
          <Num label="Верх дыр, MD" unit="м" value={well.perfTopMd} onChange={(perfTopMd) => patch(dataset, wellId, { perfTopMd }, onChange)} />
          <Num label="Верх дыр, TVD" unit="м" value={well.perfTopTvd} onChange={(perfTopTvd) => patch(dataset, wellId, { perfTopTvd }, onChange)} />
          <Num label="Низ дыр, MD" unit="м" value={well.perfBottomMd} onChange={(perfBottomMd) => patch(dataset, wellId, { perfBottomMd }, onChange)} />
          <Num label="Низ дыр, TVD" unit="м" value={well.perfBottomTvd} onChange={(perfBottomTvd) => patch(dataset, wellId, { perfBottomTvd }, onChange)} />
          <Num label="Плотность жидкости" unit="кг/м³" value={well.density} onChange={(density) => patch(dataset, wellId, { density }, onChange)} />
          <Num label="Градиент, если задан вместо плотности" unit="МПа/м" value={well.gradient} onChange={(gradient) => patch(dataset, wellId, { gradient }, onChange)} />
          <Num label="Относительная плотность газа" unit="к воздуху" value={well.gasGravity} onChange={(gasGravity) => patch(dataset, wellId, { gasGravity }, onChange)} />
          <Num label="Эффективная толщина" unit="м" value={well.netPay} onChange={(netPay) => patch(dataset, wellId, { netPay }, onChange)} />
          <Num label="Пористость" unit="доля" value={well.porosity} onChange={(porosity) => patch(dataset, wellId, { porosity }, onChange)} />
          <Num label="Вязкость" unit="мПа·с" value={well.viscosity} onChange={(viscosity) => patch(dataset, wellId, { viscosity }, onChange)} />
          <Num label="Объёмный коэффициент" unit="м³/м³" value={well.volumeFactor} onChange={(volumeFactor) => patch(dataset, wellId, { volumeFactor }, onChange)} />
          <Num label="Сжимаемость" unit="1/МПа" value={well.compressibility} onChange={(compressibility) => patch(dataset, wellId, { compressibility }, onChange)} />
          <Num label="Радиус скважины" unit="м" value={well.wellRadius} onChange={(wellRadius) => patch(dataset, wellId, { wellRadius }, onChange)} />
          <Num label="Пластовая температура" unit="°C" value={well.reservoirTempC} onChange={(reservoirTempC) => patch(dataset, wellId, { reservoirTempC }, onChange)} />
          <Num label="z-фактор" unit="" value={well.zFactor} onChange={(zFactor) => patch(dataset, wellId, { zFactor }, onChange)} />
        </div>
        <p className="mt-4 text-xs leading-relaxed text-muted-foreground">
          Пористость больше 1 считается процентами. Для пересчёта на ВДП достаточно TVD датчика, TVD верхних дыр и плотности или градиента.
          Проницаемость по КВД дополнительно просит толщину, вязкость и объёмный коэффициент. Пустые поля заменяются типовыми, и это прямо написано в карточке КВД.
        </p>
      </Panel>
      <Panel title="Единицы исходного файла">
        <p className="mb-3 text-sm text-muted-foreground">
          Сейчас ряд прочитан как {PRESSURE_LABEL[dataset.sourceUnits.pressure]} и {RATE_LABEL[dataset.sourceUnits.rate]}. На графиках уже МПа и м³/сут.
          Если единица была указана неверно, пересчёт умножит давления телеметрии и замеры Рпл. Журнал КВД и ГКИ не меняется: он вводится в МПа.
        </p>
        <div className="flex flex-wrap gap-2">
          <UnitSelect
            value={dataset.sourceUnits.pressure}
            options={[["MPa", "МПа"], ["atm", "атм"], ["kgs", "кгс/см²"], ["bar", "бар"], ["psi", "psi"]]}
            onChange={(pressure) => onChange(reinterpretUnits(dataset, { pressure: pressure as PressureUnit }))}
          />
          <UnitSelect
            value={dataset.sourceUnits.rate}
            options={[["m3d", "м³/сут"], ["km3d", "тыс. м³/сут"], ["m3h", "м³/ч"]]}
            onChange={(rate) => onChange(reinterpretUnits(dataset, { rate: rate as RateUnit }))}
          />
        </div>
      </Panel>
    </div>
  );
}

function patch(dataset: Dataset, wellId: string, partial: Partial<WellPassport>, onChange: (dataset: Dataset) => void) {
  onChange({
    ...dataset,
    wells: dataset.wells.map((well) => (well.id === wellId ? { ...well, ...partial } : well)),
  });
}

function Num({ label, unit, value, onChange }: { label: string; unit: string; value: number | null; onChange: (value: number | null) => void }) {
  const [text, setText] = useState(value == null ? "" : String(value));
  useEffect(() => setText(value == null ? "" : String(value)), [value]);
  return (
    <label className="grid gap-1 text-xs text-muted-foreground">
      {label}
      <span className="flex items-center gap-2">
        <Input
          value={text}
          inputMode="decimal"
          onChange={(event) => setText(event.target.value)}
          onBlur={() => {
            const trimmed = text.trim().replace(",", ".");
            if (!trimmed) onChange(null);
            else {
              const parsed = Number(trimmed);
              if (Number.isFinite(parsed)) onChange(parsed);
            }
          }}
        />
        {unit ? <span className="w-16 shrink-0">{unit}</span> : null}
      </span>
    </label>
  );
}

function UnitSelect({ value, options, onChange }: { value: string; options: string[][]; onChange: (value: string) => void }) {
  return (
    <select className="h-9 rounded-md border border-input bg-[#161910] px-2 text-sm" value={value} onChange={(event) => onChange(event.target.value)}>
      {options.map(([id, label]) => (
        <option key={id} value={id}>{label}</option>
      ))}
    </select>
  );
}

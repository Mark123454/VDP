import { formatStamp, escapeHtml } from "@/lib/format";

export const C = {
  pbh: "#e2a23a",
  pperf: "#f3d7a1",
  pwh: "#7eb6d6",
  tbh: "#e07a5f",
  twh: "#d7a3b2",
  q: "#9cbe6a",
  pres: "#c4b5e0",
  fit: "#f3d7a1",
  der: "#e07a5f",
  grid: "rgba(235,230,214,0.06)",
  axis: "#b7b39f",
  text: "#ebe6d6",
};

export const WELL_COLORS = ["#e2a23a", "#7eb6d6", "#e07a5f", "#9cbe6a", "#c4b5e0", "#e6d18a", "#8ec8c8", "#d48b8b"];

export function axisStyle() {
  return {
    axisLine: { lineStyle: { color: "#3a3f30" } },
    axisTick: { show: false },
    axisLabel: { color: C.axis, fontSize: 11 },
    splitLine: { lineStyle: { color: C.grid } },
    nameTextStyle: { color: C.axis, fontSize: 11, padding: [0, 0, 0, 4] },
  };
}

export function timeAxis() {
  return {
    type: "time" as const,
    ...axisStyle(),
    axisLabel: {
      color: C.axis,
      fontSize: 11,
      hideOverlap: true,
      formatter: (value: number) => formatStamp(value, false),
    },
  };
}

export function valueAxis(name: string) {
  return { type: "value" as const, name, ...axisStyle(), scale: true };
}

export function baseTooltip() {
  return {
    trigger: "axis" as const,
    backgroundColor: "#1e221b",
    borderColor: "#3d4234",
    textStyle: { color: C.text, fontSize: 12 },
    formatter: (params: unknown) => formatAxisTooltip(params),
  };
}

function formatAxisTooltip(params: unknown): string {
  const list = (Array.isArray(params) ? params : [params]) as {
    seriesName?: string;
    marker?: string;
    value?: unknown;
    axisValue?: unknown;
  }[];
  const first = list[0];
  const rawX = Array.isArray(first?.value) ? first.value[0] : first?.axisValue;
  const head = typeof rawX === "number" && rawX > 1e11 ? escapeHtml(formatStamp(rawX)) : "";
  const rows = list
    .map((row) => {
      const y = Array.isArray(row.value) ? row.value[1] : row.value;
      const text = typeof y === "number" && Number.isFinite(y)
        ? y.toLocaleString("ru-RU", { maximumFractionDigits: 2 })
        : "—";
      return `${row.marker ?? ""} ${escapeHtml(row.seriesName ?? "")}: <b>${escapeHtml(text)}</b>`;
    })
    .join("<br/>");
  return head ? `${head}<br/>${rows}` : rows;
}

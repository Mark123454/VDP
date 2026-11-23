export function formatStamp(ms: number, withTime = true): string {
  const d = new Date(ms);
  const dd = String(d.getUTCDate()).padStart(2, "0");
  const mm = String(d.getUTCMonth() + 1).padStart(2, "0");
  const yyyy = d.getUTCFullYear();
  if (!withTime) return `${dd}.${mm}.${yyyy}`;
  const hh = String(d.getUTCHours()).padStart(2, "0");
  const mi = String(d.getUTCMinutes()).padStart(2, "0");
  return `${dd}.${mm}.${yyyy} ${hh}:${mi}`;
}

export function formatDayInput(ms: number): string {
  const d = new Date(ms);
  const dd = String(d.getUTCDate()).padStart(2, "0");
  const mm = String(d.getUTCMonth() + 1).padStart(2, "0");
  return `${d.getUTCFullYear()}-${mm}-${dd}`;
}

export function parseDayInput(value: string): number | null {
  const m = value.match(/^(\d{4})-(\d{2})-(\d{2})(?:[T ](\d{2}):(\d{2}))?$/);
  if (!m) return null;
  return Date.UTC(+m[1], +m[2] - 1, +m[3], +(m[4] || 0), +(m[5] || 0));
}

export function fmt(n: number | null | undefined, digits = 2): string {
  if (n == null || !Number.isFinite(n)) return "—";
  return n.toLocaleString("ru-RU", {
    maximumFractionDigits: digits,
    minimumFractionDigits: digits,
  });
}

export function fmtCompact(n: number | null | undefined, digits = 1): string {
  if (n == null || !Number.isFinite(n)) return "—";
  const abs = Math.abs(n);
  if (abs >= 1_000_000) return `${fmt(n / 1_000_000, digits)} млн`;
  if (abs >= 10_000) return `${fmt(n / 1000, digits)} тыс.`;
  return fmt(n, digits);
}

export function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

export function downloadText(filename: string, content: string, mime: string) {
  const blob = new Blob([content], { type: mime });
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  a.download = filename;
  a.click();
  URL.revokeObjectURL(a.href);
}

export function downloadCsv(filename: string, header: string[], rows: (string | number | null)[][]) {
  const esc = (value: string | number | null) => {
    if (value == null) return "";
    const s = typeof value === "number" ? value.toFixed(6).replace(".", ",") : String(value);
    if (/[;"\n]/.test(s)) return `"${s.replace(/"/g, '""')}"`;
    return s;
  };
  const body = [header, ...rows].map((row) => row.map(esc).join(";")).join("\n");
  downloadText(filename, `\uFEFF${body}`, "text/csv;charset=utf-8");
}

export function fluidLabel(fluid: "oil" | "water" | "gas"): string {
  if (fluid === "gas") return "газ";
  if (fluid === "water") return "вода";
  return "нефть";
}

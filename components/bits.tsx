import type { ReactNode } from "react";
import { cn } from "@/lib/utils";

export function Panel({ title, action, children, className }: { title?: string; action?: ReactNode; children: ReactNode; className?: string }) {
  return (
    <section className={cn("rounded-xl border border-border bg-card/80", className)}>
      {title || action ? (
        <header className="flex items-start justify-between gap-3 border-b border-border px-4 py-3">
          {title ? <h2 className="text-sm font-semibold tracking-tight">{title}</h2> : <span />}
          {action}
        </header>
      ) : null}
      <div className="p-4">{children}</div>
    </section>
  );
}

export function Kpi({ label, value, unit, hint }: { label: string; value: string; unit?: string; hint?: string }) {
  return (
    <div className="rounded-lg border border-border bg-[#191c14] px-3 py-2.5" title={hint}>
      <div className="text-[11px] uppercase tracking-[0.14em] text-muted-foreground">{label}</div>
      <div className="mt-1 flex items-baseline gap-1.5">
        <span className="font-mono text-xl tabular-nums tracking-tight">{value}</span>
        {unit ? <span className="text-xs text-muted-foreground">{unit}</span> : null}
      </div>
    </div>
  );
}

export function Empty({ children }: { children: ReactNode }) {
  return <p className="rounded-lg border border-dashed border-border px-4 py-8 text-center text-sm text-muted-foreground">{children}</p>;
}

export function Chip({ active, children, onClick }: { active?: boolean; children: ReactNode; onClick?: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        "rounded-full border px-2.5 py-1 text-xs transition-colors",
        active ? "border-primary/70 bg-primary/15 text-foreground" : "border-border text-muted-foreground hover:bg-accent",
      )}
    >
      {children}
    </button>
  );
}

export function Severity({ level }: { level: "info" | "warning" | "critical" }) {
  const label = level === "critical" ? "важно" : level === "warning" ? "внимание" : "заметка";
  const tone = level === "critical" ? "text-destructive" : level === "warning" ? "text-primary" : "text-muted-foreground";
  return <span className={cn("text-[10px] uppercase tracking-[0.14em]", tone)}>{label}</span>;
}

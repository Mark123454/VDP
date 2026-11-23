"use client";

import { useEffect, useRef } from "react";
import type { ECharts, EChartsCoreOption } from "echarts";

export function EChart({ option, label }: { option: EChartsCoreOption; label: string }) {
  const host = useRef<HTMLDivElement>(null);
  const chart = useRef<ECharts | null>(null);
  const optionRef = useRef(option);
  optionRef.current = option;

  useEffect(() => {
    let dead = false;
    let observer: ResizeObserver | null = null;
    let local: ECharts | null = null;
    import("echarts").then((echarts) => {
      if (dead || !host.current) return;
      local = echarts.init(host.current, undefined, { renderer: "canvas" });
      chart.current = local;
      local.setOption(optionRef.current, true);
      observer = new ResizeObserver(() => local?.resize());
      observer.observe(host.current);
    });
    return () => {
      dead = true;
      observer?.disconnect();
      local?.dispose();
      chart.current = null;
    };
  }, []);

  useEffect(() => {
    chart.current?.setOption(option, true);
  }, [option]);

  return <div ref={host} className="h-full w-full" role="img" aria-label={label} />;
}

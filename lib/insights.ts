import type { WellAnalysis } from "./analyze";
import { sliceDerived } from "./analyze";
import { fmt } from "./format";
import { median } from "./series";
import type { Dataset } from "./types";

export interface Insight {
  severity: "info" | "warning" | "critical";
  title: string;
  text: string;
}

export function insightsFor(dataset: Dataset, analysis: WellAnalysis, range: [number, number] | null): Insight[] {
  const points = sliceDerived(analysis.derived, range);
  const insights: Insight[] = [];
  if (points.length < 8) {
    insights.push({
      severity: "warning",
      title: "Мало точек",
      text: "В выбранном интервале почти нет телеметрии. Расширьте период или проверьте, что в Excel дата стоит в первом столбце.",
    });
    return insights;
  }

  const flowing = points.filter((point) => point.q != null && point.q > analysis.shutMax);
  const head = flowing.slice(0, Math.max(4, Math.floor(flowing.length * 0.12)));
  const tail = flowing.slice(-Math.max(4, Math.floor(flowing.length * 0.12)));
  const q0 = median(head.map((p) => p.q!));
  const q1 = median(tail.map((p) => p.q!));
  if (Number.isFinite(q0) && Number.isFinite(q1) && q0 > 0) {
    const change = ((q1 - q0) / q0) * 100;
    if (Math.abs(change) >= 8) {
      insights.push({
        severity: change < -15 ? "warning" : "info",
        title: change < 0 ? "Дебит снижается" : "Дебит вырос",
        text: `На рабочих режимах дебит изменился с ${fmt(q0, 1)} до ${fmt(q1, 1)} м³/сут (${change > 0 ? "+" : ""}${fmt(change, 0)}%).`,
      });
    }
  }

  const piHead = median(head.map((p) => p.pi).filter((v): v is number => v != null && v > 0));
  const piTail = median(tail.map((p) => p.pi).filter((v): v is number => v != null && v > 0));
  if (Number.isFinite(piHead) && Number.isFinite(piTail) && piHead > 0) {
    const change = ((piTail - piHead) / piHead) * 100;
    if (Math.abs(change) >= 10) {
      insights.push({
        severity: change < -12 ? "warning" : "info",
        title: change < 0 ? "Продуктивность падает" : "Продуктивность выросла",
        text: `Коэффициент продуктивности ${fmt(piHead, 1)} → ${fmt(piTail, 1)} м³/сут/МПа (${change > 0 ? "+" : ""}${fmt(change, 0)}%). Если депрессия растёт быстрее, чем падает Рпл, обычно виновата призабойная зона, а не только истощение.`,
      });
    }
  }

  const reservoir = dataset.reservoir.filter((point) => point.wellId === analysis.well.id).sort((a, b) => a.t - b.t);
  if (reservoir.length >= 2) {
    const first = reservoir[0];
    const last = reservoir[reservoir.length - 1];
    const years = (last.t - first.t) / (365.25 * 86_400_000);
    if (years > 0.4) {
      const rate = (last.pressure - first.pressure) / years;
      insights.push({
        severity: rate < -0.8 ? "warning" : "info",
        title: "Пластовое давление",
        text: `По годовым замерам Рпл ${fmt(first.pressure, 2)} → ${fmt(last.pressure, 2)} МПа, ${fmt(rate, 2)} МПа/год.`,
      });
    }
  } else {
    insights.push({
      severity: "warning",
      title: "Нет замеров Рпл",
      text: "Без пластового давления не считаются депрессия и коэффициент продуктивности. Добавьте годовые замеры на вкладке «Пласт» или листом в Excel.",
    });
  }

  if (!analysis.hydro) {
    insights.push({
      severity: "warning",
      title: "Нет глубин для пересчёта",
      text: "Укажите глубину датчика и верхних дыр перфорации. Предпочтительна TVD: по стволу пересчёт завысит гидростатику на наклонной скважине.",
    });
  } else {
    const basis = analysis.hydro.basis === "tvd" ? "TVD" : "MD";
    insights.push({
      severity: analysis.hydro.basis === "md" ? "warning" : "info",
      title: "Пересчёт на ВДП",
      text: `Датчик ${analysis.hydro.dh >= 0 ? "выше" : "ниже"} верхних дыр на ${fmt(Math.abs(analysis.hydro.dh), 0)} м по ${basis}. Поправка около ${fmt(analysis.hydro.dpLatest, 2)} МПа (${analysis.hydro.method}).`,
    });
  }

  const buildup = [...analysis.buildups].reverse().find((item) => item.permeability != null) ?? analysis.buildups[analysis.buildups.length - 1];
  if (buildup) {
    const journal = dataset.journalKvd
      .filter((item) => item.wellId === analysis.well.id)
      .sort((a, b) => Math.abs(a.t - buildup.event.start) - Math.abs(b.t - buildup.event.start))[0];
    const parts = [
      buildup.permeability != null ? `k = ${fmt(buildup.permeability, 1)} мД` : "проницаемость не посчитана",
      buildup.skin != null ? `скин ${fmt(buildup.skin, 1)}` : null,
      buildup.pStar != null ? `P* ${fmt(buildup.pStar, 2)} МПа` : null,
    ].filter(Boolean);
    let compare = "";
    if (journal && journal.permeability != null && buildup.permeability != null) {
      compare = ` Ближайшая запись журнала: k = ${fmt(journal.permeability, 1)} мД${journal.skin != null ? `, скин ${fmt(journal.skin, 1)}` : ""}.`;
    }
    insights.push({
      severity: buildup.skin != null && buildup.skin > 5 ? "warning" : "info",
      title: "Последняя КВД по телеметрии",
      text: `${parts.join(", ")}. Достоверность ${buildup.confidence}.${compare}`,
    });
  } else {
    insights.push({
      severity: "info",
      title: "КВД не найдены",
      text: "Остановка видна, когда дебит падает почти до нуля не меньше чем на 8 часов и забойное давление растёт.",
    });
  }

  const campaign = analysis.campaigns[analysis.campaigns.length - 1];
  if (campaign?.fit) {
    const fit = campaign.fit;
    const text =
      fit.kind === "gas"
        ? `Режимов: ${campaign.steps.length}. ${fit.aof != null ? `Дебит абсолютно свободный ${fmt(fit.aof, 0)} м³/сут.` : "AOF не сошёлся."} ${fit.pIntercept != null ? `Отсечка по давлению ${fmt(fit.pIntercept, 2)} МПа.` : ""}`
        : `Режимов: ${campaign.steps.length}. ${fit.jAnchored != null ? `Кпрод при известном Рпл ${fmt(fit.jAnchored, 1)} м³/сут/МПа.` : ""} ${fit.pIntercept != null ? `Рпл по отсечке индикаторной ${fmt(fit.pIntercept, 2)} МПа.` : ""}`;
    insights.push({ severity: "info", title: "Последнее ГКИ по телеметрии", text: text.trim() });
  }

  const stuck = analysis.anomalies.filter((item) => item.kind === "flatline");
  const spikes = analysis.anomalies.filter((item) => item.kind === "spike");
  if (stuck.length) {
    insights.push({
      severity: "critical",
      title: "Похоже на отказ датчика",
      text: stuck[0].message + (stuck.length > 1 ? ` Всего таких участков: ${stuck.length}.` : ""),
    });
  }
  if (spikes.length) {
    insights.push({
      severity: "warning",
      title: "Выбросы",
      text: `${spikes.length} единичных выбросов. На графике они остаются, в средние режимов КВД и ГКИ почти не попадают.`,
    });
  }

  if (analysis.decline && analysis.decline.r2 > 0.6) {
    insights.push({
      severity: "info",
      title: "Темп падения",
      text: `Экспонента по среднемесячному дебиту: ${fmt(analysis.decline.percent, 1)}% в год (R² ${fmt(analysis.decline.r2, 2)}). Это описание тренда, не прогноз запасов.`,
    });
  }

  insights.push({
    severity: analysis.quality.completeness < 0.9 ? "warning" : "info",
    title: "Полнота ряда",
    text: `Точек ${analysis.quality.points.toLocaleString("ru-RU")}, полнота ${fmt(analysis.quality.completeness * 100, 1)}%. Время в работе ${fmt(analysis.uptime * 100, 0)}%. Накопленная добыча ${fmt(analysis.cumulative, 0)} м³.`,
  });

  const order = { critical: 0, warning: 1, info: 2 };
  return insights.sort((a, b) => order[a.severity] - order[b.severity]).slice(0, 8);
}

export function flowingMedian(points: WellAnalysis["derived"], shutMax: number, pick: (p: WellAnalysis["derived"][number]) => number | null): number | null {
  const values = points
    .filter((point) => point.q != null && point.q > shutMax)
    .map(pick)
    .filter((value): value is number => value != null && Number.isFinite(value));
  if (!values.length) return null;
  return median(values);
}

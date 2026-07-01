import { useState } from "react";
import { TrendingUp, TrendingDown, Minus } from "lucide-react";

/**
 * Painel visual estilo GioBrain — mostra métricas com variação %,
 * gráfico de linha (últimos 7 dias), títulos vencedores e distribuição
 * de custo por campanha. Usa só dados já salvos no snapshot do Firestore
 * (sem chamadas extras de API no frontend).
 */

function pct(current, previous) {
  if (!previous || previous === 0) return null;
  return ((current - previous) / previous) * 100;
}

function PctBadge({ value }) {
  if (value === null) return null;
  const up = value > 0;
  const zero = Math.abs(value) < 0.1;
  const color = zero ? "var(--gray)" : up ? "#2E7D32" : "#C62828";
  const Icon = zero ? Minus : up ? TrendingUp : TrendingDown;
  return (
    <span style={{ fontSize: 11, fontWeight: 700, color, display: "flex", alignItems: "center", gap: 2 }}>
      <Icon size={11} />
      {Math.abs(value).toFixed(1)}%
    </span>
  );
}

function MetricCard({ label, value, pctValue }) {
  return (
    <div style={{ background: "var(--card-bg, #fff)", border: "1px solid var(--gray-light)", borderRadius: 12, padding: "14px 16px", flex: "1 1 140px" }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start" }}>
        <span className="muted" style={{ fontSize: 12 }}>{label}</span>
        <PctBadge value={pctValue} />
      </div>
      <div style={{ fontSize: 24, fontWeight: 800, marginTop: 6 }}>{value}</div>
    </div>
  );
}

/** Mini gráfico de linha SVG sem dependências externas */
function LineChart({ data, xKey, lines }) {
  if (!data || data.length < 2) return null;
  const W = 500, H = 120, PAD = { top: 10, right: 10, bottom: 24, left: 36 };
  const innerW = W - PAD.left - PAD.right;
  const innerH = H - PAD.top - PAD.bottom;

  const allValues = lines.flatMap((l) => data.map((d) => d[l.key] || 0));
  const maxVal = Math.max(...allValues, 1);

  const xScale = (i) => PAD.left + (i / (data.length - 1)) * innerW;
  const yScale = (v) => PAD.top + innerH - (v / maxVal) * innerH;

  const COLORS = ["#1A56DB", "#10B981", "#F59E0B", "#EF4444"];

  return (
    <svg viewBox={`0 0 ${W} ${H}`} style={{ width: "100%", height: "auto" }}>
      {/* Grid lines */}
      {[0, 0.5, 1].map((t) => (
        <line
          key={t}
          x1={PAD.left} x2={W - PAD.right}
          y1={PAD.top + innerH * (1 - t)} y2={PAD.top + innerH * (1 - t)}
          stroke="var(--gray-light)" strokeWidth={1}
        />
      ))}

      {lines.map((l, li) => {
        const pts = data.map((d, i) => `${xScale(i)},${yScale(d[l.key] || 0)}`).join(" ");
        return (
          <g key={l.key}>
            <polyline
              points={pts}
              fill="none"
              stroke={COLORS[li % COLORS.length]}
              strokeWidth={2}
              strokeLinejoin="round"
              strokeLinecap="round"
            />
            {data.map((d, i) => (
              <circle
                key={i}
                cx={xScale(i)} cy={yScale(d[l.key] || 0)}
                r={3} fill={COLORS[li % COLORS.length]}
              />
            ))}
          </g>
        );
      })}

      {/* X axis labels — só o dia (MM/DD) */}
      {data.map((d, i) => {
        if (data.length > 7 && i % 2 !== 0) return null;
        const label = d[xKey]?.slice(5).replace("-", "/") || "";
        return (
          <text key={i} x={xScale(i)} y={H - 4} textAnchor="middle" fontSize={9} fill="var(--gray)">
            {label}
          </text>
        );
      })}

      {/* Legend */}
      {lines.map((l, li) => (
        <g key={l.key} transform={`translate(${PAD.left + li * 90}, 6)`}>
          <rect width={10} height={3} rx={1} y={4} fill={COLORS[li % COLORS.length]} />
          <text x={14} y={10} fontSize={9} fill="var(--gray)">{l.label}</text>
        </g>
      ))}
    </svg>
  );
}

/** Gráfico de rosca simples SVG pra distribuição por campanha */
function DonutChart({ campaigns }) {
  const active = campaigns.filter((c) => c.status === "ENABLED" && (c.metrics?.cost || 0) > 0);
  if (active.length === 0) return null;

  const total = active.reduce((sum, c) => sum + (c.metrics?.cost || 0), 0);
  const COLORS = ["#1A56DB", "#10B981", "#F59E0B", "#EF4444", "#8B5CF6"];

  const R = 40, CX = 60, CY = 60;
  let angle = -Math.PI / 2;
  const slices = active.map((c, i) => {
    const pctVal = (c.metrics?.cost || 0) / total;
    const start = angle;
    angle += pctVal * 2 * Math.PI;
    const end = angle;
    const x1 = CX + R * Math.cos(start), y1 = CY + R * Math.sin(start);
    const x2 = CX + R * Math.cos(end), y2 = CY + R * Math.sin(end);
    const large = pctVal > 0.5 ? 1 : 0;
    return { path: `M ${CX} ${CY} L ${x1} ${y1} A ${R} ${R} 0 ${large} 1 ${x2} ${y2} Z`, color: COLORS[i % COLORS.length], name: c.name, pct: pctVal, cost: c.metrics?.cost || 0 };
  });

  return (
    <div style={{ display: "flex", alignItems: "center", gap: 16 }}>
      <svg viewBox="0 0 120 120" style={{ width: 90, flexShrink: 0 }}>
        {slices.map((s, i) => <path key={i} d={s.path} fill={s.color} />)}
        <circle cx={CX} cy={CY} r={22} fill="white" />
      </svg>
      <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
        {slices.map((s, i) => (
          <div key={i} style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 11 }}>
            <div style={{ width: 8, height: 8, borderRadius: "50%", background: s.color, flexShrink: 0 }} />
            <span className="muted" style={{ fontSize: 11, maxWidth: 140, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{s.name}</span>
            <span style={{ fontWeight: 700, marginLeft: "auto" }}>R${s.cost.toFixed(0)}</span>
          </div>
        ))}
      </div>
    </div>
  );
}

export default function GioBrainDashboard({ campaigns, dailyPerformance, daily15, daily30, todayMetrics, previousPeriodMetrics, winningHeadlines, monthToDateSpend }) {
  const [period, setPeriod] = useState("7");

  if (!campaigns || campaigns.length === 0) return null;

  // Seleciona o dataset conforme o período escolhido
  const dataMap = { "7": dailyPerformance, "15": daily15, "30": daily30 };
  const selectedData = period === "today"
    ? (todayMetrics ? [{ date: "Hoje", ...todayMetrics, cost: todayMetrics.cost }] : [])
    : (dataMap[period] || []);

  // Agrega o período selecionado
  const currentPeriod = period === "today" && todayMetrics
    ? { clicks: todayMetrics.clicks, impressions: todayMetrics.impressions, cost: todayMetrics.cost, conversions: todayMetrics.conversions }
    : selectedData.reduce(
        (acc, d) => ({ clicks: acc.clicks + d.clicks, impressions: acc.impressions + d.impressions, cost: acc.cost + d.cost, conversions: acc.conversions + d.conversions }),
        { clicks: 0, impressions: 0, cost: 0, conversions: 0 }
      );

  const prev = period === "7" ? previousPeriodMetrics : null; // variação % só pra 7 dias (período anterior disponível)
  const ctr = currentPeriod.impressions > 0 ? (currentPeriod.clicks / currentPeriod.impressions) * 100 : 0;
  const cpc = currentPeriod.clicks > 0 ? currentPeriod.cost / currentPeriod.clicks : 0;

  const PERIODS = [
    { key: "today", label: "Hoje" },
    { key: "7", label: "7 dias" },
    { key: "15", label: "15 dias" },
    { key: "30", label: "30 dias" },
  ];

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
      {/* Métricas com seletor de período */}
      <div className="card">
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 12 }}>
          <div className="card-title" style={{ margin: 0 }}>📊 Desempenho</div>
          <div style={{ display: "flex", gap: 4 }}>
            {PERIODS.map((p) => (
              <button
                key={p.key}
                onClick={() => setPeriod(p.key)}
                className={period === p.key ? "btn btn-teal btn-sm" : "btn btn-outline btn-sm"}
                style={{ padding: "4px 10px", fontSize: 12 }}
              >
                {p.label}
              </button>
            ))}
          </div>
        </div>
        <div style={{ display: "flex", gap: 10, flexWrap: "wrap" }}>
          <MetricCard label="Impressões" value={currentPeriod.impressions.toLocaleString("pt-BR")} pctValue={prev ? pct(currentPeriod.impressions, prev.impressions) : null} />
          <MetricCard label="Cliques" value={currentPeriod.clicks.toLocaleString("pt-BR")} pctValue={prev ? pct(currentPeriod.clicks, prev.clicks) : null} />
          <MetricCard label="CTR" value={`${ctr.toFixed(2)}%`} pctValue={null} />
          <MetricCard label="CPC Médio" value={`R$ ${cpc.toFixed(2)}`} pctValue={null} />
          <MetricCard label="Conversões" value={currentPeriod.conversions.toFixed(0)} pctValue={prev ? pct(currentPeriod.conversions, prev.conversions) : null} />
          <MetricCard label="Custo" value={`R$ ${currentPeriod.cost.toFixed(2)}`} pctValue={prev ? pct(currentPeriod.cost, prev.cost) : null} />
        </div>
      </div>

      {/* Gráfico de linha — usa o período selecionado, exceto "Hoje" que
          tem só 1 ponto (sem gráfico de linha útil) */}
      {period !== "today" && selectedData.length >= 2 && (
        <div className="card">
          <div className="card-title" style={{ marginBottom: 12 }}>📈 Evolução Diária</div>
          <LineChart data={selectedData} xKey="date" lines={[{ key: "impressions", label: "Impressões" }, { key: "clicks", label: "Cliques" }]} />
        </div>
      )}

      <div style={{ display: "flex", gap: 16, flexWrap: "wrap" }}>
        {/* Títulos Vencedores */}
        {winningHeadlines.length > 0 && (
          <div className="card" style={{ flex: "1 1 280px" }}>
            <div className="card-title" style={{ marginBottom: 12 }}>🏆 Títulos Vencedores</div>
            <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
              <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 4 }}>
                <span className="muted" style={{ fontSize: 11 }}>Título</span>
                <span className="muted" style={{ fontSize: 11 }}>Impressões</span>
              </div>
              {winningHeadlines.slice(0, 6).map((h, i) => (
                <div key={i} style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 8, padding: "6px 0", borderBottom: i < winningHeadlines.length - 1 ? "1px solid var(--gray-light)" : "none" }}>
                  <span style={{ fontSize: 13, flex: 1 }}>{h.text}</span>
                  <span style={{ fontWeight: 700, fontSize: 13, flexShrink: 0 }}>{h.impressions.toLocaleString("pt-BR")}</span>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Distribuição por Campanha */}
        <div className="card" style={{ flex: "1 1 220px" }}>
          <div className="card-title" style={{ marginBottom: 12 }}>🍩 Distribuição por Campanha</div>
          <p className="muted" style={{ fontSize: 11, marginBottom: 10 }}>Custo — últimos 30 dias</p>
          <DonutChart campaigns={campaigns} />
        </div>
      </div>
    </div>
  );
}

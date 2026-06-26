import { useState } from "react";
import { ChevronDown, ChevronUp, RefreshCw, AlertTriangle, Copy, Check } from "lucide-react";
import { useGoogleAdsSnapshot } from "../googleads/useGoogleAdsSnapshot";

const BIDDING_LABELS = {
  MAXIMIZE_CONVERSIONS: "Max. conversões",
  MAXIMIZE_CONVERSION_VALUE: "Max. valor de conversão",
  TARGET_SPEND: "Max. cliques",
  TARGET_CPA: "CPA alvo",
  TARGET_ROAS: "ROAS alvo",
  TARGET_IMPRESSION_SHARE: "Parcela de impressões",
  MANUAL_CPV: "CPV manual",
};

const TYPE_LABELS = {
  SEARCH: "Pesquisa",
  DISPLAY: "Display",
  PERFORMANCE_MAX: "Performance Max",
  VIDEO: "Vídeo",
  DEMAND_GEN: "Demand Gen",
  SMART: "Smart",
};

export default function GoogleAdsModule() {
  const {
    campaigns,
    lastUpdated,
    hasMetrics,
    alerts,
    negativeKeywordSuggestions,
    negativeKeywordsCheckedAt,
    loading,
    error,
  } = useGoogleAdsSnapshot();
  const [showAll, setShowAll] = useState(false);
  const [statusFilter, setStatusFilter] = useState("all");
  const [dismissed, setDismissed] = useState(new Set());
  const [copiedTerm, setCopiedTerm] = useState(null);
  const [actionLoading, setActionLoading] = useState(null); // id da ação em andamento, pra desabilitar só o botão certo
  const [actionFeedback, setActionFeedback] = useState(null); // { ok, message }
  const [budgetEdits, setBudgetEdits] = useState({}); // campaign_id -> valor digitado no input de orçamento

  // Chama o backend pra qualquer uma das 3 mutações da Fase 4. actionId é
  // só uma chave única (ex.: "pause-123") pra controlar qual botão mostra
  // o spinner — evita desabilitar a tela inteira enquanto uma ação roda.
  async function runAction(actionId, payload) {
    setActionLoading(actionId);
    setActionFeedback(null);
    try {
      const res = await fetch("/api/google-ads-fetch-real", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Erro desconhecido");
      setActionFeedback({ ok: true, message: data.message || "Ação aplicada com sucesso." });
      return true;
    } catch (err) {
      setActionFeedback({ ok: false, message: err.message });
      return false;
    } finally {
      setActionLoading(null);
    }
  }

  async function handleApplyNegativeKeyword(suggestion) {
    if (!confirm(`Adicionar "${suggestion.term}" como palavra-chave negativa na campanha "${suggestion.campaign_name}"?`)) return;
    const ok = await runAction(`neg-${suggestion.term}`, {
      action: "add_negative_keyword",
      campaign_id: suggestion.campaign_id,
      term: suggestion.term,
    });
    if (ok) handleDismiss(suggestion.term);
  }

  async function handlePauseCampaign(campaign) {
    if (!confirm(`Pausar a campanha "${campaign.name}"? Ela para de gerar cliques e gastos imediatamente.`)) return;
    await runAction(`pause-${campaign.campaign_id}`, {
      action: "pause_campaign",
      campaign_id: campaign.campaign_id,
    });
  }

  async function handleUpdateBudget(campaign) {
    const raw = budgetEdits[campaign.campaign_id];
    const newAmount = parseFloat(String(raw).replace(",", "."));
    if (!newAmount || newAmount <= 0) {
      setActionFeedback({ ok: false, message: "Digite um valor de orçamento válido." });
      return;
    }
    if (!campaign.budget_resource_name) {
      setActionFeedback({ ok: false, message: "Esta campanha não tem orçamento próprio identificado (pode usar orçamento compartilhado)." });
      return;
    }
    if (!confirm(`Alterar orçamento diário de "${campaign.name}" de R$ ${campaign.budget_amount.toFixed(2)} para R$ ${newAmount.toFixed(2)}?`)) return;
    await runAction(`budget-${campaign.campaign_id}`, {
      action: "update_budget",
      budget_resource_name: campaign.budget_resource_name,
      new_amount: newAmount,
    });
  }

  function handleCopy(term) {
    navigator.clipboard?.writeText(term);
    setCopiedTerm(term);
    setTimeout(() => setCopiedTerm(null), 1500);
  }

  function handleDismiss(term) {
    setDismissed((prev) => new Set(prev).add(term));
  }

  const visibleSuggestions = negativeKeywordSuggestions.filter((s) => !dismissed.has(s.term));

  const activeCampaigns = campaigns.filter((c) => c.status === "ENABLED");
  const pausedCampaigns = campaigns.filter((c) => c.status !== "ENABLED");
  const activeBudgetTotal = activeCampaigns.reduce((sum, c) => sum + (c.budget_amount || 0), 0);

  // Agregados gerais dos últimos 30 dias, somando todas as campanhas —
  // dá a visão de "conta toda" no topo, antes de entrar campanha a campanha.
  const totals = campaigns.reduce(
    (acc, c) => {
      const m = c.metrics || {};
      acc.clicks += m.clicks || 0;
      acc.impressions += m.impressions || 0;
      acc.cost += m.cost || 0;
      acc.conversions += m.conversions || 0;
      return acc;
    },
    { clicks: 0, impressions: 0, cost: 0, conversions: 0 }
  );
  const overallCtr = totals.impressions > 0 ? totals.clicks / totals.impressions : 0;
  const overallCpa = totals.conversions > 0 ? totals.cost / totals.conversions : null;

  // Score médio ponderado por cliques — campanhas com mais volume pesam
  // mais no score geral da conta do que campanhas quase sem tráfego.
  const campaignsWithScore = campaigns.filter((c) => typeof c.lcs_score === "number");
  const totalClicksForScore = campaignsWithScore.reduce((sum, c) => sum + (c.metrics?.clicks || 0), 0);
  const overallScore =
    campaignsWithScore.length === 0
      ? null
      : totalClicksForScore > 0
      ? campaignsWithScore.reduce((sum, c) => sum + c.lcs_score * (c.metrics?.clicks || 0), 0) / totalClicksForScore
      : campaignsWithScore.reduce((sum, c) => sum + c.lcs_score, 0) / campaignsWithScore.length;

  const filteredForTable =
    statusFilter === "all"
      ? campaigns
      : campaigns.filter((c) =>
          statusFilter === "ENABLED" ? c.status === "ENABLED" : c.status !== "ENABLED"
        );

  // Ordena por score (piores primeiro) pra já chamar atenção pro que
  // precisa de atenção quando a lista de "todas" estiver expandida.
  const sortedForTable = [...filteredForTable].sort((a, b) => (a.lcs_score ?? 99) - (b.lcs_score ?? 99));

  return (
    <div>
      <div className="page-header">
        <div>
          <h1 className="page-title">Google Ads</h1>
          <p className="page-subtitle">Dados reais da conta — conta 337-172-5537</p>
        </div>
      </div>

      {error && (
        <div className="card error-card">
          <strong>Não foi possível conectar ao Firebase.</strong>
          <p>{error}</p>
        </div>
      )}

      {actionFeedback && (
        <div
          className="pending-metrics-note"
          style={
            actionFeedback.ok
              ? { borderColor: "var(--teal)", background: "#ECFEFF" }
              : { borderColor: "var(--pink)", background: "#FFF0F6" }
          }
        >
          {actionFeedback.ok ? <Check size={16} style={{ flexShrink: 0, marginTop: 1, color: "var(--teal)" }} /> : <AlertTriangle size={16} style={{ flexShrink: 0, marginTop: 1, color: "var(--pink)" }} />}
          <span>{actionFeedback.message}</span>
        </div>
      )}

      {alerts && alerts.length > 0 && (
        <div className="pending-metrics-note" style={{ borderColor: "var(--pink)", background: "#FFF0F6" }}>
          <AlertTriangle size={16} style={{ flexShrink: 0, marginTop: 1, color: "var(--pink)" }} />
          <span>
            <strong>Alertas da última atualização:</strong>
            <ul style={{ margin: "6px 0 0", paddingLeft: 18 }}>
              {alerts.map((a, i) => (
                <li key={i}>{a}</li>
              ))}
            </ul>
          </span>
        </div>
      )}

      {!loading && hasMetrics === false && campaigns.length > 0 && campaignsWithScore.length === 0 && (
        <div className="pending-metrics-note">
          <RefreshCw size={16} style={{ flexShrink: 0, marginTop: 1, color: "var(--teal)" }} />
          <span>
            Conectado à Google Ads API real. Aguardando a próxima sincronização incluir métricas
            de performance dos últimos 30 dias.
          </span>
        </div>
      )}

      {/* LCS Score geral da conta — resumo no topo, igual ao "score geral" de ferramentas como o GIO Score */}
      {overallScore !== null && (
        <div className="card" style={{ display: "flex", alignItems: "center", gap: 24, flexWrap: "wrap" }}>
          <ScoreGauge score={overallScore} size={88} />
          <div style={{ flex: 1, minWidth: 200 }}>
            <div className="card-title" style={{ marginBottom: 2 }}>LCS Score da conta</div>
            <p className="muted" style={{ margin: 0 }}>
              Média ponderada pelo volume de cliques das últimas 30 dias. Combina CTR, taxa de
              conversão, eficiência de custo e estrutura das campanhas ativas.
            </p>
          </div>
          <div style={{ display: "flex", gap: 18, flexWrap: "wrap" }}>
            <MiniStat label="CTR médio" value={`${(overallCtr * 100).toFixed(2)}%`} />
            <MiniStat label="Conversões (30d)" value={totals.conversions.toFixed(0)} />
            <MiniStat label="CPA médio" value={overallCpa !== null ? `R$ ${overallCpa.toFixed(2)}` : "—"} />
            <MiniStat label="Custo (30d)" value={`R$ ${totals.cost.toFixed(2)}`} />
          </div>
        </div>
      )}

      <div className="stat-grid">
        <StatCard label="Total de campanhas" value={loading ? "—" : campaigns.length} accent="blue" />
        <StatCard label="Ativas" value={loading ? "—" : activeCampaigns.length} accent="teal" />
        <StatCard label="Pausadas" value={loading ? "—" : pausedCampaigns.length} accent="amber" />
        <StatCard
          label="Orçamento ativo/dia"
          value={loading ? "—" : `R$ ${activeBudgetTotal.toFixed(2)}`}
          accent="pink"
        />
      </div>

      {/* Sugestões de palavras-chave negativas — análise por IA dos termos
          de pesquisa reais que gastaram dinheiro sem converter nos últimos
          30 dias. Nada é aplicado automaticamente: o usuário copia o termo
          e adiciona manualmente no Google Ads, ou descarta a sugestão. */}
      {visibleSuggestions.length > 0 && (
        <div className="card">
          <div className="card-title" style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
            <span>🎯 Sugestões de palavras-chave negativas ({visibleSuggestions.length})</span>
          </div>
          <p className="muted" style={{ marginTop: 4, marginBottom: 14 }}>
            Termos de pesquisa reais que geraram cliques pagos nos últimos 30 dias sem nenhuma
            conversão. A IA identificou estes como provavelmente irrelevantes ao seu negócio. Copie
            e adicione manualmente como palavra-chave negativa no Google Ads, ou descarte se achar
            que a sugestão não se aplica.
          </p>
          <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
            {visibleSuggestions.map((s) => (
              <div
                key={s.term}
                style={{
                  display: "flex",
                  alignItems: "center",
                  gap: 12,
                  padding: "10px 14px",
                  borderRadius: 10,
                  background: "var(--bg)",
                  border: "1px solid var(--gray-light)",
                  flexWrap: "wrap",
                }}
              >
                <span
                  style={{
                    fontSize: 10,
                    fontWeight: 700,
                    padding: "2px 7px",
                    borderRadius: 8,
                    color: "#fff",
                    background: s.confidence === "alta" ? "#C62828" : "#B8860B",
                    textTransform: "uppercase",
                  }}
                >
                  {s.confidence === "alta" ? "Confiança alta" : "Confiança média"}
                </span>
                <strong style={{ flex: "1 1 160px" }}>"{s.term}"</strong>
                <span className="muted" style={{ fontSize: 13, flex: "2 1 200px" }}>{s.reason}</span>
                <span className="muted" style={{ fontSize: 12, whiteSpace: "nowrap" }}>
                  R$ {s.cost?.toFixed(2) || "0.00"} · {s.clicks || 0} cliques · {s.campaign_name}
                </span>
                <div style={{ display: "flex", gap: 6, marginLeft: "auto" }}>
                  <button
                    className="btn btn-teal btn-sm"
                    onClick={() => handleApplyNegativeKeyword(s)}
                    disabled={actionLoading === `neg-${s.term}`}
                    title="Aplicar de verdade na campanha, via Google Ads API"
                  >
                    {actionLoading === `neg-${s.term}` ? "Aplicando..." : "✓ Aplicar"}
                  </button>
                  <button
                    className="btn btn-outline btn-sm"
                    onClick={() => handleCopy(s.term)}
                    title="Copiar termo para adicionar manualmente no Google Ads"
                  >
                    {copiedTerm === s.term ? <Check size={13} /> : <Copy size={13} />}
                    {copiedTerm === s.term ? "Copiado" : "Copiar"}
                  </button>
                  <button className="btn btn-outline btn-sm" onClick={() => handleDismiss(s.term)}>
                    Descartar
                  </button>
                </div>
              </div>
            ))}
          </div>
          {negativeKeywordsCheckedAt && (
            <p className="muted" style={{ marginTop: 10, fontSize: 12 }}>
              Última análise: {new Date(negativeKeywordsCheckedAt).toLocaleString("pt-BR")}
            </p>
          )}
        </div>
      )}

      <div className="card">
        <div className="card-title">Campanhas ativas</div>
        {loading && <p className="muted">Carregando...</p>}
        {!loading && activeCampaigns.length === 0 && (
          <p className="muted">Nenhuma campanha ativa no momento.</p>
        )}
        {!loading && activeCampaigns.length > 0 && (
          <div className="campaign-table-wrap">
            <table className="campaign-table">
              <thead>
                <tr>
                  <th>Campanha</th>
                  <th>Tipo</th>
                  <th style={{ textAlign: "center" }}>Score</th>
                  <th>Cliques</th>
                  <th>CTR</th>
                  <th>Conversões</th>
                  <th>Custo (30d)</th>
                  <th>Orçamento/dia</th>
                  <th>Ações</th>
                </tr>
              </thead>
              <tbody>
                {[...activeCampaigns]
                  .sort((a, b) => (a.lcs_score ?? 99) - (b.lcs_score ?? 99))
                  .map((c) => (
                    <CampaignRow
                      key={c.campaign_id}
                      campaign={c}
                      showActions
                      budgetEdits={budgetEdits}
                      setBudgetEdits={setBudgetEdits}
                      actionLoading={actionLoading}
                      onPause={handlePauseCampaign}
                      onUpdateBudget={handleUpdateBudget}
                    />
                  ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      <div className="card">
        <div
          className="card-title"
          style={{ display: "flex", justifyContent: "space-between", alignItems: "center", cursor: "pointer" }}
          onClick={() => setShowAll((v) => !v)}
        >
          <span>Todas as campanhas ({campaigns.length})</span>
          {showAll ? <ChevronUp size={18} /> : <ChevronDown size={18} />}
        </div>

        {showAll && (
          <>
            <div className="btn-row" style={{ marginTop: 10, marginBottom: 4 }}>
              <FilterButton active={statusFilter === "all"} onClick={() => setStatusFilter("all")}>
                Todas
              </FilterButton>
              <FilterButton
                active={statusFilter === "ENABLED"}
                onClick={() => setStatusFilter("ENABLED")}
              >
                Ativas
              </FilterButton>
              <FilterButton
                active={statusFilter === "PAUSED"}
                onClick={() => setStatusFilter("PAUSED")}
              >
                Pausadas
              </FilterButton>
            </div>

            <div className="campaign-table-wrap">
              <table className="campaign-table">
                <thead>
                  <tr>
                    <th>Campanha</th>
                    <th>Status</th>
                    <th>Tipo</th>
                    <th style={{ textAlign: "center" }}>Score</th>
                    <th>Cliques</th>
                    <th>CTR</th>
                    <th>Conversões</th>
                    <th>Custo (30d)</th>
                    <th>Orçamento/dia</th>
                    <th>Estratégia</th>
                  </tr>
                </thead>
                <tbody>
                  {sortedForTable.map((c) => (
                    <CampaignRow key={c.campaign_id} campaign={c} showStatus showBidding />
                  ))}
                </tbody>
              </table>
            </div>
          </>
        )}
      </div>

      <div className="card">
        <div className="card-title">
          <RefreshCw size={14} style={{ marginRight: 6, verticalAlign: "-2px" }} />
          Sobre estes dados
        </div>
        <p className="muted">
          {campaignsWithScore.length > 0
            ? "Estrutura e métricas de performance dos últimos 30 dias, obtidas diretamente da Google Ads API oficial (Basic Access aprovado)."
            : "Estrutura de campanhas obtida diretamente da Google Ads API oficial (Basic Access aprovado). Métricas de performance ainda não sincronizadas."}
        </p>
        {lastUpdated && (
          <p className="muted" style={{ marginTop: 4 }}>
            Última atualização: {new Date(lastUpdated).toLocaleString("pt-BR")}
          </p>
        )}
      </div>
    </div>
  );
}

function CampaignRow({
  campaign,
  showStatus,
  showBidding,
  showActions,
  budgetEdits,
  setBudgetEdits,
  actionLoading,
  onPause,
  onUpdateBudget,
}) {
  const m = campaign.metrics || {};
  const budgetValue = budgetEdits?.[campaign.campaign_id] ?? campaign.budget_amount?.toFixed(2) ?? "";
  const isPausing = actionLoading === `pause-${campaign.campaign_id}`;
  const isUpdatingBudget = actionLoading === `budget-${campaign.campaign_id}`;

  return (
    <tr>
      <td className="campaign-name-cell">{campaign.name}</td>
      {showStatus && (
        <td>
          <span
            className={`status-badge ${
              campaign.status === "ENABLED" ? "status-enabled" : "status-paused"
            }`}
          >
            {campaign.status === "ENABLED" ? "Ativa" : "Pausada"}
          </span>
        </td>
      )}
      <td>{TYPE_LABELS[campaign.campaign_type] || campaign.campaign_type}</td>
      <td style={{ textAlign: "center" }}>
        {typeof campaign.lcs_score === "number" ? <ScoreBadge score={campaign.lcs_score} /> : "—"}
      </td>
      <td>{(m.clicks ?? 0).toLocaleString("pt-BR")}</td>
      <td>{m.ctr !== undefined ? `${(m.ctr * 100).toFixed(2)}%` : "—"}</td>
      <td>{(m.conversions ?? 0).toFixed(0)}</td>
      <td>{m.cost !== undefined ? `R$ ${m.cost.toFixed(2)}` : "—"}</td>
      <td>
        {showActions ? (
          <div style={{ display: "flex", alignItems: "center", gap: 4 }}>
            <span style={{ fontSize: 12 }}>R$</span>
            <input
              type="text"
              value={budgetValue}
              onChange={(e) =>
                setBudgetEdits((prev) => ({ ...prev, [campaign.campaign_id]: e.target.value }))
              }
              style={{ width: 64, fontSize: 12, padding: "3px 6px", borderRadius: 6, border: "1px solid var(--gray-light)" }}
            />
            <button
              className="btn btn-outline btn-sm"
              style={{ padding: "3px 8px", fontSize: 11 }}
              onClick={() => onUpdateBudget(campaign)}
              disabled={isUpdatingBudget}
              title="Salvar novo orçamento diário"
            >
              {isUpdatingBudget ? "..." : "Salvar"}
            </button>
          </div>
        ) : (
          `R$ ${Number(campaign.budget_amount || 0).toFixed(2)}`
        )}
      </td>
      {showBidding && <td>{BIDDING_LABELS[campaign.bidding_strategy] || campaign.bidding_strategy}</td>}
      {showActions && (
        <td>
          <button
            className="btn btn-outline btn-sm"
            style={{ fontSize: 11, color: "var(--pink)", borderColor: "var(--pink)" }}
            onClick={() => onPause(campaign)}
            disabled={isPausing}
            title="Pausar esta campanha imediatamente"
          >
            {isPausing ? "Pausando..." : "⏸ Pausar"}
          </button>
        </td>
      )}
    </tr>
  );
}

function FilterButton({ active, onClick, children }) {
  return (
    <button
      className={active ? "btn btn-teal btn-sm" : "btn btn-outline btn-sm"}
      onClick={onClick}
    >
      {children}
    </button>
  );
}

function StatCard({ label, value, accent }) {
  return (
    <div className={`stat-card accent-${accent}`}>
      <div>
        <div className="stat-label">{label}</div>
        <div className="stat-value">{value}</div>
      </div>
    </div>
  );
}

function MiniStat({ label, value }) {
  return (
    <div style={{ minWidth: 100 }}>
      <div className="muted" style={{ fontSize: 12 }}>{label}</div>
      <div style={{ fontSize: 18, fontWeight: 700 }}>{value}</div>
    </div>
  );
}

/** Cor por faixa de nota — mesma lógica usada na badge compacta da tabela. */
function scoreColor(score) {
  if (score >= 7) return "#2E7D32"; // verde
  if (score >= 4) return "#B8860B"; // âmbar
  return "#C62828"; // vermelho
}

/** Badge compacta de score, usada dentro das linhas da tabela. */
function ScoreBadge({ score }) {
  const color = scoreColor(score);
  return (
    <span
      style={{
        display: "inline-block",
        minWidth: 36,
        padding: "2px 8px",
        borderRadius: 12,
        fontWeight: 700,
        fontSize: 13,
        color: "#fff",
        background: color,
      }}
      title="LCS Score (0-10): combina CTR, conversão, custo e estrutura da campanha"
    >
      {score.toFixed(1)}
    </span>
  );
}

/** Gauge circular maior, usado no card de resumo da conta no topo da página. */
function ScoreGauge({ score, size = 80 }) {
  const color = scoreColor(score);
  const pct = Math.max(0, Math.min(10, score)) / 10;
  const circumference = 2 * Math.PI * 36;
  const offset = circumference * (1 - pct);

  return (
    <div style={{ position: "relative", width: size, height: size, flexShrink: 0 }}>
      <svg width={size} height={size} viewBox="0 0 88 88">
        <circle cx="44" cy="44" r="36" fill="none" stroke="var(--gray-light)" strokeWidth="8" />
        <circle
          cx="44"
          cy="44"
          r="36"
          fill="none"
          stroke={color}
          strokeWidth="8"
          strokeDasharray={circumference}
          strokeDashoffset={offset}
          strokeLinecap="round"
          transform="rotate(-90 44 44)"
        />
      </svg>
      <div
        style={{
          position: "absolute",
          inset: 0,
          display: "flex",
          flexDirection: "column",
          alignItems: "center",
          justifyContent: "center",
        }}
      >
        <span style={{ fontSize: size * 0.28, fontWeight: 800, color }}>{score.toFixed(1)}</span>
        <span style={{ fontSize: 10, color: "var(--gray)" }}>/10</span>
      </div>
    </div>
  );
}

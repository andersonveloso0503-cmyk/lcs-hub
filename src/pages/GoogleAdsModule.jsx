import { useState } from "react";
import { ChevronDown, ChevronUp, RefreshCw, AlertTriangle } from "lucide-react";
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
  const { campaigns, lastUpdated, hasMetrics, loading, error } = useGoogleAdsSnapshot();
  const [showAll, setShowAll] = useState(false);
  const [statusFilter, setStatusFilter] = useState("all");

  const activeCampaigns = campaigns.filter((c) => c.status === "ENABLED");
  const pausedCampaigns = campaigns.filter((c) => c.status !== "ENABLED");
  const activeBudgetTotal = activeCampaigns.reduce((sum, c) => sum + (c.budget_amount || 0), 0);

  const filteredForTable =
    statusFilter === "all"
      ? campaigns
      : campaigns.filter((c) =>
          statusFilter === "ENABLED" ? c.status === "ENABLED" : c.status !== "ENABLED"
        );

  return (
    <div>
      <div className="page-header">
        <div>
          <h1 className="page-title">Google Ads</h1>
          <p className="page-subtitle">
            Estrutura real das campanhas — conta 3371725537
          </p>
        </div>
      </div>

      {error && (
        <div className="card error-card">
          <strong>Não foi possível conectar ao Firebase.</strong>
          <p>{error}</p>
        </div>
      )}

      <div className="pending-metrics-note">
        <AlertTriangle size={16} style={{ flexShrink: 0, marginTop: 1 }} />
        <span>
          <strong>Métricas pendentes.</strong> O acesso oficial à Google Ads API (Basic Access)
          ainda está em análise — por enquanto, esta tela mostra apenas a estrutura real das
          campanhas (nomes, status, orçamento, estratégia de lance), sem dados de cliques, custo
          ou conversões. O LCS Score e as sugestões de otimização por IA serão ativados quando os
          dados de performance estiverem disponíveis.
        </span>
      </div>

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
                  <th>Orçamento/dia</th>
                  <th>Estratégia</th>
                  <th>Início</th>
                </tr>
              </thead>
              <tbody>
                {activeCampaigns.map((c) => (
                  <CampaignRow key={c.campaign_id} campaign={c} />
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
                    <th>Orçamento/dia</th>
                    <th>Estratégia</th>
                    <th>Início</th>
                  </tr>
                </thead>
                <tbody>
                  {filteredForTable.map((c) => (
                    <CampaignRow key={c.campaign_id} campaign={c} showStatus />
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
          {hasMetrics
            ? "Dados de performance disponíveis."
            : "Estrutura de campanhas obtida via Supermetrics enquanto o Basic Access da Google Ads API oficial não é aprovado. Atualizado manualmente, não em tempo real automático."}
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

function CampaignRow({ campaign, showStatus }) {
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
      <td>R$ {Number(campaign.budget_amount || 0).toFixed(2)}</td>
      <td>{BIDDING_LABELS[campaign.bidding_strategy] || campaign.bidding_strategy}</td>
      <td>
        {campaign.start_date
          ? new Date(campaign.start_date).toLocaleDateString("pt-BR")
          : "—"}
      </td>
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

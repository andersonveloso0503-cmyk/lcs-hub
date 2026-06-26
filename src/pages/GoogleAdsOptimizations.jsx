import { useState, useEffect } from "react";
import {
  SlidersHorizontal,
  TrendingUp,
  Sparkles,
  Layers,
  Ban,
  PlusCircle,
  PauseCircle,
  FlaskConical,
  Clock,
  Globe,
  Monitor,
  Users,
  CircleDollarSign,
  Puzzle,
  Lock,
  Search,
} from "lucide-react";
import { useGoogleAdsSnapshot } from "../googleads/useGoogleAdsSnapshot";

// Catálogo completo de otimizações no estilo GIO Brain. As 3 marcadas com
// available: true já têm a mutação real implementada no backend
// (api/google-ads-fetch-real.js: add_negative_keyword, pause_campaign,
// update_budget). As demais aparecem bloqueadas — não é restrição de
// plano pago, é que ainda não foram desenvolvidas no LCS Hub; o texto do
// cadeado já deixa isso explícito pra não confundir com um upsell.
const OPTIMIZATIONS = [
  {
    id: "negative_keywords",
    icon: Ban,
    title: "Palavras Negativas",
    description: "Sugere e aplica termos de pesquisa irrelevantes como negativas",
    available: true,
  },
  {
    id: "pause_campaigns",
    icon: PauseCircle,
    title: "Pausar Campanhas",
    description: "Pausa campanhas com LCS Score baixo, sob sua aprovação",
    available: true,
  },
  {
    id: "budget_balance",
    icon: CircleDollarSign,
    title: "Balanço de Orçamento",
    description: "Ajusta o orçamento diário de cada campanha manualmente",
    available: true,
  },
  {
    id: "bid_strategy",
    icon: SlidersHorizontal,
    title: "Estratégia de Lance",
    description: "Altera a estratégia de lance da campanha",
    available: false,
  },
  {
    id: "adjust_bids",
    icon: TrendingUp,
    title: "Ajustar Lances",
    description: "Ajusta valores dos lances automaticamente",
    available: false,
  },
  {
    id: "create_ads",
    icon: Sparkles,
    title: "Criar Anúncios",
    description: "Cria novos anúncios com IA",
    available: false,
  },
  {
    id: "create_ad_groups",
    icon: Layers,
    title: "Criar Grupos de Anúncios",
    description: "Cria novos grupos de anúncios nas campanhas",
    available: false,
  },
  {
    id: "add_keywords",
    icon: PlusCircle,
    title: "Adição de Palavras",
    description: "Adiciona novas palavras-chave sugeridas",
    available: false,
  },
  {
    id: "ab_tests",
    icon: FlaskConical,
    title: "Testes A/B",
    description: "Executa testes A/B entre variações de anúncios",
    available: false,
  },
  {
    id: "scheduled_optimization",
    icon: Clock,
    title: "Otimização Agendada",
    description: "Agenda otimizações automaticamente em horários fixos",
    available: false,
  },
  {
    id: "geo_optimization",
    icon: Globe,
    title: "Otimização Geográfica",
    description: "Otimiza performance por localização geográfica",
    available: false,
  },
  {
    id: "device_optimization",
    icon: Monitor,
    title: "Otimização por Dispositivo",
    description: "Otimiza lances e segmentação por dispositivo",
    available: false,
  },
  {
    id: "demographic_optimization",
    icon: Users,
    title: "Otimização Demográfica",
    description: "Otimiza segmentação por dados demográficos",
    available: false,
  },
  {
    id: "schedule_optimization",
    icon: Clock,
    title: "Otimização por Horário",
    description: "Otimiza horários de melhor performance",
    available: false,
  },
  {
    id: "extension_optimization",
    icon: Puzzle,
    title: "Otimização de Extensões",
    description: "Otimiza extensões de anúncios (sitelinks, chamadas, etc.)",
    available: false,
  },
];

const STORAGE_KEY = "lcs_ads_optimizations_config";

function loadConfig() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return { enabled: {}, applyToAll: false, selectedCampaigns: [] };
    return JSON.parse(raw);
  } catch {
    return { enabled: {}, applyToAll: false, selectedCampaigns: [] };
  }
}

export default function GoogleAdsOptimizations() {
  const { campaigns, loading } = useGoogleAdsSnapshot();
  const [config, setConfig] = useState(loadConfig);
  const [search, setSearch] = useState("");

  // Persiste a configuração localmente — ela não dispara nenhuma execução
  // automática por conta própria ainda (não há cron lendo essas flags);
  // serve hoje como preferência salva para uso manual de cada otimização
  // nas telas correspondentes, e como base para um automatismo futuro.
  useEffect(() => {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(config));
  }, [config]);

  function toggleOptimization(id) {
    const opt = OPTIMIZATIONS.find((o) => o.id === id);
    if (!opt?.available) return; // cards bloqueados não reagem ao clique
    setConfig((prev) => ({ ...prev, enabled: { ...prev.enabled, [id]: !prev.enabled[id] } }));
  }

  function toggleApplyToAll() {
    setConfig((prev) => ({ ...prev, applyToAll: !prev.applyToAll }));
  }

  function toggleCampaign(campaignId) {
    setConfig((prev) => {
      const set = new Set(prev.selectedCampaigns);
      if (set.has(campaignId)) set.delete(campaignId);
      else set.add(campaignId);
      return { ...prev, selectedCampaigns: [...set] };
    });
  }

  function selectAllCampaigns() {
    setConfig((prev) => ({ ...prev, selectedCampaigns: campaigns.map((c) => c.campaign_id) }));
  }

  function clearAllCampaigns() {
    setConfig((prev) => ({ ...prev, selectedCampaigns: [] }));
  }

  const filteredCampaigns = campaigns.filter((c) =>
    c.name.toLowerCase().includes(search.toLowerCase())
  );
  const selectedCount = config.selectedCampaigns.length;

  return (
    <div>
      <div className="page-header">
        <div>
          <h1 className="page-title">Otimizações</h1>
          <p className="page-subtitle">
            Escolha quais otimizações ficam disponíveis e em quais campanhas aplicar
          </p>
        </div>
      </div>

      <div
        style={{
          display: "grid",
          gridTemplateColumns: "repeat(auto-fill, minmax(220px, 1fr))",
          gap: 12,
          marginBottom: 24,
        }}
      >
        {OPTIMIZATIONS.map((opt) => (
          <OptimizationCard
            key={opt.id}
            optimization={opt}
            enabled={Boolean(config.enabled[opt.id])}
            onToggle={() => toggleOptimization(opt.id)}
          />
        ))}
      </div>

      <div className="card">
        <div
          style={{
            display: "flex",
            alignItems: "flex-start",
            gap: 14,
            paddingBottom: 16,
            borderBottom: "1px solid var(--gray-light)",
            marginBottom: 16,
          }}
        >
          <div
            style={{
              width: 40,
              height: 40,
              borderRadius: 10,
              background: "var(--bg)",
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              flexShrink: 0,
            }}
          >
            <SlidersHorizontal size={18} className="muted" />
          </div>
          <div style={{ flex: 1 }}>
            <div style={{ fontWeight: 700 }}>Aplicar Otimizações em Todas as Campanhas</div>
            <p className="muted" style={{ margin: "2px 0 0", fontSize: 13 }}>
              Permite que as otimizações ativadas acima sejam consideradas válidas para todas as
              campanhas da conta, em vez de apenas as selecionadas abaixo.
            </p>
          </div>
          <ToggleSwitch checked={config.applyToAll} onChange={toggleApplyToAll} />
        </div>

        <div
          style={{
            display: "flex",
            justifyContent: "space-between",
            alignItems: "center",
            marginBottom: 14,
            opacity: config.applyToAll ? 0.5 : 1,
          }}
        >
          <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
            <strong style={{ fontSize: 16 }}>Seleção de Campanhas</strong>
            <span
              style={{
                background: "var(--teal)",
                color: "#fff",
                fontSize: 12,
                fontWeight: 700,
                padding: "2px 8px",
                borderRadius: 10,
              }}
            >
              {selectedCount}/{campaigns.length}
            </span>
          </div>
          <button className="btn btn-outline btn-sm" onClick={selectedCount === campaigns.length ? clearAllCampaigns : selectAllCampaigns} disabled={config.applyToAll}>
            {selectedCount === campaigns.length ? "Limpar seleção" : "Marcar Todas"}
          </button>
        </div>

        <div style={{ position: "relative", marginBottom: 14, opacity: config.applyToAll ? 0.5 : 1 }}>
          <Search size={15} style={{ position: "absolute", left: 12, top: "50%", transform: "translateY(-50%)", color: "var(--gray)" }} />
          <input
            type="text"
            placeholder="Buscar campanhas..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            disabled={config.applyToAll}
            style={{
              width: "100%",
              padding: "10px 12px 10px 36px",
              borderRadius: 10,
              border: "1px solid var(--gray-light)",
              fontSize: 14,
            }}
          />
        </div>

        {loading && <p className="muted">Carregando campanhas...</p>}

        <div style={{ display: "flex", flexDirection: "column", gap: 8, opacity: config.applyToAll ? 0.5 : 1 }}>
          {filteredCampaigns.map((c) => {
            const isSelected = config.selectedCampaigns.includes(c.campaign_id);
            return (
              <label
                key={c.campaign_id}
                style={{
                  display: "flex",
                  alignItems: "center",
                  gap: 12,
                  padding: "12px 14px",
                  borderRadius: 10,
                  border: `1px solid ${isSelected ? "var(--teal)" : "var(--gray-light)"}`,
                  background: isSelected ? "#ECFEFF" : "var(--white)",
                  cursor: config.applyToAll ? "default" : "pointer",
                }}
              >
                <input
                  type="checkbox"
                  checked={isSelected}
                  onChange={() => toggleCampaign(c.campaign_id)}
                  disabled={config.applyToAll}
                  style={{ width: 18, height: 18 }}
                />
                <span
                  style={{
                    width: 8,
                    height: 8,
                    borderRadius: "50%",
                    background: c.status === "ENABLED" ? "var(--teal)" : "var(--gray)",
                    flexShrink: 0,
                  }}
                />
                <div style={{ flex: 1 }}>
                  <div style={{ fontWeight: 600, fontSize: 14 }}>{c.name}</div>
                  <div className="muted" style={{ fontSize: 12 }}>ID: {c.campaign_id}</div>
                </div>
                {isSelected && (
                  <span
                    style={{
                      background: "var(--teal)",
                      color: "#fff",
                      fontSize: 11,
                      fontWeight: 700,
                      padding: "3px 10px",
                      borderRadius: 10,
                    }}
                  >
                    Selecionada
                  </span>
                )}
              </label>
            );
          })}
          {!loading && filteredCampaigns.length === 0 && (
            <p className="muted">Nenhuma campanha encontrada.</p>
          )}
        </div>
      </div>
    </div>
  );
}

function OptimizationCard({ optimization, enabled, onToggle }) {
  const { icon: Icon, title, description, available } = optimization;
  return (
    <div
      className="card"
      style={{
        padding: 16,
        border: enabled && available ? "1px solid var(--teal)" : "1px solid var(--gray-light)",
        opacity: available ? 1 : 0.75,
        position: "relative",
      }}
    >
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginBottom: 8 }}>
        <div
          style={{
            width: 36,
            height: 36,
            borderRadius: 9,
            background: enabled && available ? "#ECFEFF" : "var(--bg)",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
          }}
        >
          <Icon size={17} color={enabled && available ? "var(--teal)" : "var(--gray)"} />
        </div>
        {available ? (
          <ToggleSwitch checked={enabled} onChange={onToggle} />
        ) : (
          <span
            style={{
              display: "flex",
              alignItems: "center",
              gap: 4,
              background: "var(--gray-light)",
              color: "var(--gray)",
              fontSize: 11,
              fontWeight: 700,
              padding: "3px 8px",
              borderRadius: 10,
            }}
            title="Ainda não desenvolvido no LCS Hub"
          >
            <Lock size={10} /> EM BREVE
          </span>
        )}
      </div>
      <div style={{ fontWeight: 700, fontSize: 14, marginBottom: 2 }}>{title}</div>
      <p className="muted" style={{ fontSize: 12.5, margin: 0, lineHeight: 1.4 }}>
        {description}
      </p>
    </div>
  );
}

function ToggleSwitch({ checked, onChange }) {
  return (
    <button
      onClick={onChange}
      style={{
        width: 40,
        height: 22,
        borderRadius: 11,
        border: "none",
        background: checked ? "var(--teal)" : "var(--gray-light)",
        position: "relative",
        cursor: "pointer",
        flexShrink: 0,
        padding: 0,
      }}
    >
      <span
        style={{
          position: "absolute",
          top: 2,
          left: checked ? 20 : 2,
          width: 18,
          height: 18,
          borderRadius: "50%",
          background: "#fff",
          transition: "left 0.15s ease",
          boxShadow: "0 1px 3px rgba(0,0,0,0.3)",
        }}
      />
    </button>
  );
}

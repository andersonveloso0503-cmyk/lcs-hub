import { useState, useEffect } from "react";
import {
  SlidersHorizontal,
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
import { doc, getDoc, setDoc } from "firebase/firestore";
import { db } from "../firebase/config";
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
    description: "Sugere Maximizar Conversões ou Maximizar Cliques conforme volume de dados",
    available: true,
  },
  {
    id: "create_ads",
    icon: Sparkles,
    title: "Criar Anúncios",
    description: "IA gera headlines e descrições para novos anúncios (publicados pausados)",
    available: true,
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
    description: "IA sugere e adiciona novas palavras-chave relevantes",
    available: true,
  },
  {
    id: "ab_tests",
    icon: FlaskConical,
    title: "Testes A/B",
    description: "Cria 2 anúncios com ângulos diferentes — disponível só manualmente, por afetar a conta ao vivo",
    available: true,
    manualOnly: true,
  },
  {
    id: "geo_optimization",
    icon: Globe,
    title: "Otimização Geográfica",
    description: "Reduz lance fora de Porto Alegre e região metropolitana",
    available: true,
  },
  {
    id: "device_optimization",
    icon: Monitor,
    title: "Otimização por Dispositivo",
    description: "Ajusta lances comparando performance mobile vs desktop",
    available: true,
  },
  {
    id: "demographic_optimization",
    icon: Users,
    title: "Otimização Demográfica",
    description: "Otimiza segmentação por dados demográficos",
    available: false,
  },
  {
    id: "hourly_optimization",
    icon: Clock,
    title: "Otimização por Horário",
    description: "Ajusta lances por faixa horária baseado na taxa de conversão real",
    available: true,
  },
  {
    id: "extension_optimization",
    icon: Puzzle,
    title: "Otimização de Extensões",
    description: "Otimiza extensões de anúncios (sitelinks, chamadas, etc.)",
    available: false,
  },
];

const CONFIG_DOC_PATH = ["google_ads_config", "optimizations"];

const DEFAULT_CONFIG = { enabled: {}, applyToAll: false, selectedCampaigns: [] };

export default function GoogleAdsOptimizations() {
  const { campaigns, loading } = useGoogleAdsSnapshot();
  const [config, setConfig] = useState(DEFAULT_CONFIG);
  const [configLoaded, setConfigLoaded] = useState(false);
  const [search, setSearch] = useState("");
  const [saveStatus, setSaveStatus] = useState(null); // null | "saving" | "saved" | "error"

  // Carrega a config salva no Firestore uma vez ao montar a tela. Esse
  // mesmo documento é lido pelo cron automático (api/google-ads-fetch-real.js
  // -> action: "run_auto_optimizations"), então qualquer mudança feita aqui
  // já vale para a próxima execução automática, sem precisar de deploy.
  useEffect(() => {
    (async () => {
      try {
        const snap = await getDoc(doc(db, ...CONFIG_DOC_PATH));
        if (snap.exists()) setConfig({ ...DEFAULT_CONFIG, ...snap.data() });
      } catch (err) {
        console.error("Erro ao carregar config de otimizações:", err);
      } finally {
        setConfigLoaded(true);
      }
    })();
  }, []);

  // Salva no Firestore com debounce simples — evita escrever a cada
  // toggle clicado em sequência rápida, sem precisar de um botão "Salvar"
  // explícito (a experiência fica parecida com a do GIO Brain, onde o
  // toggle já reflete o estado real).
  useEffect(() => {
    if (!configLoaded) return; // não salva o estado padrão antes de carregar o real
    setSaveStatus("saving");
    const timeout = setTimeout(async () => {
      try {
        await setDoc(doc(db, ...CONFIG_DOC_PATH), config);
        setSaveStatus("saved");
      } catch (err) {
        console.error("Erro ao salvar config de otimizações:", err);
        setSaveStatus("error");
      }
    }, 600);
    return () => clearTimeout(timeout);
  }, [config, configLoaded]);

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

  const [running, setRunning] = useState(false);
  const [runResult, setRunResult] = useState(null);

  // Dispara a sincronização + otimizações automáticas imediatamente, sem
  // esperar o cron diário (que roda 8h da manhã). Útil pra testar a
  // configuração logo depois de mudá-la, ou pra forçar uma rodada extra.
  //
  // Esta chamada não envia a UPDATE_SECRET — em vez disso, o backend
  // aceita uma chamada sem secret quando vier acompanhada do header
  // x-panel-trigger com o valor fixo abaixo. Isso não substitui a
  // proteção da UPDATE_SECRET para o cron e para chamadas externas; serve
  // apenas para diferenciar "clique dentro do painel logado" de "chamada
  // anônima pela internet" nesta ação específica. Quem consegue chegar
  // até este botão já passou pelo login do painel (useAuth).
  async function handleRunNow() {
    if (!confirm("Sincronizar dados e aplicar as otimizações automáticas ativadas agora?")) return;
    setRunning(true);
    setRunResult(null);
    try {
      const res = await fetch("/api/google-ads-fetch-real", {
        method: "POST",
        headers: { "Content-Type": "application/json", "x-panel-trigger": "lcs-hub-optimizations-panel" },
        body: JSON.stringify({ autoOptimize: true }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Erro ao executar");
      setRunResult({ ok: true, data: data.auto_optimize });
    } catch (err) {
      setRunResult({ ok: false, message: err.message });
    } finally {
      setRunning(false);
    }
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
        <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
          {saveStatus && (
            <span className="muted" style={{ fontSize: 12 }}>
              {saveStatus === "saving" && "Salvando..."}
              {saveStatus === "saved" && "✓ Salvo"}
              {saveStatus === "error" && "Erro ao salvar"}
            </span>
          )}
          <button className="btn btn-teal btn-sm" onClick={handleRunNow} disabled={running}>
            {running ? "Executando..." : "▶ Rodar agora"}
          </button>
        </div>
      </div>

      <p className="muted" style={{ fontSize: 12, marginTop: -10, marginBottom: 16 }}>
        As otimizações ativadas abaixo rodam automaticamente todos os dias às 8h (horário de
        Brasília), e também sempre que sincronizar manualmente nesta tela com o botão "Rodar agora".
      </p>

      {runResult && (
        <div
          className="pending-metrics-note"
          style={
            runResult.ok
              ? { borderColor: "var(--teal)", background: "#ECFEFF" }
              : { borderColor: "var(--pink)", background: "#FFF0F6" }
          }
        >
          {runResult.ok ? (
            <span>
              {runResult.data?.skipped ? (
                runResult.data.skipped
              ) : runResult.data?.applied?.length > 0 ? (
                <>
                  <strong>{runResult.data.applied.length} otimização(ões) aplicada(s):</strong>
                  <ul style={{ margin: "6px 0 0", paddingLeft: 18 }}>
                    {runResult.data.applied.map((a, i) => (
                      <li key={i} style={{ fontSize: 13 }}>
                        {a.type === "pause_campaign" && `⏸ Pausada: "${a.campaign}" (score ${a.lcs_score})`}
                        {a.type === "negative_keyword" && `🎯 Negativa: "${a.term}" em "${a.campaign}"`}
                        {a.type === "add_keyword" && `➕ Palavra-chave: "${a.term}" em "${a.campaign}"`}
                        {a.type === "create_ad" && `✨ Anúncio criado (pausado) em "${a.campaign}" / "${a.ad_group}"`}
                        {a.type === "bidding_strategy" && `🎯 Lance: "${a.campaign}" mudou de ${a.from} para ${a.to}`}
                        {a.type === "hourly_bid" && `⏰ "${a.campaign}": lance ${a.hour}h ajustado (${((a.bid_modifier - 1) * 100).toFixed(0)}%)`}
                        {a.type === "device_bid" && `📱 "${a.campaign}": lance ${a.device} ajustado (${((a.bid_modifier - 1) * 100).toFixed(0)}%)`}
                        {a.type === "geo_bid" && `📍 "${a.campaign}": lance reduzido fora da região (R$${a.cost?.toFixed(2)} sem conversão)`}
                        {a.type === "budget_reduction" &&
                          `💰 "${a.campaign}": R$${a.old_amount.toFixed(2)} → R$${a.new_amount.toFixed(2)}`}
                      </li>
                    ))}
                  </ul>
                  {runResult.data.errors?.length > 0 && (
                    <p style={{ fontSize: 12, marginTop: 6, color: "var(--pink)" }}>
                      {runResult.data.errors.length} ação(ões) falharam — veja os logs do servidor para detalhes.
                    </p>
                  )}
                </>
              ) : (
                "Nenhuma otimização precisou ser aplicada agora."
              )}
            </span>
          ) : (
            <span>Erro: {runResult.message}</span>
          )}
        </div>
      )}

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
  const { icon: Icon, title, description, available, manualOnly } = optimization;
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
        {manualOnly ? (
          <span
            style={{
              fontSize: 11,
              fontWeight: 700,
              padding: "3px 8px",
              borderRadius: 10,
              background: "var(--blue)",
              color: "#fff",
            }}
            title="Disponível só no botão manual, dentro do card próprio — não entra na automação por afetar a conta ao vivo"
          >
            MANUAL
          </span>
        ) : available ? (
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

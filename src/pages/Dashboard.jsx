import { Users, AlertCircle, MessageCircle, Sparkles, Megaphone, Clock } from "lucide-react";
import { Link } from "react-router-dom";
import { useContacts } from "../crm/useContacts";
import { getPendingFollowUps } from "../crm/followUp";
import { useWhatsAppMessages } from "../crm/useWhatsAppMessages";
import { usePosts } from "../instagram/usePosts";
import { useGoogleAdsSnapshot } from "../googleads/useGoogleAdsSnapshot";

function isWithinNext7Days(isoDate) {
  if (!isoDate) return false;
  const date = new Date(isoDate);
  const now = new Date();
  const in7Days = new Date(now.getTime() + 7 * 24 * 60 * 60 * 1000);
  return date >= now && date <= in7Days;
}

export default function Dashboard() {
  const { contacts, loading, error } = useContacts();
  const { conversations } = useWhatsAppMessages();
  const { posts } = usePosts();
  const { campaigns, alerts: googleAdsAlerts, loading: gadsLoading } = useGoogleAdsSnapshot();

  const pendingFollowUps = getPendingFollowUps(contacts);
  const byStatus = {
    lead: contacts.filter((c) => (c.status || "lead") === "lead").length,
    proposta: contacts.filter((c) => c.status === "proposta").length,
    contrato: contacts.filter((c) => c.status === "contrato").length,
    cliente: contacts.filter((c) => c.status === "cliente").length,
  };

  // Instagram: posts agendados pra próxima semana + aguardando aprovação
  const scheduledThisWeek = posts.filter(
    (p) => p.status === "agendado" && isWithinNext7Days(p.scheduledAt)
  ).length;
  const pendingApproval = posts.filter((p) => p.status === "aguardando_aprovacao").length;

  // Google Ads: campanhas ativas + orçamento
  const activeCampaigns = campaigns.filter((c) => c.status === "ENABLED");
  const activeBudgetTotal = activeCampaigns.reduce((sum, c) => sum + (c.budget_amount || 0), 0);

  return (
    <div>
      <div className="page-header">
        <div>
          <h1 className="page-title">Visão geral</h1>
          <p className="page-subtitle">
            Dados em tempo real do Firestore — projeto lcscrm
          </p>
        </div>
      </div>

      {error && (
        <div className="card error-card">
          <strong>Não foi possível conectar ao Firebase.</strong>
          <p>{error}</p>
          <p className="muted">
            Verifique se as chaves em <code>src/firebase/config.js</code> estão
            corretas e se as regras do Firestore permitem leitura.
          </p>
        </div>
      )}

      {googleAdsAlerts && googleAdsAlerts.length > 0 && (
        <div className="pending-metrics-note" style={{ borderColor: "var(--pink)", background: "#FFF0F6" }}>
          <Megaphone size={16} style={{ flexShrink: 0, marginTop: 1, color: "var(--pink)" }} />
          <span>
            <strong>Alertas do Google Ads:</strong>
            <ul style={{ margin: "6px 0 0", paddingLeft: 18 }}>
              {googleAdsAlerts.map((a, i) => (
                <li key={i}>{a}</li>
              ))}
            </ul>
            <Link to="/google-ads" style={{ fontSize: 13 }}>Ver detalhes →</Link>
          </span>
        </div>
      )}

      {/* CRM */}
      <div className="stat-grid">
        <StatCard
          to="/crm"
          icon={Users}
          label="Contatos no CRM"
          value={loading ? "—" : contacts.length}
          accent="blue"
        />
        <StatCard
          to="/crm"
          icon={AlertCircle}
          label="Follow-up pendente"
          value={loading ? "—" : pendingFollowUps.length}
          accent={pendingFollowUps.length > 0 ? "amber" : "teal"}
        />
        <StatCard
          to="/crm"
          icon={MessageCircle}
          label="Conversas no WhatsApp"
          value={conversations.length}
          accent="pink"
        />
      </div>

      {/* Instagram + Google Ads */}
      <div className="stat-grid">
        <StatCard
          to="/instagram"
          icon={Clock}
          label="Posts aguardando aprovação"
          value={pendingApproval}
          accent={pendingApproval > 0 ? "pink" : "teal"}
          note={pendingApproval > 0 ? "revisar agora" : "tudo em dia"}
        />
        <StatCard
          to="/instagram"
          icon={Sparkles}
          label="Posts agendados (7 dias)"
          value={scheduledThisWeek}
          accent="amber"
        />
        <StatCard
          to="/google-ads"
          icon={Megaphone}
          label="Campanhas ativas"
          value={gadsLoading ? "—" : activeCampaigns.length}
          accent="blue"
          note={gadsLoading ? undefined : `R$ ${activeBudgetTotal.toFixed(2)}/dia`}
        />
      </div>

      <div className="card">
        <h3 className="card-title">Pipeline de vendas</h3>
        <div className="pipeline-mini">
          <MiniStat label="Lead" value={byStatus.lead} color="#1A56DB" />
          <MiniStat label="Proposta" value={byStatus.proposta} color="#D97706" />
          <MiniStat label="Contrato" value={byStatus.contrato} color="#0EA5A0" />
          <MiniStat label="Cliente" value={byStatus.cliente} color="#15803D" />
        </div>
        <Link to="/crm" className="btn btn-outline btn-sm" style={{ marginTop: 14 }}>
          Ver pipeline completo →
        </Link>
      </div>

      {pendingApproval > 0 && (
        <div className="card">
          <h3 className="card-title">
            <Clock size={15} style={{ marginRight: 6, verticalAlign: "-2px" }} />
            Instagram — aguardando sua aprovação
          </h3>
          <p className="muted">
            {pendingApproval} post{pendingApproval > 1 ? "s" : ""} gerados automaticamente,
            esperando revisão antes de agendar no Buffer.
          </p>
          <Link to="/instagram" className="btn btn-ig btn-sm" style={{ marginTop: 14 }}>
            Revisar agora →
          </Link>
        </div>
      )}

      {pendingFollowUps.length > 0 && (
        <div className="card">
          <h3 className="card-title">
            <AlertCircle size={15} style={{ marginRight: 6, verticalAlign: "-2px" }} />
            Follow-up pendente
          </h3>
          <ul className="roadmap-list">
            {pendingFollowUps.slice(0, 5).map((c) => (
              <li key={c.id}>
                <strong>{c.name || "Sem nome"}</strong> — {c._daysSinceContact} dias sem contato
              </li>
            ))}
          </ul>
          <Link to="/crm" className="btn btn-teal btn-sm" style={{ marginTop: 14 }}>
            Resolver agora →
          </Link>
        </div>
      )}

      <div className="card">
        <h3 className="card-title">Módulos disponíveis</h3>
        <ul className="roadmap-list">
          <li><strong>CRM</strong> — pipeline, WhatsApp (texto e áudio), follow-up automático, agente de IA</li>
          <li><strong>Instagram</strong> — legendas e criativos com IA, semana automática com fila de aprovação, Buffer</li>
          <li><strong>Google Ads</strong> — estrutura real das campanhas (conta 3371725537), alertas de status e orçamento</li>
        </ul>
      </div>
    </div>
  );
}

function StatCard({ to, icon: Icon, label, value, accent, note }) {
  const content = (
    <>
      <div className="stat-icon">
        <Icon size={20} />
      </div>
      <div>
        <div className="stat-label">{label}</div>
        <div className="stat-value">{value}</div>
        {note && <div className="stat-note">{note}</div>}
      </div>
    </>
  );

  if (to) {
    return (
      <Link to={to} className={`stat-card accent-${accent} clickable`}>
        {content}
      </Link>
    );
  }

  return <div className={`stat-card accent-${accent}`}>{content}</div>;
}

function MiniStat({ label, value, color }) {
  return (
    <div className="mini-stat">
      <span className="mini-stat-dot" style={{ background: color }} />
      <span className="mini-stat-label">{label}</span>
      <span className="mini-stat-value">{value}</span>
    </div>
  );
}

import { Users, Search, AlertCircle, MessageCircle } from "lucide-react";
import { Link } from "react-router-dom";
import { useContacts } from "../crm/useContacts";
import { getPendingFollowUps } from "../crm/followUp";
import { useWhatsAppMessages } from "../crm/useWhatsAppMessages";

export default function Dashboard() {
  const { contacts, loading, error } = useContacts();
  const { conversations } = useWhatsAppMessages();

  const pendingFollowUps = getPendingFollowUps(contacts);
  const byStatus = {
    lead: contacts.filter((c) => (c.status || "lead") === "lead").length,
    proposta: contacts.filter((c) => c.status === "proposta").length,
    contrato: contacts.filter((c) => c.status === "contrato").length,
  };

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

      <div className="stat-grid">
        <StatCard
          icon={Users}
          label="Contatos no CRM"
          value={loading ? "—" : contacts.length}
          accent="blue"
        />
        <StatCard
          icon={AlertCircle}
          label="Follow-up pendente"
          value={loading ? "—" : pendingFollowUps.length}
          accent={pendingFollowUps.length > 0 ? "amber" : "teal"}
        />
        <StatCard
          icon={MessageCircle}
          label="Conversas no WhatsApp"
          value={conversations.length}
          accent="pink"
        />
        <StatCard
          icon={Search}
          label="Campanhas ativas"
          value="—"
          accent="amber"
          note="módulo Google Ads em breve"
        />
      </div>

      <div className="card">
        <h3 className="card-title">Pipeline de vendas</h3>
        <div className="pipeline-mini">
          <MiniStat label="Lead" value={byStatus.lead} color="#1A56DB" />
          <MiniStat label="Proposta" value={byStatus.proposta} color="#D97706" />
          <MiniStat label="Contrato" value={byStatus.contrato} color="#0EA5A0" />
        </div>
        <Link to="/crm" className="btn btn-outline btn-sm" style={{ marginTop: 14 }}>
          Ver pipeline completo →
        </Link>
      </div>

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
        <h3 className="card-title">Próximos módulos</h3>
        <ul className="roadmap-list">
          <li><strong>Instagram</strong> — legendas, imagens e Buffer (Fase 3)</li>
          <li><strong>Google Ads</strong> — otimização com IA e dados reais (Fase 4)</li>
        </ul>
      </div>
    </div>
  );
}

function StatCard({ icon: Icon, label, value, accent, note }) {
  return (
    <div className={`stat-card accent-${accent}`}>
      <div className="stat-icon">
        <Icon size={20} />
      </div>
      <div>
        <div className="stat-label">{label}</div>
        <div className="stat-value">{value}</div>
        {note && <div className="stat-note">{note}</div>}
      </div>
    </div>
  );
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

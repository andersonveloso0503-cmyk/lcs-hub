import { useEffect, useState } from "react";
import { collection, getDocs } from "firebase/firestore";
import { db } from "../firebase/config";
import { Users, Instagram, Search, TrendingUp } from "lucide-react";

export default function Dashboard() {
  const [stats, setStats] = useState({
    contacts: null,
    opportunities: null,
    posts: null,
  });
  const [error, setError] = useState(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    async function loadStats() {
      try {
        const [contactsSnap, oppsSnap, postsSnap] = await Promise.all([
          getDocs(collection(db, "contacts")).catch(() => null),
          getDocs(collection(db, "opportunities")).catch(() => null),
          getDocs(collection(db, "posts")).catch(() => null),
        ]);

        setStats({
          contacts: contactsSnap ? contactsSnap.size : 0,
          opportunities: oppsSnap ? oppsSnap.size : 0,
          posts: postsSnap ? postsSnap.size : 0,
        });
      } catch (err) {
        setError(err.message);
      } finally {
        setLoading(false);
      }
    }
    loadStats();
  }, []);

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
          value={loading ? "—" : stats.contacts}
          accent="blue"
        />
        <StatCard
          icon={TrendingUp}
          label="Oportunidades"
          value={loading ? "—" : stats.opportunities}
          accent="teal"
        />
        <StatCard
          icon={Instagram}
          label="Posts criados"
          value={loading ? "—" : stats.posts}
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
        <h3 className="card-title">Próximos módulos</h3>
        <ul className="roadmap-list">
          <li><strong>CRM</strong> — contatos, pipeline e propostas (Fase 2)</li>
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

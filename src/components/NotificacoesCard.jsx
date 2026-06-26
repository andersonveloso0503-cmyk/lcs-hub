// src/components/NotificacoesCard.jsx
//
// Card de ativação de notificações push do WhatsApp, pra colocar no
// Dashboard. Mostra status (ativado / não ativado) e o contador atual
// de mensagens não lidas.
//
// Uso no Dashboard.jsx:
//
//   import { NotificacoesCard } from "../components/NotificacoesCard";
//   ...
//   <NotificacoesCard />

import { useState } from "react";
import { useWhatsAppBadge } from "../hooks/useWhatsAppBadge";

export function NotificacoesCard() {
  const { permission, unreadCount, ativarNotificacoes, marcarComoLidas } = useWhatsAppBadge();
  const [loading, setLoading] = useState(false);
  const [erro, setErro] = useState(null);

  const handleAtivar = async () => {
    setLoading(true);
    setErro(null);
    const result = await ativarNotificacoes();
    setLoading(false);
    if (!result.ok) setErro(result.error);
  };

  const ativado = permission === "granted";

  return (
    <div
      style={{
        background: "#ffffff",
        border: "1px solid #e4e6ea",
        borderRadius: 12,
        padding: 18,
        display: "flex",
        alignItems: "center",
        gap: 14,
      }}
    >
      <div
        style={{
          width: 42,
          height: 42,
          borderRadius: "50%",
          background: ativado ? "#EAF3DE" : "#FAEEDA",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          fontSize: 20,
          flexShrink: 0,
        }}
      >
        {ativado ? "🔔" : "🔕"}
      </div>

      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ fontSize: 14, fontWeight: 600, color: "#1a1d23" }}>
          Notificações do WhatsApp
        </div>
        <div style={{ fontSize: 12, color: "#6b7280", marginTop: 2 }}>
          {ativado
            ? unreadCount > 0
              ? `${unreadCount} mensagem${unreadCount > 1 ? "ns" : ""} não lida${unreadCount > 1 ? "s" : ""}`
              : "Ativado · tudo lido"
            : "Receba um alerta no celular quando chegar mensagem de cliente"}
        </div>
        {erro && (
          <div style={{ fontSize: 11, color: "#A32D2D", marginTop: 4 }}>{erro}</div>
        )}
      </div>

      {!ativado ? (
        <button
          onClick={handleAtivar}
          disabled={loading}
          style={{
            padding: "8px 14px",
            fontSize: 13,
            fontWeight: 500,
            borderRadius: 8,
            border: "none",
            background: "#185FA5",
            color: "#fff",
            cursor: loading ? "default" : "pointer",
            opacity: loading ? 0.7 : 1,
            whiteSpace: "nowrap",
          }}
        >
          {loading ? "Ativando..." : "Ativar"}
        </button>
      ) : unreadCount > 0 ? (
        <button
          onClick={marcarComoLidas}
          style={{
            padding: "8px 14px",
            fontSize: 13,
            fontWeight: 500,
            borderRadius: 8,
            border: "1px solid #d0d3da",
            background: "#fff",
            color: "#1a1d23",
            cursor: "pointer",
            whiteSpace: "nowrap",
          }}
        >
          Marcar como lidas
        </button>
      ) : null}
    </div>
  );
}

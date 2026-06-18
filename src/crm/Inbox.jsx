import { useState, useMemo } from "react";
import { Search } from "lucide-react";
import { useWhatsAppMessages } from "./useWhatsAppMessages";
import { normalizePhone } from "../services/evolutionApi";
import WhatsAppChat from "./WhatsAppChat";

const STATUS_OPTIONS = [
  { value: "", label: "Sem classificar" },
  { value: "lead", label: "Lead" },
  { value: "proposta", label: "Proposta" },
  { value: "contrato", label: "Contrato" },
  { value: "funcionario", label: "Funcionário" },
  { value: "curriculo", label: "Currículo" },
  { value: "inativo", label: "Inativo" },
];

function formatRelativeTime(ts) {
  if (!ts) return "";
  const diffMin = Math.floor((Date.now() - ts) / 60000);
  if (diffMin < 1) return "agora";
  if (diffMin < 60) return `${diffMin}min`;
  const diffH = Math.floor(diffMin / 60);
  if (diffH < 24) return `${diffH}h`;
  const diffD = Math.floor(diffH / 24);
  return `${diffD}d`;
}

export default function Inbox({ contacts, onCreateContact, onUpdateContactStatus }) {
  const { conversations, loading, getMessagesForPhone, logOutgoingMessage, logOutgoingAudio } =
    useWhatsAppMessages();
  const [selectedPhone, setSelectedPhone] = useState(null);
  const [search, setSearch] = useState("");
  const [savingPhone, setSavingPhone] = useState(null);

  // Cruza telefone com o contato completo do CRM, se existir
  const contactByPhone = useMemo(() => {
    const map = new Map();
    for (const c of contacts) {
      if (c.whatsapp) {
        map.set(normalizePhone(c.whatsapp), c);
      }
    }
    return map;
  }, [contacts]);

  const filtered = conversations.filter((conv) => {
    if (!search) return true;
    const contact = contactByPhone.get(conv.phone);
    const name = contact?.name || "";
    return (
      conv.phone.includes(search) ||
      name.toLowerCase().includes(search.toLowerCase())
    );
  });

  const selectedMessages = selectedPhone ? getMessagesForPhone(selectedPhone) : [];
  const selectedContact = selectedPhone ? contactByPhone.get(selectedPhone) : null;

  async function handleStatusChange(conv, newStatus) {
    setSavingPhone(conv.phone);
    const existing = contactByPhone.get(conv.phone);

    if (!newStatus) {
      // "Sem classificar" só se aplica se ainda não existir contato
      setSavingPhone(null);
      return;
    }

    if (existing) {
      await onUpdateContactStatus(existing.id, newStatus);
    } else {
      // Cria contato automaticamente a partir da conversa
      const guessedName = conv.messages.find((m) => m.pushName)?.pushName || "";
      await onCreateContact({
        name: guessedName,
        whatsapp: conv.phone,
        status: newStatus,
        service: "Limpeza",
        type: "Empresa",
      });
    }
    setSavingPhone(null);
  }

  return (
    <div className="inbox-layout">
      <div className="inbox-list">
        <div className="inbox-search">
          <Search size={15} />
          <input
            placeholder="Buscar conversa..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
        </div>

        {loading && <div className="inbox-loading">Carregando conversas...</div>}
        {!loading && filtered.length === 0 && (
          <div className="inbox-loading">
            Nenhuma conversa ainda. As mensagens recebidas pelo WhatsApp aparecerão aqui.
          </div>
        )}

        {filtered.map((conv) => {
          const contact = contactByPhone.get(conv.phone);
          const name = contact?.name;
          const currentStatus = contact?.status || "";
          return (
            <div
              key={conv.phone}
              className={"inbox-item-wrapper" + (selectedPhone === conv.phone ? " active" : "")}
            >
              <button
                className="inbox-item"
                onClick={() => setSelectedPhone(conv.phone)}
              >
                <div className="inbox-avatar">
                  {(name || conv.phone).charAt(0).toUpperCase()}
                </div>
                <div className="inbox-item-body">
                  <div className="inbox-item-top">
                    <span className="inbox-item-name">{name || `+${conv.phone}`}</span>
                    <span className="inbox-item-time">
                      {formatRelativeTime(conv.lastMessage?.messageTimestamp)}
                    </span>
                  </div>
                  <div className="inbox-item-preview">
                    {conv.lastMessage?.fromMe && <span className="preview-you">Você: </span>}
                    {conv.lastMessage?.text}
                  </div>
                </div>
              </button>
              <select
                className={"inbox-status-select" + (currentStatus ? " status-" + currentStatus : "")}
                value={currentStatus}
                disabled={savingPhone === conv.phone}
                onChange={(e) => handleStatusChange(conv, e.target.value)}
                onClick={(e) => e.stopPropagation()}
              >
                {STATUS_OPTIONS.map((opt) => (
                  <option key={opt.value} value={opt.value}>
                    {opt.label}
                  </option>
                ))}
              </select>
            </div>
          );
        })}
      </div>

      <div className="inbox-chat-panel">
        <WhatsAppChat
          phone={selectedPhone}
          messages={selectedMessages}
          contactName={selectedContact?.name}
          onSent={(text) => logOutgoingMessage(selectedPhone, text)}
          onSentAudio={(audioUrl, duration) => logOutgoingAudio(selectedPhone, audioUrl, duration)}
        />
      </div>
    </div>
  );
}

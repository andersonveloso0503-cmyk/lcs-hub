import { useState, useMemo } from "react";
import { Search } from "lucide-react";
import { useWhatsAppMessages } from "./useWhatsAppMessages";
import WhatsAppChat from "./WhatsAppChat";

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

export default function Inbox({ contacts }) {
  const { conversations, loading, getMessagesForPhone, logOutgoingMessage } =
    useWhatsAppMessages();
  const [selectedPhone, setSelectedPhone] = useState(null);
  const [search, setSearch] = useState("");

  // Cruza telefone com nome do contato no CRM, se existir
  const contactByPhone = useMemo(() => {
    const map = new Map();
    for (const c of contacts) {
      if (c.whatsapp) {
        const digits = c.whatsapp.replace(/\D/g, "");
        map.set(digits.startsWith("55") ? digits : "55" + digits, c.name);
      }
    }
    return map;
  }, [contacts]);

  const filtered = conversations.filter((conv) => {
    if (!search) return true;
    const name = contactByPhone.get(conv.phone) || "";
    return (
      conv.phone.includes(search) ||
      name.toLowerCase().includes(search.toLowerCase())
    );
  });

  const selectedMessages = selectedPhone ? getMessagesForPhone(selectedPhone) : [];

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
          const name = contactByPhone.get(conv.phone);
          return (
            <button
              key={conv.phone}
              className={"inbox-item" + (selectedPhone === conv.phone ? " active" : "")}
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
          );
        })}
      </div>

      <div className="inbox-chat-panel">
        <WhatsAppChat
          phone={selectedPhone}
          messages={selectedMessages}
          contactName={selectedPhone ? contactByPhone.get(selectedPhone) : ""}
          onSent={(text) => logOutgoingMessage(selectedPhone, text)}
        />
      </div>
    </div>
  );
}

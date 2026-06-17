import { AlertCircle, MessageCircle, Send } from "lucide-react";
import { getPendingFollowUps, buildFollowUpMessage } from "./followUp";
import { sendWhatsAppMessage } from "../services/evolutionApi";
import { useState } from "react";

export default function FollowUpPanel({ contacts, onTouchContact, onOpenChat }) {
  const pending = getPendingFollowUps(contacts);
  const [sendingId, setSendingId] = useState(null);

  async function handleAutoSend(contact) {
    if (!contact.whatsapp) return;
    setSendingId(contact.id);
    const message = buildFollowUpMessage(contact);
    const result = await sendWhatsAppMessage(contact.whatsapp, message);
    if (result.ok) {
      await onTouchContact(contact.id);
    }
    setSendingId(null);
  }

  if (pending.length === 0) {
    return (
      <div className="card followup-empty">
        <AlertCircle size={18} />
        <span>Nenhum follow-up pendente. Todos os contatos estão em dia! 🎉</span>
      </div>
    );
  }

  return (
    <div className="card followup-card">
      <div className="card-title followup-title">
        <AlertCircle size={16} />
        Follow-up pendente
        <span className="followup-badge">{pending.length}</span>
      </div>

      <div className="followup-list">
        {pending.map((contact) => (
          <div key={contact.id} className="followup-item">
            <div>
              <div className="followup-name">{contact.name || "Sem nome"}</div>
              <div className="followup-meta">
                {contact._daysSinceContact} dias sem contato · {contact.status}
              </div>
            </div>
            <div className="followup-actions">
              {contact.whatsapp && (
                <>
                  <button
                    className="btn btn-outline btn-sm"
                    onClick={() => onOpenChat(contact)}
                  >
                    <MessageCircle size={13} /> Ver chat
                  </button>
                  <button
                    className="btn btn-teal btn-sm"
                    onClick={() => handleAutoSend(contact)}
                    disabled={sendingId === contact.id}
                  >
                    <Send size={13} />
                    {sendingId === contact.id ? "Enviando..." : "Follow-up automático"}
                  </button>
                </>
              )}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

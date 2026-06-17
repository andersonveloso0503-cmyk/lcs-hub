import { useEffect, useRef, useState } from "react";
import { Send, Loader2 } from "lucide-react";
import { sendWhatsAppMessage } from "../services/evolutionApi";

function formatTime(ts) {
  if (!ts) return "";
  const d = new Date(ts);
  return d.toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" });
}

function formatDateLabel(ts) {
  if (!ts) return "";
  const d = new Date(ts);
  return d.toLocaleDateString("pt-BR", { day: "2-digit", month: "short" });
}

export default function WhatsAppChat({ phone, messages, onSent, contactName }) {
  const [text, setText] = useState("");
  const [sending, setSending] = useState(false);
  const [error, setError] = useState("");
  const bottomRef = useRef(null);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages]);

  async function handleSend() {
    if (!text.trim() || sending) return;
    setSending(true);
    setError("");

    const result = await sendWhatsAppMessage(phone, text.trim());
    if (result.ok) {
      await onSent(text.trim());
      setText("");
    } else {
      setError(result.error || "Erro ao enviar mensagem");
    }
    setSending(false);
  }

  function handleKeyDown(e) {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      handleSend();
    }
  }

  if (!phone) {
    return (
      <div className="chat-empty-state">
        Selecione uma conversa para visualizar as mensagens.
      </div>
    );
  }

  return (
    <div className="whatsapp-chat">
      <div className="chat-header">
        <div className="chat-avatar">{(contactName || phone).charAt(0).toUpperCase()}</div>
        <div>
          <div className="chat-header-name">{contactName || phone}</div>
          <div className="chat-header-phone">+{phone}</div>
        </div>
      </div>

      <div className="chat-messages">
        {messages.length === 0 && (
          <div className="chat-empty-state">Nenhuma mensagem ainda.</div>
        )}
        {messages.map((msg, i) => {
          const showDateLabel =
            i === 0 ||
            formatDateLabel(msg.messageTimestamp) !==
              formatDateLabel(messages[i - 1].messageTimestamp);
          return (
            <div key={msg.id || i}>
              {showDateLabel && (
                <div className="chat-date-divider">{formatDateLabel(msg.messageTimestamp)}</div>
              )}
              <div className={"chat-bubble-row" + (msg.fromMe ? " from-me" : "")}>
                <div className={"chat-bubble" + (msg.fromMe ? " from-me" : "")}>
                  <span className="chat-bubble-text">{msg.text}</span>
                  <span className="chat-bubble-time">{formatTime(msg.messageTimestamp)}</span>
                </div>
              </div>
            </div>
          );
        })}
        <div ref={bottomRef} />
      </div>

      {error && <div className="chat-error">{error}</div>}

      <div className="chat-input-row">
        <textarea
          placeholder="Digite uma mensagem..."
          value={text}
          onChange={(e) => setText(e.target.value)}
          onKeyDown={handleKeyDown}
          rows={1}
        />
        <button onClick={handleSend} disabled={sending || !text.trim()}>
          {sending ? <Loader2 size={16} className="spin" /> : <Send size={16} />}
        </button>
      </div>
    </div>
  );
}

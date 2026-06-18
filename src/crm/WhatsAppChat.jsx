import { useEffect, useRef, useState } from "react";
import { Send, Loader2, Mic, Square, Trash2, Play, Pause, FileText } from "lucide-react";
import { sendWhatsAppMessage, sendWhatsAppAudio } from "../services/evolutionApi";
import { useAudioRecorder } from "./useAudioRecorder";

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

function formatDuration(totalSeconds) {
  const m = Math.floor(totalSeconds / 60);
  const s = totalSeconds % 60;
  return `${m}:${String(s).padStart(2, "0")}`;
}

function AudioBubblePlayer({ src, fromMe }) {
  const audioRef = useRef(null);
  const [playing, setPlaying] = useState(false);
  const [duration, setDuration] = useState(0);
  const [current, setCurrent] = useState(0);

  function toggle() {
    const audio = audioRef.current;
    if (!audio) return;
    if (playing) {
      audio.pause();
    } else {
      audio.play();
    }
  }

  return (
    <div className={"audio-player" + (fromMe ? " from-me" : "")}>
      <button className="audio-play-btn" onClick={toggle}>
        {playing ? <Pause size={14} /> : <Play size={14} />}
      </button>
      <div className="audio-progress">
        <div
          className="audio-progress-fill"
          style={{ width: duration ? `${(current / duration) * 100}%` : "0%" }}
        />
      </div>
      <span className="audio-duration">
        {formatDuration(Math.floor(playing || current ? current : duration))}
      </span>
      <audio
        ref={audioRef}
        src={src}
        onPlay={() => setPlaying(true)}
        onPause={() => setPlaying(false)}
        onEnded={() => setPlaying(false)}
        onLoadedMetadata={(e) => setDuration(e.target.duration || 0)}
        onTimeUpdate={(e) => setCurrent(e.target.currentTime || 0)}
      />
    </div>
  );
}

export default function WhatsAppChat({ phone, messages, onSent, onSentAudio, contactName }) {
  const [text, setText] = useState("");
  const [sending, setSending] = useState(false);
  const [error, setError] = useState("");
  const bottomRef = useRef(null);

  const {
    recording,
    seconds,
    error: recError,
    startRecording,
    stopRecording,
    cancelRecording,
  } = useAudioRecorder();

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

  async function handleStopAndSendAudio() {
    const audio = await stopRecording();
    if (!audio || !audio.base64) return;

    setSending(true);
    setError("");

    const result = await sendWhatsAppAudio(phone, audio.base64);
    if (result.ok) {
      // Salva o áudio como data URL para reprodução imediata no chat
      const dataUrl = `data:${audio.mimeType};base64,${audio.base64}`;
      await onSentAudio(dataUrl, audio.durationSeconds);
    } else {
      setError(result.error || "Erro ao enviar áudio");
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
          const isAudio = msg.type === "audio" && msg.audioUrl;
          const isImage = msg.type === "image" && msg.fileUrl;
          const isDocument = msg.type === "document" && msg.fileUrl;
          return (
            <div key={msg.id || i}>
              {showDateLabel && (
                <div className="chat-date-divider">{formatDateLabel(msg.messageTimestamp)}</div>
              )}
              <div className={"chat-bubble-row" + (msg.fromMe ? " from-me" : "")}>
                <div
                  className={
                    "chat-bubble" +
                    (msg.fromMe ? " from-me" : "") +
                    (isAudio ? " audio-bubble" : "") +
                    (isImage ? " image-bubble" : "")
                  }
                >
                  {isAudio && <AudioBubblePlayer src={msg.audioUrl} fromMe={msg.fromMe} />}
                  {isImage && (
                    <a href={msg.fileUrl} target="_blank" rel="noopener noreferrer">
                      <img src={msg.fileUrl} alt={msg.text} className="chat-image-attachment" />
                    </a>
                  )}
                  {isDocument && (
                    <a
                      href={msg.fileUrl}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="chat-document-attachment"
                    >
                      <FileText size={18} />
                      <span>{msg.fileName || "Documento"}</span>
                    </a>
                  )}
                  {!isAudio && !isImage && !isDocument && (
                    <span className="chat-bubble-text">{msg.text}</span>
                  )}
                  <span className="chat-bubble-time">{formatTime(msg.messageTimestamp)}</span>
                </div>
              </div>
            </div>
          );
        })}
        <div ref={bottomRef} />
      </div>

      {(error || recError) && <div className="chat-error">{error || recError}</div>}

      <div className="chat-input-row">
        {recording ? (
          <div className="recording-bar">
            <span className="recording-dot" />
            <span>Gravando... {formatDuration(seconds)}</span>
            <button className="recording-cancel" onClick={cancelRecording} title="Cancelar">
              <Trash2 size={15} />
            </button>
          </div>
        ) : (
          <textarea
            placeholder="Digite uma mensagem..."
            value={text}
            onChange={(e) => setText(e.target.value)}
            onKeyDown={handleKeyDown}
            rows={1}
          />
        )}

        {recording ? (
          <button onClick={handleStopAndSendAudio} disabled={sending} className="mic-btn active">
            {sending ? <Loader2 size={16} className="spin" /> : <Square size={16} />}
          </button>
        ) : text.trim() ? (
          <button onClick={handleSend} disabled={sending}>
            {sending ? <Loader2 size={16} className="spin" /> : <Send size={16} />}
          </button>
        ) : (
          <button onClick={startRecording} className="mic-btn">
            <Mic size={16} />
          </button>
        )}
      </div>
    </div>
  );
}

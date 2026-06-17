import { useState } from "react";
import { X, Trash2, MessageCircle, FileText } from "lucide-react";
import WhatsAppChat from "./WhatsAppChat";
import { useWhatsAppMessages } from "./useWhatsAppMessages";
import { normalizePhone } from "../services/evolutionApi";

const STATUS_OPTIONS = [
  { value: "lead", label: "Lead" },
  { value: "proposta", label: "Proposta" },
  { value: "contrato", label: "Contrato" },
  { value: "inativo", label: "Inativo" },
];

export default function ContactModal({ contact, onClose, onUpdate, onDelete }) {
  const [tab, setTab] = useState("info");
  const [form, setForm] = useState({
    name: contact.name || "",
    company: contact.company || "",
    whatsapp: contact.whatsapp || "",
    email: contact.email || "",
    service: contact.service || "Limpeza",
    type: contact.type || "Empresa",
    employees: contact.employees || "",
    value: contact.value || "",
    status: contact.status || "lead",
    notes: contact.notes || "",
  });
  const [saving, setSaving] = useState(false);

  const { getMessagesForPhone, logOutgoingMessage } = useWhatsAppMessages();
  const phone = form.whatsapp ? normalizePhone(form.whatsapp) : null;
  const messages = phone ? getMessagesForPhone(phone) : [];

  function set(field, val) {
    setForm((f) => ({ ...f, [field]: val }));
  }

  async function handleSave() {
    setSaving(true);
    await onUpdate(contact.id, form);
    setSaving(false);
    onClose();
  }

  async function handleDelete() {
    if (confirm("Excluir este contato permanentemente?")) {
      await onDelete(contact.id);
      onClose();
    }
  }

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal-panel" onClick={(e) => e.stopPropagation()}>
        <div className="modal-header">
          <h2>{contact.name || "Novo contato"}</h2>
          <button className="modal-close" onClick={onClose}>
            <X size={18} />
          </button>
        </div>

        <div className="tabs modal-tabs">
          <button
            className={"tab" + (tab === "info" ? " active" : "")}
            onClick={() => setTab("info")}
          >
            <FileText size={14} /> Informações
          </button>
          <button
            className={"tab" + (tab === "chat" ? " active" : "")}
            onClick={() => setTab("chat")}
            disabled={!form.whatsapp}
          >
            <MessageCircle size={14} /> WhatsApp
          </button>
        </div>

        {tab === "info" && (
          <div className="modal-body">
            <div className="grid-2">
              <div>
                <label>Nome / Empresa</label>
                <input value={form.name} onChange={(e) => set("name", e.target.value)} />
              </div>
              <div>
                <label>Empresa (se diferente)</label>
                <input value={form.company} onChange={(e) => set("company", e.target.value)} />
              </div>
            </div>

            <div className="grid-2">
              <div>
                <label>WhatsApp</label>
                <input
                  placeholder="51999999999"
                  value={form.whatsapp}
                  onChange={(e) => set("whatsapp", e.target.value)}
                />
              </div>
              <div>
                <label>E-mail</label>
                <input value={form.email} onChange={(e) => set("email", e.target.value)} />
              </div>
            </div>

            <div className="grid-2">
              <div>
                <label>Tipo</label>
                <select value={form.type} onChange={(e) => set("type", e.target.value)}>
                  <option>Empresa</option>
                  <option>Condomínio</option>
                </select>
              </div>
              <div>
                <label>Serviço de interesse</label>
                <select value={form.service} onChange={(e) => set("service", e.target.value)}>
                  <option>Limpeza</option>
                  <option>Portaria</option>
                  <option>Portaria + Limpeza</option>
                  <option>Facilities</option>
                </select>
              </div>
            </div>

            <div className="grid-2">
              <div>
                <label>Nº de funcionários</label>
                <input
                  type="number"
                  value={form.employees}
                  onChange={(e) => set("employees", e.target.value)}
                />
              </div>
              <div>
                <label>Valor mensal (R$)</label>
                <input
                  type="number"
                  value={form.value}
                  onChange={(e) => set("value", e.target.value)}
                />
              </div>
            </div>

            <label>Status</label>
            <div className="chips">
              {STATUS_OPTIONS.map((opt) => (
                <div
                  key={opt.value}
                  className={"chip" + (form.status === opt.value ? " selected" : "")}
                  onClick={() => set("status", opt.value)}
                >
                  {opt.label}
                </div>
              ))}
            </div>

            <label>Observações</label>
            <textarea value={form.notes} onChange={(e) => set("notes", e.target.value)} />

            <div className="modal-footer">
              <button className="btn btn-outline btn-sm danger" onClick={handleDelete}>
                <Trash2 size={14} /> Excluir
              </button>
              <div className="btn-row">
                <button className="btn btn-outline btn-sm" onClick={onClose}>
                  Cancelar
                </button>
                <button className="btn btn-primary btn-sm" onClick={handleSave} disabled={saving}>
                  {saving ? "Salvando..." : "Salvar"}
                </button>
              </div>
            </div>
          </div>
        )}

        {tab === "chat" && (
          <div className="modal-body modal-body-chat">
            <WhatsAppChat
              phone={phone}
              messages={messages}
              contactName={form.name}
              onSent={(text) => logOutgoingMessage(phone, text)}
            />
          </div>
        )}
      </div>
    </div>
  );
}

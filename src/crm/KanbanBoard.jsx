import { useState } from "react";
import { Building2, AlertCircle, MessageCircle } from "lucide-react";
import { needsFollowUp, daysSince } from "./followUp";

const COLUMNS = [
  { id: "lead", label: "Lead", color: "#1A56DB" },
  { id: "proposta", label: "Proposta", color: "#D97706" },
  { id: "contrato", label: "Contrato", color: "#0EA5A0" },
  { id: "funcionario", label: "Funcionário", color: "#6D28D9" },
  { id: "inativo", label: "Inativo", color: "#94A3B8" },
];

function toDate(value) {
  if (!value) return null;
  if (value.toDate) return value.toDate();
  return new Date(value);
}

export default function KanbanBoard({ contacts, onStatusChange, onOpenContact, onOpenChat }) {
  const [draggingId, setDraggingId] = useState(null);
  const [dragOverCol, setDragOverCol] = useState(null);

  function handleDrop(columnId) {
    if (draggingId) {
      onStatusChange(draggingId, columnId);
    }
    setDraggingId(null);
    setDragOverCol(null);
  }

  return (
    <div className="kanban-board">
      {COLUMNS.map((col) => {
        const items = contacts.filter((c) => (c.status || "lead") === col.id);
        return (
          <div
            key={col.id}
            className={"kanban-col" + (dragOverCol === col.id ? " drag-over" : "")}
            onDragOver={(e) => {
              e.preventDefault();
              setDragOverCol(col.id);
            }}
            onDragLeave={() => setDragOverCol(null)}
            onDrop={() => handleDrop(col.id)}
          >
            <div className="kanban-col-header">
              <span className="kanban-dot" style={{ background: col.color }} />
              <span className="kanban-col-title">{col.label}</span>
              <span className="kanban-count">{items.length}</span>
            </div>

            <div className="kanban-col-body">
              {items.length === 0 && (
                <div className="kanban-empty">Nenhum contato aqui</div>
              )}
              {items.map((contact) => {
                const lastContact = toDate(contact.lastContactAt) || toDate(contact.createdAt);
                const days = daysSince(lastContact);
                const late = needsFollowUp(contact);

                return (
                  <div
                    key={contact.id}
                    className={"kanban-card" + (draggingId === contact.id ? " dragging" : "")}
                    draggable
                    onDragStart={() => setDraggingId(contact.id)}
                    onDragEnd={() => setDraggingId(null)}
                    onClick={() => onOpenContact(contact)}
                  >
                    {late && (
                      <div className="kanban-alert">
                        <AlertCircle size={12} />
                        <span>{days}d sem contato</span>
                      </div>
                    )}
                    <div className="kanban-card-name">{contact.name || "Sem nome"}</div>
                    {contact.company && (
                      <div className="kanban-card-meta">
                        <Building2 size={12} /> {contact.company}
                      </div>
                    )}
                    {contact.service && (
                      <span className="kanban-tag">{contact.service}</span>
                    )}
                    <div className="kanban-card-footer">
                      {contact.value && (
                        <span className="kanban-value">
                          R$ {Number(contact.value).toLocaleString("pt-BR")}
                        </span>
                      )}
                      <div className="kanban-card-actions">
                        {contact.whatsapp && (
                          <button
                            className="kanban-icon-btn"
                            title="Abrir chat"
                            onClick={(e) => {
                              e.stopPropagation();
                              onOpenChat(contact);
                            }}
                          >
                            <MessageCircle size={14} />
                          </button>
                        )}
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        );
      })}
    </div>
  );
}

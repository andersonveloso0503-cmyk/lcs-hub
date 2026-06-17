import { useState } from "react";
import { Plus, Users, MessageSquare, AlertCircle } from "lucide-react";
import { useContacts } from "../crm/useContacts";
import KanbanBoard from "../crm/KanbanBoard";
import Inbox from "../crm/Inbox";
import FollowUpPanel from "../crm/FollowUpPanel";
import ContactModal from "../crm/ContactModal";
import { getPendingFollowUps } from "../crm/followUp";

const TABS = [
  { id: "pipeline", label: "Pipeline", icon: Users },
  { id: "inbox", label: "Inbox WhatsApp", icon: MessageSquare },
  { id: "followup", label: "Follow-up", icon: AlertCircle },
];

export default function CRM() {
  const { contacts, loading, error, addContact, updateContact, deleteContact, touchLastContact } =
    useContacts();
  const [tab, setTab] = useState("pipeline");
  const [activeContact, setActiveContact] = useState(null);
  const [showNewModal, setShowNewModal] = useState(false);

  const pendingCount = getPendingFollowUps(contacts).length;

  async function handleStatusChange(contactId, newStatus) {
    await updateContact(contactId, { status: newStatus });
  }

  function handleOpenContact(contact) {
    setActiveContact(contact);
  }

  function handleNewContact() {
    setShowNewModal(true);
  }

  async function handleCreate(data) {
    await addContact(data);
  }

  if (error) {
    return (
      <div className="card error-card">
        <strong>Não foi possível conectar ao Firebase.</strong>
        <p>{error}</p>
      </div>
    );
  }

  return (
    <div>
      <div className="page-header">
        <div>
          <h1 className="page-title">CRM</h1>
          <p className="page-subtitle">Pipeline de vendas, WhatsApp e follow-up — tudo em um só lugar</p>
        </div>
        <button className="btn btn-primary" onClick={handleNewContact}>
          <Plus size={16} /> Novo contato
        </button>
      </div>

      <div className="tabs crm-tabs">
        {TABS.map(({ id, label, icon: Icon }) => (
          <button
            key={id}
            className={"tab" + (tab === id ? " active" : "")}
            onClick={() => setTab(id)}
          >
            <Icon size={14} /> {label}
            {id === "followup" && pendingCount > 0 && (
              <span className="tab-badge">{pendingCount}</span>
            )}
          </button>
        ))}
      </div>

      {loading && <div className="card">Carregando contatos...</div>}

      {!loading && tab === "pipeline" && (
        <KanbanBoard
          contacts={contacts}
          onStatusChange={handleStatusChange}
          onOpenContact={handleOpenContact}
          onOpenChat={handleOpenContact}
        />
      )}

      {!loading && tab === "inbox" && (
        <Inbox
          contacts={contacts}
          onCreateContact={addContact}
          onUpdateContactStatus={handleStatusChange}
        />
      )}

      {!loading && tab === "followup" && (
        <FollowUpPanel
          contacts={contacts}
          onTouchContact={touchLastContact}
          onOpenChat={handleOpenContact}
        />
      )}

      {activeContact && (
        <ContactModal
          contact={activeContact}
          onClose={() => setActiveContact(null)}
          onUpdate={updateContact}
          onDelete={deleteContact}
        />
      )}

      {showNewModal && (
        <ContactModal
          contact={{}}
          onClose={() => setShowNewModal(false)}
          onUpdate={async (_, data) => {
            await handleCreate(data);
          }}
          onDelete={async () => setShowNewModal(false)}
        />
      )}
    </div>
  );
}

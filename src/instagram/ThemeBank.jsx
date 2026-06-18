import { Trash2 } from "lucide-react";

export default function ThemeBank({ photos, loading, onRemove }) {
  if (loading) return <div className="card">Carregando banco de temas...</div>;

  if (photos.length === 0) {
    return (
      <div className="card placeholder-card">
        <p>Nenhuma foto no banco de temas ainda.</p>
        <p className="muted">
          Use o Editor de Fotos para processar suas fotos reais — elas aparecerão aqui prontas
          para reutilizar em qualquer post.
        </p>
      </div>
    );
  }

  return (
    <div className="card">
      <div className="card-title">🎯 Banco de Temas — fotos prontas para usar</div>
      <div className="photo-grid">
        {photos.map((p) => (
          <div key={p.id} className="photo-card">
            <button className="photo-remove" onClick={() => onRemove(p.id)}>
              <Trash2 size={13} />
            </button>
            <img src={p.imageUrl} alt={p.service} />
            <span className="kanban-tag" style={{ margin: "8px auto 0" }}>
              {p.service}
            </span>
          </div>
        ))}
      </div>
    </div>
  );
}

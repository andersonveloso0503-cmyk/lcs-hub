import React, { useState } from "react";

// ============================================================================
// BlogGeneratorModule — LCS Hub
// ============================================================================
// Gera posts de blog otimizados pra SEO a partir de um tema, usando a API da
// Groq (ou Claude, se preferir). O resultado final é um arquivo .html pronto
// pra você baixar e subir manualmente no cPanel da HostGator, na pasta /blog/.
//
// COMO INTEGRAR NO LCS HUB:
// 1. Salve este arquivo como /components/BlogGeneratorModule.jsx
// 2. Crie a rota de API /api/blog/generate.js (modelo no final deste arquivo,
//    em comentário) que chama a Groq e devolve { title, slug, metaDescription,
//    contentHtml }
// 3. Adicione esse componente como uma nova aba/rota no seu painel, do
//    mesmo jeito que o WeeklyPlanner do Instagram
// ============================================================================

const TEMAS_SUGERIDOS = [
  "Quanto custa terceirizar a portaria de um condomínio em Porto Alegre",
  "Limpeza terceirizada vs. funcionário CLT: vantagens e custos reais",
  "Como escolher uma empresa de zeladoria sem dor de cabeça",
  "Checklist: o que cobrar de uma empresa de portaria terceirizada",
  "Síndico: como reduzir custos do condomínio com terceirização",
  "Diferença entre portaria 24h, portaria remota e zeladoria",
  "Erros comuns ao contratar limpeza terceirizada para empresas",
  "Terceirização de mão de obra: o que diz a lei (CLT x prestação de serviço)",
];

export default function BlogGeneratorModule() {
  const [tema, setTema] = useState("");
  const [status, setStatus] = useState("idle"); // idle | loading | done | error
  const [post, setPost] = useState(null);
  const [erro, setErro] = useState("");

  async function gerarPost(temaEscolhido) {
    setStatus("loading");
    setErro("");
    try {
      const resp = await fetch("/api/whatsapp-webhook", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "generate_blog_post", tema: temaEscolhido }),
      });
      if (!resp.ok) throw new Error("Falha ao gerar o post (" + resp.status + ")");
      const data = await resp.json();
      setPost(data);
      setStatus("done");
    } catch (e) {
      setErro(e.message || "Erro desconhecido");
      setStatus("error");
    }
  }

  function baixarHtml() {
    if (!post) return;
    const blob = new Blob([post.contentHtml], { type: "text/html;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = post.slug + ".html";
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  }

  return (
    <div style={styles.page}>
      <header style={styles.header}>
        <span style={styles.eyebrow}>LCS Hub · Conteúdo</span>
        <h1 style={styles.h1}>Gerador de posts do blog</h1>
        <p style={styles.subhead}>
          Escolha um tema, gere o post e baixe o arquivo HTML pra subir no
          cPanel em <code style={styles.code}>/blog/</code>.
        </p>
      </header>

      <section style={styles.card}>
        <h2 style={styles.h2}>1. Escolha um tema</h2>
        <div style={styles.temaGrid}>
          {TEMAS_SUGERIDOS.map((t) => (
            <button
              key={t}
              onClick={() => setTema(t)}
              style={{
                ...styles.temaBtn,
                ...(tema === t ? styles.temaBtnActive : {}),
              }}
            >
              {t}
            </button>
          ))}
        </div>

        <label style={styles.label}>Ou digite um tema personalizado</label>
        <textarea
          value={tema}
          onChange={(e) => setTema(e.target.value)}
          placeholder="Ex: Manutenção predial preventiva: por que vale a pena"
          style={styles.textarea}
          rows={2}
        />

        <button
          onClick={() => gerarPost(tema)}
          disabled={!tema.trim() || status === "loading"}
          style={{
            ...styles.primaryBtn,
            ...(!tema.trim() || status === "loading" ? styles.btnDisabled : {}),
          }}
        >
          {status === "loading" ? "Gerando post…" : "Gerar post"}
        </button>

        {status === "error" && (
          <p style={styles.errorText}>Não consegui gerar o post: {erro}</p>
        )}
      </section>

      {status === "done" && post && (
        <section style={styles.card}>
          <h2 style={styles.h2}>2. Revisar e baixar</h2>

          <div style={styles.previewBox}>
            <p style={styles.previewLabel}>Título</p>
            <p style={styles.previewTitle}>{post.title}</p>

            <p style={styles.previewLabel}>Meta description</p>
            <p style={styles.previewMeta}>{post.metaDescription}</p>

            <p style={styles.previewLabel}>Slug do arquivo</p>
            <p style={styles.previewMeta}>{post.slug}.html</p>

            <p style={styles.previewLabel}>Prévia do conteúdo</p>
            <div
              style={styles.previewContent}
              dangerouslySetInnerHTML={{ __html: post.contentHtml }}
            />
          </div>

          <div style={styles.actionsRow}>
            <button onClick={baixarHtml} style={styles.primaryBtn}>
              Baixar arquivo .html
            </button>
            <button
              onClick={() => gerarPost(tema)}
              style={styles.secondaryBtn}
            >
              Gerar de novo
            </button>
          </div>

          <p style={styles.helperText}>
            Depois de baixar: entre no cPanel → Gerenciador de Arquivos →
            pasta <code style={styles.code}>/blog/</code> → fazer upload do
            arquivo. O link final será
            lcsterceirizacaors.com.br/blog/{post.slug}.html
          </p>
        </section>
      )}
    </div>
  );
}

const styles = {
  page: {
    fontFamily:
      "'Inter', -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif",
    maxWidth: 720,
    margin: "0 auto",
    padding: "32px 20px 80px",
    color: "#1A2433",
  },
  header: { marginBottom: 32 },
  eyebrow: {
    fontSize: 12,
    fontWeight: 700,
    letterSpacing: "0.08em",
    textTransform: "uppercase",
    color: "#3B6E91",
  },
  h1: { fontSize: 28, fontWeight: 800, margin: "8px 0 8px", color: "#13202E" },
  subhead: { fontSize: 15, color: "#5A6B7A", lineHeight: 1.5, margin: 0 },
  code: {
    background: "#EEF2F5",
    padding: "1px 6px",
    borderRadius: 4,
    fontSize: 13,
  },
  card: {
    background: "#FFFFFF",
    border: "1px solid #E3E8EC",
    borderRadius: 14,
    padding: 24,
    marginBottom: 20,
    boxShadow: "0 1px 2px rgba(20,30,40,0.04)",
  },
  h2: { fontSize: 16, fontWeight: 700, margin: "0 0 16px", color: "#13202E" },
  temaGrid: { display: "flex", flexDirection: "column", gap: 8, marginBottom: 18 },
  temaBtn: {
    textAlign: "left",
    padding: "12px 14px",
    borderRadius: 10,
    border: "1px solid #DCE3E8",
    background: "#FAFBFC",
    color: "#33424F",
    fontSize: 14,
    cursor: "pointer",
    lineHeight: 1.4,
  },
  temaBtnActive: {
    border: "1px solid #3B6E91",
    background: "#EAF2F7",
    color: "#1A4763",
    fontWeight: 600,
  },
  label: {
    display: "block",
    fontSize: 13,
    fontWeight: 600,
    color: "#5A6B7A",
    marginBottom: 6,
  },
  textarea: {
    width: "100%",
    boxSizing: "border-box",
    padding: 12,
    borderRadius: 10,
    border: "1px solid #DCE3E8",
    fontSize: 14,
    fontFamily: "inherit",
    marginBottom: 16,
    resize: "vertical",
  },
  primaryBtn: {
    background: "#1A4763",
    color: "#FFFFFF",
    border: "none",
    borderRadius: 10,
    padding: "12px 20px",
    fontSize: 14,
    fontWeight: 700,
    cursor: "pointer",
  },
  secondaryBtn: {
    background: "#FFFFFF",
    color: "#1A4763",
    border: "1px solid #1A4763",
    borderRadius: 10,
    padding: "12px 20px",
    fontSize: 14,
    fontWeight: 700,
    cursor: "pointer",
  },
  btnDisabled: { opacity: 0.5, cursor: "not-allowed" },
  errorText: { color: "#B3261E", fontSize: 13, marginTop: 12 },
  previewBox: {
    background: "#FAFBFC",
    border: "1px solid #E3E8EC",
    borderRadius: 10,
    padding: 16,
    marginBottom: 16,
  },
  previewLabel: {
    fontSize: 11,
    fontWeight: 700,
    letterSpacing: "0.05em",
    textTransform: "uppercase",
    color: "#8A99A6",
    margin: "12px 0 4px",
  },
  previewTitle: { fontSize: 18, fontWeight: 700, margin: 0, color: "#13202E" },
  previewMeta: { fontSize: 13, color: "#33424F", margin: 0, lineHeight: 1.5 },
  previewContent: {
    fontSize: 14,
    color: "#33424F",
    lineHeight: 1.6,
    marginTop: 6,
    maxHeight: 280,
    overflowY: "auto",
    paddingRight: 4,
  },
  actionsRow: { display: "flex", gap: 10, flexWrap: "wrap" },
  helperText: { fontSize: 12.5, color: "#8A99A6", marginTop: 14, lineHeight: 1.5 },
};

/* ============================================================================
   A lógica de geração fica em /lib/blogGenerator.js, chamada de dentro de
   /api/whatsapp-webhook.js através do campo action: "generate_blog_post".
   Veja o arquivo integracao-webhook.js pra saber exatamente o que colar lá.
   ============================================================================ */

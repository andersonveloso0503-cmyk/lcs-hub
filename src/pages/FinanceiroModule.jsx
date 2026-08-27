import React, { useMemo, useState } from "react";
import { Pencil, Trash2, Check, X, Plus } from "lucide-react";
import { useFinanceiro, editarLancamento, excluirLancamento, criarLancamento } from "../financeiro/useFinanceiro";

// ============================================================================
// FinanceiroModule — LCS Hub
// ============================================================================
// Painel de leitura (e agora edição/exclusão) dos gastos registrados pelo
// agente financeiro do WhatsApp (api/whatsapp-webhook.js →
// handleFinanceiroMessage). O REGISTRO em si acontece só pelo WhatsApp,
// mandando mensagem tipo "gastei 50 no mercado" pro número do bot a partir
// do número pessoal cadastrado em ADMIN_FINANCEIRO_WHATSAPP. Aqui dá pra
// corrigir descrição/valor de um lançamento errado, ou excluir ele.
//
// Os valores da LCS ficam bloqueados atrás de uma senha simples (o total e a
// tabela aparecem mascarados até destravar). É uma trava de tela, não
// segurança de verdade — quem souber abrir o código-fonte do site consegue
// ver a senha, então não guarda nada sensível além do que já está visível
// pra quem tem acesso ao LCS Hub. O desbloqueio vale só pra aba aberta: ao
// recarregar a página, tranca de novo.
// ============================================================================

const SENHA_LCS = "1561";

const EMPRESAS = {
  LCS: { label: "LCS Terceirização", emoji: "🏢", cor: "#1A4763", bg: "#EAF2F7" },
  VAN: { label: "Van Service", emoji: "🚐", cor: "#8A5A00", bg: "#FFF6E5" },
};

const FILTROS = [
  { valor: "todas", label: "Todas" },
  { valor: "LCS", label: "🏢 LCS" },
  { valor: "VAN", label: "🚐 Van Service" },
];

// Mesma lista de categorias usada pela IA no agente financeiro do WhatsApp
// (api/whatsapp-webhook.js → CATEGORIAS_FINANCEIRO), pra manter consistência
// entre o que é registrado por lá e o que é registrado direto aqui no site.
const CATEGORIAS = [
  "Combustível",
  "Manutenção de veículo",
  "Materiais e insumos",
  "Uniformes e EPI",
  "Salários e encargos",
  "Aluguel",
  "Impostos e taxas",
  "Marketing e publicidade",
  "Alimentação",
  "Telefone e internet",
  "Serviços terceirizados",
  "Outros",
];

function formatarMoeda(valor) {
  return (Number(valor) || 0).toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
}

function formatarData(timestamp) {
  if (!timestamp?.toDate) return "—";
  return timestamp.toDate().toLocaleDateString("pt-BR", {
    day: "2-digit",
    month: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  });
}

function ehMesAtual(timestamp) {
  if (!timestamp?.toDate) return false;
  const d = timestamp.toDate();
  const agora = new Date();
  return d.getMonth() === agora.getMonth() && d.getFullYear() === agora.getFullYear();
}

function EmpresaBadge({ empresa }) {
  const info = EMPRESAS[empresa] || { label: empresa || "—", emoji: "❓", cor: "#5A6B7A", bg: "#EEF2F5" };
  return (
    <span
      style={{
        display: "inline-block",
        padding: "3px 10px",
        borderRadius: 999,
        fontSize: 12,
        fontWeight: 700,
        background: info.bg,
        color: info.cor,
        whiteSpace: "nowrap",
      }}
    >
      {info.emoji} {info.label}
    </span>
  );
}

function CardTotal({ empresaKey, total, bloqueado }) {
  const info = EMPRESAS[empresaKey];
  return (
    <div style={{ ...styles.totalCard, borderColor: info.bg }}>
      <span style={styles.totalLabel}>
        {info.emoji} {info.label} · este mês
      </span>
      <span style={{ ...styles.totalValor, color: info.cor }}>
        {bloqueado ? "🔒 ••••••" : formatarMoeda(total)}
      </span>
    </div>
  );
}

function CadeadoLCS({ senha, setSenha, erro, onDesbloquear }) {
  return (
    <div style={styles.cadeadoBox}>
      <span style={{ fontSize: 24 }}>🔒</span>
      <p style={styles.cadeadoTexto}>Os valores da LCS estão protegidos. Digite a senha pra ver.</p>
      <form
        onSubmit={(e) => {
          e.preventDefault();
          onDesbloquear();
        }}
        style={styles.cadeadoForm}
      >
        <input
          type="password"
          inputMode="numeric"
          value={senha}
          onChange={(e) => setSenha(e.target.value)}
          placeholder="Senha"
          style={styles.cadeadoInput}
          autoFocus
        />
        <button type="submit" style={styles.cadeadoBtn}>
          Desbloquear
        </button>
      </form>
      {erro && <p style={styles.cadeadoErro}>Senha incorreta.</p>}
    </div>
  );
}

function LinhaLancamento({ lancamento, editando, onIniciarEdicao, onCancelarEdicao, onSalvar, onExcluir }) {
  const [descricaoEdit, setDescricaoEdit] = useState(lancamento.descricao || "");
  const [valorEdit, setValorEdit] = useState(String(lancamento.valor ?? ""));
  const [salvando, setSalvando] = useState(false);
  const [confirmandoExclusao, setConfirmandoExclusao] = useState(false);

  if (editando) {
    return (
      <tr>
        <td style={styles.td}>{formatarData(lancamento.criadoEm)}</td>
        <td style={styles.td}>
          <EmpresaBadge empresa={lancamento.empresa} />
        </td>
        <td style={styles.td}>{lancamento.categoria || "—"}</td>
        <td style={styles.td}>
          <input
            type="text"
            value={descricaoEdit}
            onChange={(e) => setDescricaoEdit(e.target.value)}
            style={styles.editInput}
            autoFocus
          />
        </td>
        <td style={{ ...styles.td, textAlign: "right" }}>
          <input
            type="number"
            step="0.01"
            value={valorEdit}
            onChange={(e) => setValorEdit(e.target.value)}
            style={{ ...styles.editInput, ...styles.editInputValor }}
          />
        </td>
        <td style={{ ...styles.td, textAlign: "right", whiteSpace: "nowrap" }}>
          <button
            title="Salvar"
            disabled={salvando}
            onClick={async () => {
              setSalvando(true);
              await onSalvar(lancamento.id, {
                descricao: descricaoEdit.trim(),
                valor: Number(valorEdit) || 0,
              });
              setSalvando(false);
            }}
            style={{ ...styles.iconBtn, color: "#1A7A3E" }}
          >
            <Check size={16} />
          </button>
          <button title="Cancelar" onClick={onCancelarEdicao} style={{ ...styles.iconBtn, color: "#5A6B7A" }}>
            <X size={16} />
          </button>
        </td>
      </tr>
    );
  }

  return (
    <tr>
      <td style={styles.td}>{formatarData(lancamento.criadoEm)}</td>
      <td style={styles.td}>
        <EmpresaBadge empresa={lancamento.empresa} />
      </td>
      <td style={styles.td}>{lancamento.categoria || "—"}</td>
      <td style={styles.td}>{lancamento.descricao || "—"}</td>
      <td style={{ ...styles.td, textAlign: "right", fontWeight: 700 }}>{formatarMoeda(lancamento.valor)}</td>
      <td style={{ ...styles.td, textAlign: "right", whiteSpace: "nowrap" }}>
        {confirmandoExclusao ? (
          <>
            <span style={styles.confirmaTexto}>Excluir?</span>
            <button
              title="Confirmar exclusão"
              onClick={() => onExcluir(lancamento.id)}
              style={{ ...styles.iconBtn, color: "#B3261E" }}
            >
              <Check size={16} />
            </button>
            <button
              title="Cancelar"
              onClick={() => setConfirmandoExclusao(false)}
              style={{ ...styles.iconBtn, color: "#5A6B7A" }}
            >
              <X size={16} />
            </button>
          </>
        ) : (
          <>
            <button title="Editar" onClick={() => onIniciarEdicao(lancamento.id)} style={styles.iconBtn}>
              <Pencil size={15} />
            </button>
            <button
              title="Excluir"
              onClick={() => setConfirmandoExclusao(true)}
              style={{ ...styles.iconBtn, color: "#B3261E" }}
            >
              <Trash2 size={15} />
            </button>
          </>
        )}
      </td>
    </tr>
  );
}

function NovoGastoModal({ onFechar, onCriado }) {
  const [empresa, setEmpresa] = useState("VAN");
  const [valor, setValor] = useState("");
  const [categoria, setCategoria] = useState(CATEGORIAS[0]);
  const [descricao, setDescricao] = useState("");
  const [salvando, setSalvando] = useState(false);
  const [erro, setErro] = useState("");

  async function handleSalvar(e) {
    e.preventDefault();
    const valorNumero = Number(String(valor).replace(",", "."));
    if (!valorNumero || valorNumero <= 0) {
      setErro("Digita um valor válido.");
      return;
    }
    setSalvando(true);
    setErro("");
    try {
      await criarLancamento({ empresa, valor: valorNumero, categoria, descricao: descricao.trim() });
      onCriado();
    } catch (err) {
      setErro("Erro ao salvar: " + err.message);
      setSalvando(false);
    }
  }

  return (
    <div style={styles.modalOverlay} onClick={onFechar}>
      <form style={styles.modalBox} onClick={(e) => e.stopPropagation()} onSubmit={handleSalvar}>
        <div style={styles.modalHeader}>
          <h2 style={styles.modalTitulo}>Novo gasto</h2>
          <button type="button" onClick={onFechar} style={styles.iconBtn}>
            <X size={18} />
          </button>
        </div>

        <label style={styles.modalLabel}>
          Empresa
          <div style={styles.modalEmpresaRow}>
            <button
              type="button"
              onClick={() => setEmpresa("LCS")}
              style={{ ...styles.modalEmpresaBtn, ...(empresa === "LCS" ? styles.modalEmpresaBtnAtivo : {}) }}
            >
              🏢 LCS
            </button>
            <button
              type="button"
              onClick={() => setEmpresa("VAN")}
              style={{ ...styles.modalEmpresaBtn, ...(empresa === "VAN" ? styles.modalEmpresaBtnAtivo : {}) }}
            >
              🚐 Van Service
            </button>
          </div>
        </label>

        <label style={styles.modalLabel}>
          Valor (R$)
          <input
            type="text"
            inputMode="decimal"
            value={valor}
            onChange={(e) => setValor(e.target.value)}
            placeholder="Ex: 350,00"
            style={styles.modalInput}
            autoFocus
          />
        </label>

        <label style={styles.modalLabel}>
          Categoria
          <select value={categoria} onChange={(e) => setCategoria(e.target.value)} style={styles.modalInput}>
            {CATEGORIAS.map((c) => (
              <option key={c} value={c}>
                {c}
              </option>
            ))}
          </select>
        </label>

        <label style={styles.modalLabel}>
          Descrição (opcional)
          <input
            type="text"
            value={descricao}
            onChange={(e) => setDescricao(e.target.value)}
            placeholder="Ex: mercado, combustível..."
            style={styles.modalInput}
          />
        </label>

        {erro && <p style={styles.cadeadoErro}>{erro}</p>}

        <div style={styles.modalAcoes}>
          <button type="button" onClick={onFechar} style={styles.modalBtnCancelar}>
            Cancelar
          </button>
          <button type="submit" disabled={salvando} style={styles.modalBtnSalvar}>
            {salvando ? "Salvando…" : "Salvar gasto"}
          </button>
        </div>
      </form>
    </div>
  );
}

export default function FinanceiroModule() {
  const { lancamentos, loading, error } = useFinanceiro();
  const [filtro, setFiltro] = useState("todas");
  const [lcsDesbloqueada, setLcsDesbloqueada] = useState(false);
  const [senhaInput, setSenhaInput] = useState("");
  const [senhaErro, setSenhaErro] = useState(false);
  const [editandoId, setEditandoId] = useState(null);
  const [modalAberto, setModalAberto] = useState(false);

  const totaisMes = useMemo(() => {
    const totais = { LCS: 0, VAN: 0 };
    for (const l of lancamentos) {
      if (ehMesAtual(l.criadoEm) && totais[l.empresa] !== undefined) {
        totais[l.empresa] += Number(l.valor) || 0;
      }
    }
    return totais;
  }, [lancamentos]);

  const lancamentosFiltrados = useMemo(() => {
    if (filtro === "todas") return lancamentos.filter((l) => l.empresa !== "LCS" || lcsDesbloqueada);
    if (filtro === "LCS") return lcsDesbloqueada ? lancamentos.filter((l) => l.empresa === "LCS") : [];
    return lancamentos.filter((l) => l.empresa === filtro);
  }, [lancamentos, filtro, lcsDesbloqueada]);

  function tentarDesbloquear() {
    if (senhaInput === SENHA_LCS) {
      setLcsDesbloqueada(true);
      setSenhaErro(false);
      setSenhaInput("");
    } else {
      setSenhaErro(true);
    }
  }

  async function handleSalvarEdicao(id, campos) {
    try {
      await editarLancamento(id, campos);
    } catch (err) {
      alert("Erro ao salvar: " + err.message);
    } finally {
      setEditandoId(null);
    }
  }

  async function handleExcluir(id) {
    try {
      await excluirLancamento(id);
    } catch (err) {
      alert("Erro ao excluir: " + err.message);
    }
  }

  const precisaMostrarCadeado = filtro === "LCS" && !lcsDesbloqueada;

  return (
    <div style={styles.page}>
      <header style={styles.header}>
        <span style={styles.eyebrow}>LCS Hub · Financeiro</span>
        <h1 style={styles.h1}>Gastos por WhatsApp</h1>
        <p style={styles.subhead}>
          Manda uma mensagem pro WhatsApp do bot a partir do seu número pessoal — algo tipo{" "}
          <strong>"gastei 50 no mercado"</strong> ou <strong>"120 combustível da van"</strong> — e o gasto
          aparece aqui na hora. Manda <strong>"resumo"</strong> a qualquer momento pra receber o total do
          mês direto no WhatsApp. Errou algo? Usa o lápis pra corrigir ou a lixeira pra excluir, direto na
          tabela abaixo.
        </p>
      </header>

      {error && <p style={styles.errorText}>Erro ao carregar lançamentos: {error}</p>}

      <div style={styles.totalsGrid}>
        <CardTotal empresaKey="LCS" total={totaisMes.LCS} bloqueado={!lcsDesbloqueada} />
        <CardTotal empresaKey="VAN" total={totaisMes.VAN} bloqueado={false} />
      </div>

      <section style={styles.card}>
        <div style={styles.filtroRowComBotao}>
          <div style={styles.filtroRow}>
            {FILTROS.map((f) => (
              <button
                key={f.valor}
                onClick={() => setFiltro(f.valor)}
                style={{
                  ...styles.filtroBtn,
                  ...(filtro === f.valor ? styles.filtroBtnActive : {}),
                }}
              >
                {f.label}
              </button>
            ))}
          </div>
          <button onClick={() => setModalAberto(true)} style={styles.novoGastoBtn}>
            <Plus size={16} />
            Novo gasto
          </button>
        </div>

        {precisaMostrarCadeado ? (
          <CadeadoLCS
            senha={senhaInput}
            setSenha={setSenhaInput}
            erro={senhaErro}
            onDesbloquear={tentarDesbloquear}
          />
        ) : loading ? (
          <p style={styles.helperText}>Carregando lançamentos…</p>
        ) : lancamentosFiltrados.length === 0 ? (
          <p style={styles.helperText}>
            Nenhum gasto registrado ainda{filtro !== "todas" ? " nesse filtro" : ""}. Manda uma mensagem pro
            WhatsApp do bot pra começar.
          </p>
        ) : (
          <div style={styles.tableWrap}>
            <table style={styles.table}>
              <thead>
                <tr>
                  <th style={styles.th}>Data</th>
                  <th style={styles.th}>Empresa</th>
                  <th style={styles.th}>Categoria</th>
                  <th style={styles.th}>Descrição</th>
                  <th style={{ ...styles.th, textAlign: "right" }}>Valor</th>
                  <th style={{ ...styles.th, textAlign: "right" }}>Ações</th>
                </tr>
              </thead>
              <tbody>
                {lancamentosFiltrados.map((l) => (
                  <LinhaLancamento
                    key={l.id}
                    lancamento={l}
                    editando={editandoId === l.id}
                    onIniciarEdicao={setEditandoId}
                    onCancelarEdicao={() => setEditandoId(null)}
                    onSalvar={handleSalvarEdicao}
                    onExcluir={handleExcluir}
                  />
                ))}
              </tbody>
            </table>
          </div>
        )}

        {!precisaMostrarCadeado && filtro === "todas" && !lcsDesbloqueada && (
          <p style={styles.avisoOculto}>
            🔒 Os lançamentos da LCS estão ocultos nesta lista. Clica em "🏢 LCS" e digita a senha pra ver
            eles.
          </p>
        )}
      </section>

      {modalAberto && (
        <NovoGastoModal onFechar={() => setModalAberto(false)} onCriado={() => setModalAberto(false)} />
      )}
    </div>
  );
}

const styles = {
  page: {
    fontFamily: "'Inter', -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif",
    maxWidth: 780,
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
  totalsGrid: {
    display: "grid",
    gridTemplateColumns: "repeat(auto-fit, minmax(220px, 1fr))",
    gap: 16,
    marginBottom: 20,
  },
  totalCard: {
    background: "#FFFFFF",
    border: "2px solid #E3E8EC",
    borderRadius: 14,
    padding: "18px 20px",
    display: "flex",
    flexDirection: "column",
    gap: 6,
    boxShadow: "0 1px 2px rgba(20,30,40,0.04)",
  },
  totalLabel: { fontSize: 13, fontWeight: 600, color: "#5A6B7A" },
  totalValor: { fontSize: 26, fontWeight: 800 },
  card: {
    background: "#FFFFFF",
    border: "1px solid #E3E8EC",
    borderRadius: 14,
    padding: 24,
    marginBottom: 20,
    boxShadow: "0 1px 2px rgba(20,30,40,0.04)",
  },
  filtroRow: { display: "flex", gap: 8, marginBottom: 16, flexWrap: "wrap" },
  filtroBtn: {
    padding: "10px 14px",
    borderRadius: 10,
    border: "1px solid #DCE3E8",
    background: "#FAFBFC",
    color: "#33424F",
    fontSize: 14,
    cursor: "pointer",
  },
  filtroBtnActive: {
    border: "1px solid #3B6E91",
    background: "#EAF2F7",
    color: "#1A4763",
    fontWeight: 600,
  },
  helperText: { fontSize: 13, color: "#5A6B7A", margin: 0, lineHeight: 1.5 },
  avisoOculto: {
    fontSize: 13,
    color: "#8A5A00",
    background: "#FFF6E5",
    padding: "10px 14px",
    borderRadius: 10,
    marginTop: 16,
  },
  errorText: {
    color: "#B3261E",
    fontSize: 13,
    marginBottom: 16,
    background: "#FCEBEB",
    padding: "10px 14px",
    borderRadius: 10,
  },
  tableWrap: { overflowX: "auto", marginTop: 4 },
  table: { width: "100%", borderCollapse: "collapse", fontSize: 13 },
  th: {
    textAlign: "left",
    padding: "8px 10px",
    borderBottom: "2px solid #E3E8EC",
    color: "#5A6B7A",
    fontSize: 12,
    textTransform: "uppercase",
    letterSpacing: "0.03em",
    whiteSpace: "nowrap",
  },
  td: {
    padding: "10px 10px",
    borderBottom: "1px solid #EEF2F5",
    color: "#33424F",
    whiteSpace: "nowrap",
  },
  iconBtn: {
    background: "none",
    border: "none",
    cursor: "pointer",
    padding: 6,
    borderRadius: 6,
    color: "#5A6B7A",
    display: "inline-flex",
    alignItems: "center",
    justifyContent: "center",
  },
  confirmaTexto: { fontSize: 12, color: "#B3261E", marginRight: 4 },
  editInput: {
    width: "100%",
    padding: "6px 8px",
    borderRadius: 6,
    border: "1px solid #3B6E91",
    fontSize: 13,
    fontFamily: "inherit",
  },
  editInputValor: { width: 90, textAlign: "right" },
  cadeadoBox: {
    display: "flex",
    flexDirection: "column",
    alignItems: "center",
    textAlign: "center",
    padding: "36px 16px",
    gap: 10,
  },
  cadeadoTexto: { fontSize: 14, color: "#5A6B7A", margin: 0, maxWidth: 320 },
  cadeadoForm: { display: "flex", gap: 8, marginTop: 6 },
  cadeadoInput: {
    padding: "10px 14px",
    borderRadius: 10,
    border: "1px solid #DCE3E8",
    fontSize: 15,
    width: 140,
    textAlign: "center",
    letterSpacing: "0.15em",
  },
  cadeadoBtn: {
    padding: "10px 16px",
    borderRadius: 10,
    border: "none",
    background: "#1A4763",
    color: "#FFFFFF",
    fontSize: 14,
    fontWeight: 600,
    cursor: "pointer",
  },
  cadeadoErro: { fontSize: 13, color: "#B3261E", margin: 0 },
  filtroRowComBotao: {
    display: "flex",
    justifyContent: "space-between",
    alignItems: "flex-start",
    flexWrap: "wrap",
    gap: 12,
    marginBottom: 16,
  },
  novoGastoBtn: {
    display: "inline-flex",
    alignItems: "center",
    gap: 6,
    padding: "10px 16px",
    borderRadius: 10,
    border: "none",
    background: "#1A4763",
    color: "#FFFFFF",
    fontSize: 14,
    fontWeight: 600,
    cursor: "pointer",
    whiteSpace: "nowrap",
  },
  modalOverlay: {
    position: "fixed",
    inset: 0,
    background: "rgba(19, 32, 46, 0.5)",
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    padding: 16,
    zIndex: 1000,
  },
  modalBox: {
    background: "#FFFFFF",
    borderRadius: 16,
    padding: 24,
    width: "100%",
    maxWidth: 380,
    display: "flex",
    flexDirection: "column",
    gap: 14,
    boxShadow: "0 8px 30px rgba(19,32,46,0.25)",
  },
  modalHeader: { display: "flex", justifyContent: "space-between", alignItems: "center" },
  modalTitulo: { fontSize: 18, fontWeight: 800, margin: 0, color: "#13202E" },
  modalLabel: {
    display: "flex",
    flexDirection: "column",
    gap: 6,
    fontSize: 13,
    fontWeight: 600,
    color: "#33424F",
  },
  modalInput: {
    padding: "10px 12px",
    borderRadius: 10,
    border: "1px solid #DCE3E8",
    fontSize: 14,
    fontFamily: "inherit",
    color: "#1A2433",
  },
  modalEmpresaRow: { display: "flex", gap: 8 },
  modalEmpresaBtn: {
    flex: 1,
    padding: "10px 12px",
    borderRadius: 10,
    border: "1px solid #DCE3E8",
    background: "#FAFBFC",
    color: "#33424F",
    fontSize: 14,
    cursor: "pointer",
  },
  modalEmpresaBtnAtivo: {
    border: "1px solid #3B6E91",
    background: "#EAF2F7",
    color: "#1A4763",
    fontWeight: 700,
  },
  modalAcoes: { display: "flex", justifyContent: "flex-end", gap: 10, marginTop: 4 },
  modalBtnCancelar: {
    padding: "10px 16px",
    borderRadius: 10,
    border: "1px solid #DCE3E8",
    background: "#FFFFFF",
    color: "#33424F",
    fontSize: 14,
    cursor: "pointer",
  },
  modalBtnSalvar: {
    padding: "10px 16px",
    borderRadius: 10,
    border: "none",
    background: "#1A4763",
    color: "#FFFFFF",
    fontSize: 14,
    fontWeight: 600,
    cursor: "pointer",
  },
};

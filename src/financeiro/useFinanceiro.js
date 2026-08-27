import { useEffect, useState } from "react";
import { collection, onSnapshot, query, orderBy, doc, updateDoc, deleteDoc, addDoc, serverTimestamp } from "firebase/firestore";
import { db } from "../firebase/config";

const COLLECTION = "financeiro_lancamentos";

export function useFinanceiro() {
  const [lancamentos, setLancamentos] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  useEffect(() => {
    const q = query(collection(db, COLLECTION), orderBy("criadoEm", "desc"));
    const unsub = onSnapshot(
      q,
      (snap) => {
        setLancamentos(snap.docs.map((d) => ({ id: d.id, ...d.data() })));
        setLoading(false);
      },
      (err) => {
        setError(err.message);
        setLoading(false);
      }
    );
    return () => unsub();
  }, []);

  return { lancamentos, loading, error };
}

// Edita um lançamento existente (usado pelo botão de editar na tabela do
// Financeiro). Recebe só os campos que mudaram — ex: { valor: 60 } ou
// { descricao: "mercado - novo texto" }.
export async function editarLancamento(id, campos) {
  await updateDoc(doc(db, COLLECTION, id), campos);
}

// Exclui um lançamento (usado pelo botão de excluir, pra corrigir gastos
// registrados errado).
export async function excluirLancamento(id) {
  await deleteDoc(doc(db, COLLECTION, id));
}

// Cria um lançamento direto pela tela (botão "+ Novo gasto"), sem passar
// pelo WhatsApp. Mesmo formato de dado que o agente financeiro salva, só que
// com origem "site" em vez de um telefone.
export async function criarLancamento({ empresa, valor, categoria, descricao }) {
  await addDoc(collection(db, COLLECTION), {
    empresa,
    valor: Number(valor),
    categoria: categoria || "Outros",
    descricao: descricao || "",
    textoOriginal: "",
    telefoneOrigem: "site",
    criadoEm: serverTimestamp(),
  });
}

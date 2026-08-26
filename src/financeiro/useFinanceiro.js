import { useEffect, useState } from "react";
import { collection, onSnapshot, query, orderBy } from "firebase/firestore";
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

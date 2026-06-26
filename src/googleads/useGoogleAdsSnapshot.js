import { useEffect, useState } from "react";
import { onSnapshot, doc, getDoc } from "firebase/firestore";
import { db } from "../firebase/config";

/**
 * Lê o snapshot de campanhas do Google Ads salvo no Firestore. Esse snapshot
 * é populado manualmente (via Claude + Supermetrics MCP) enquanto a Basic
 * Access da API oficial do Google Ads não é aprovada — o developer token
 * ainda está em status "Test Account", que retorna dados vazios.
 *
 * Quando a Basic Access for aprovada, esse hook pode ser trocado para buscar
 * direto de um endpoint /api/google-ads-data que chama a API real, sem
 * precisar alterar os componentes que consomem este hook (mesma forma de
 * retorno: { campaigns, lastUpdated, isRealData, loading, error }).
 */
export function useGoogleAdsSnapshot() {
  const [campaigns, setCampaigns] = useState([]);
  const [lastUpdated, setLastUpdated] = useState(null);
  const [hasMetrics, setHasMetrics] = useState(false);
  const [alerts, setAlerts] = useState([]);
  const [negativeKeywordSuggestions, setNegativeKeywordSuggestions] = useState([]);
  const [negativeKeywordsCheckedAt, setNegativeKeywordsCheckedAt] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  useEffect(() => {
    const ref = doc(db, "google_ads_snapshot", "current");
    const unsub = onSnapshot(
      ref,
      (snap) => {
        if (snap.exists()) {
          const data = snap.data();
          setCampaigns(data.campaigns || []);
          setLastUpdated(data.updatedAt || null);
          setHasMetrics(Boolean(data.hasMetrics));
          setAlerts(data.alerts || []);
          setNegativeKeywordSuggestions(data.negative_keyword_suggestions || []);
          setNegativeKeywordsCheckedAt(data.negative_keywords_checked_at || null);
        } else {
          setCampaigns([]);
          setLastUpdated(null);
          setHasMetrics(false);
          setAlerts([]);
          setNegativeKeywordSuggestions([]);
          setNegativeKeywordsCheckedAt(null);
        }
        setLoading(false);
      },
      (err) => {
        setError(err.message);
        setLoading(false);
      }
    );
    return () => unsub();
  }, []);

  return {
    campaigns,
    lastUpdated,
    hasMetrics,
    alerts,
    negativeKeywordSuggestions,
    negativeKeywordsCheckedAt,
    loading,
    error,
  };
}

/**
 * Leitura única (sem subscription), útil para checagens pontuais fora de
 * componentes React.
 */
export async function getGoogleAdsSnapshotOnce() {
  const ref = doc(db, "google_ads_snapshot", "current");
  const snap = await getDoc(ref);
  return snap.exists() ? snap.data() : null;
}

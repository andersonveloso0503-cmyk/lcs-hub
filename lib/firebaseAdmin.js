// /api/firebaseAdmin.js
// Inicializa o Firebase Admin SDK uma única vez, reaproveitando entre
// invocações da mesma função serverless (evita "app already exists").
// Usado por endpoints que precisam escrever no Firestore do lado do
// servidor (ex: salvar o snapshot do Google Ads buscado via Supermetrics).

import { initializeApp, getApps, cert } from "firebase-admin/app";
import { getFirestore } from "firebase-admin/firestore";

function getAdminApp() {
  const existing = getApps();
  if (existing.length > 0) return existing[0];

  let privateKey = process.env.FIREBASE_PRIVATE_KEY || "";

  // A Vercel às vezes preserva quebras de linha reais ao colar (em vez de
  // manter o "\n" literal do JSON original), e às vezes mantém o "\n"
  // literal. Normaliza para garantir quebras de linha reais nos dois casos.
  if (privateKey.includes("\\n")) {
    privateKey = privateKey.replace(/\\n/g, "\n");
  }
  // Remove aspas externas, caso tenham sido coladas junto por engano.
  privateKey = privateKey.replace(/^"(.*)"$/s, "$1").trim();

  return initializeApp({
    credential: cert({
      projectId: process.env.FIREBASE_PROJECT_ID,
      clientEmail: process.env.FIREBASE_CLIENT_EMAIL,
      privateKey,
    }),
  });
}

export function getAdminDb() {
  return getFirestore(getAdminApp());
}

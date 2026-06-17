import { useEffect, useState } from "react";
import {
  collection,
  onSnapshot,
  query,
  orderBy,
  addDoc,
  updateDoc,
  deleteDoc,
  doc,
  serverTimestamp,
} from "firebase/firestore";
import { db } from "../firebase/config";

const COLLECTION = "contacts";

export function useContacts() {
  const [contacts, setContacts] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  useEffect(() => {
    const q = query(collection(db, COLLECTION), orderBy("createdAt", "desc"));
    const unsub = onSnapshot(
      q,
      (snap) => {
        setContacts(snap.docs.map((d) => ({ id: d.id, ...d.data() })));
        setLoading(false);
      },
      (err) => {
        setError(err.message);
        setLoading(false);
      }
    );
    return () => unsub();
  }, []);

  async function addContact(data) {
    return addDoc(collection(db, COLLECTION), {
      ...data,
      status: data.status || "lead",
      createdAt: serverTimestamp(),
      lastContactAt: serverTimestamp(),
    });
  }

  async function updateContact(id, data) {
    return updateDoc(doc(db, COLLECTION, id), data);
  }

  async function deleteContact(id) {
    return deleteDoc(doc(db, COLLECTION, id));
  }

  async function touchLastContact(id) {
    return updateDoc(doc(db, COLLECTION, id), {
      lastContactAt: serverTimestamp(),
    });
  }

  return { contacts, loading, error, addContact, updateContact, deleteContact, touchLastContact };
}

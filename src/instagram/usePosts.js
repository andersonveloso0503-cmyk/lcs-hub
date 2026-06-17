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

const COLLECTION = "posts";

export function usePosts() {
  const [posts, setPosts] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  useEffect(() => {
    const q = query(collection(db, COLLECTION), orderBy("createdAt", "desc"));
    const unsub = onSnapshot(
      q,
      (snap) => {
        setPosts(snap.docs.map((d) => ({ id: d.id, ...d.data() })));
        setLoading(false);
      },
      (err) => {
        setError(err.message);
        setLoading(false);
      }
    );
    return () => unsub();
  }, []);

  async function savePost(data) {
    return addDoc(collection(db, COLLECTION), {
      ...data,
      status: data.status || "rascunho",
      createdAt: serverTimestamp(),
    });
  }

  async function updatePost(id, data) {
    return updateDoc(doc(db, COLLECTION, id), data);
  }

  async function deletePost(id) {
    return deleteDoc(doc(db, COLLECTION, id));
  }

  return { posts, loading, error, savePost, updatePost, deletePost };
}

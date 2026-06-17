import { initializeApp } from "firebase/app";
import { getFirestore } from "firebase/firestore";

const firebaseConfig = {
  apiKey: "AIzaSyAHOwdtTpZXVr_BNwG5x54gfEfD3PHSCVk",
  authDomain: "lcscrm.firebaseapp.com",
  projectId: "lcscrm",
  storageBucket: "lcscrm.firebasestorage.app",
  messagingSenderId: "539374293432",
  appId: "1:539374293432:web:a83bf9e10d22440c93bf4d",
  measurementId: "G-6XX7L6J5X2",
};

export const app = initializeApp(firebaseConfig);
export const db = getFirestore(app);

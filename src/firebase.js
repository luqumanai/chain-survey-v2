import { initializeApp } from 'firebase/app';
import { getAuth } from 'firebase/auth';
import { getFirestore } from 'firebase/firestore';

const firebaseConfig = {
  apiKey: "AIzaSyAhT5guVs4vJe8mcxxGCBxoEXezFoUsFF8",
  authDomain: "chain-survey-v2.firebaseapp.com",
  projectId: "chain-survey-v2",
  storageBucket: "chain-survey-v2.firebasestorage.app",
  messagingSenderId: "874022192795",
  appId: "1:874022192795:web:cde1278df9fbefab05e83e"
};

const app = initializeApp(firebaseConfig);

// This is the object every other file uses to check who's logged in,
// log someone in, log someone out, etc.
export const auth = getAuth(app);

// The cloud database - this is what saved projects will live in from
// Stage 4 onward, instead of just the browser's local storage.
export const db = getFirestore(app);

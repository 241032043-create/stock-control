import { initializeApp } from 'https://www.gstatic.com/firebasejs/12.1.0/firebase-app.js';
import {
  browserLocalPersistence,
  getAuth,
  setPersistence,
} from 'https://www.gstatic.com/firebasejs/12.1.0/firebase-auth.js';
import { getFirestore } from 'https://www.gstatic.com/firebasejs/12.1.0/firebase-firestore.js';

const firebaseConfig = {
  apiKey: 'AIzaSyD83hRkMstvjphAIepqftadZhM19qGJ0',
  authDomain: 'legal-stock-control.firebaseapp.com',
  projectId: 'legal-stock-control',
  storageBucket: 'legal-stock-control.firebasestorage.app',
  messagingSenderId: '924124435984',
  appId: '1:924124435984:web:7a936050dc4af48ef75c95',
  measurementId: 'G-R8P0KY5FBK',
};

const firebaseApp = initializeApp(firebaseConfig);
const auth = getAuth(firebaseApp);
const db = getFirestore(firebaseApp);
const authReady = setPersistence(auth, browserLocalPersistence);

export { auth, authReady, db };
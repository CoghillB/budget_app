/* ===========================================================
   Budget Quest — Firebase sync layer
   - Anonymous auth (so Firestore rules can require auth)
   - One Firestore document per household, real-time listener
   - Whole-state last-write-wins; debounced pushes
   =========================================================== */

import { initializeApp } from 'https://www.gstatic.com/firebasejs/10.13.1/firebase-app.js';
import {
  getAuth, signInAnonymously, onAuthStateChanged
} from 'https://www.gstatic.com/firebasejs/10.13.1/firebase-auth.js';
import {
  getFirestore, doc, setDoc, getDoc, onSnapshot, serverTimestamp
} from 'https://www.gstatic.com/firebasejs/10.13.1/firebase-firestore.js';

let app = null;
let auth = null;
let db = null;
let unsubscribeSnap = null;
let currentCode = null;
let onRemoteCb = null;
let onStatusCb = null;
let lastPushedPayload = null;
let pushTimer = null;
let initialized = false;

function setStatus(s) { if (onStatusCb) onStatusCb(s); }

export function isConfigured(config) {
  if (!config) return false;
  const required = ['apiKey', 'authDomain', 'projectId', 'appId'];
  for (const k of required) {
    const v = config[k];
    if (!v || typeof v !== 'string') return false;
    if (v.includes('YOUR_')) return false;
  }
  return true;
}

export function isValidCode(code) {
  if (!code || typeof code !== 'string') return false;
  const trimmed = code.trim();
  return trimmed.length >= 6 && trimmed.length <= 50 && /^[a-z0-9-]+$/i.test(trimmed);
}

export function onStatus(cb) { onStatusCb = cb; }

export async function init(config) {
  if (initialized) return;
  app = initializeApp(config);
  auth = getAuth(app);
  db = getFirestore(app);
  setStatus('connecting');
  await signInAnonymously(auth);
  await new Promise(resolve => {
    const stop = onAuthStateChanged(auth, user => {
      if (user) { stop(); resolve(user); }
    });
  });
  initialized = true;
}

/**
 * Join (or create) a household document. Subscribes to remote changes.
 * Returns the existing remote payload (or null if the household is new).
 */
export async function joinHousehold(code, onRemote) {
  if (!initialized) throw new Error('sync.init() must be called first');
  if (unsubscribeSnap) { unsubscribeSnap(); unsubscribeSnap = null; }

  currentCode = code.trim().toLowerCase();
  onRemoteCb = onRemote;

  const ref = doc(db, 'households', currentCode);
  setStatus('connecting');
  const snap = await getDoc(ref);
  const existing = snap.exists() && snap.data().payload
    ? safeParse(snap.data().payload)
    : null;

  unsubscribeSnap = onSnapshot(ref, (snap) => {
    if (!snap.exists()) return;
    const data = snap.data();
    if (!data || !data.payload) return;
    if (data.payload === lastPushedPayload) {
      // This snapshot is from our own write
      setStatus('synced');
      return;
    }
    const remote = safeParse(data.payload);
    if (remote && onRemoteCb) {
      onRemoteCb(remote);
      setStatus('synced');
    }
  }, (err) => {
    console.warn('Firestore listener error', err);
    setStatus('error');
  });

  setStatus('synced');
  return existing;
}

/**
 * Push the current local state. Debounced so rapid edits coalesce.
 */
export function pushLocal(state) {
  if (!currentCode || !db) return;
  clearTimeout(pushTimer);
  setStatus('syncing');
  pushTimer = setTimeout(async () => {
    try {
      const payload = JSON.stringify(state);
      lastPushedPayload = payload;
      const ref = doc(db, 'households', currentCode);
      await setDoc(ref, { payload, updatedAt: serverTimestamp() });
      setStatus('synced');
    } catch (e) {
      console.warn('Sync push failed', e);
      setStatus('error');
    }
  }, 500);
}

export function disconnect() {
  if (unsubscribeSnap) { unsubscribeSnap(); unsubscribeSnap = null; }
  currentCode = null;
  onRemoteCb = null;
  lastPushedPayload = null;
  setStatus('local');
}

export function getCurrentCode() { return currentCode; }

function safeParse(s) {
  try { return JSON.parse(s); } catch { return null; }
}

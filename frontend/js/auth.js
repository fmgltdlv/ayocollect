import { api, setAuthTokenGetter, setUnauthorizedHandler } from './api.js';

const STORAGE_KEY = 'ayo_google_credential';

let currentEmail = null;
let onAuthChange = null;
let googleReady = false;
let googleLoadStarted = false;
const readyQueue = [];

export function isLocalDev() {
  const h = location.hostname;
  return h === 'localhost' || h === '127.0.0.1';
}

export function isAuthRequired() {
  if (typeof window !== 'undefined' && window.AYO_AUTH_DISABLED) return false;
  return !isLocalDev();
}

export function getToken() {
  if (!isAuthRequired()) return null;
  return sessionStorage.getItem(STORAGE_KEY);
}

function setToken(credential) {
  if (credential) sessionStorage.setItem(STORAGE_KEY, credential);
  else sessionStorage.removeItem(STORAGE_KEY);
}

function decodeEmail(credential) {
  try {
    const payload = JSON.parse(atob(credential.split('.')[1].replace(/-/g, '+').replace(/_/g, '/')));
    return payload.email || null;
  } catch {
    return null;
  }
}

function notifyAuthChange(authenticated) {
  if (onAuthChange) onAuthChange({ authenticated, email: currentEmail, skipped: !isAuthRequired() });
}

export function signOut() {
  if (window.google?.accounts?.id) {
    google.accounts.id.disableAutoSelect();
  }
  setToken(null);
  currentEmail = null;
  notifyAuthChange(false);
}

function handleCredential(response) {
  const credential = response.credential;
  setToken(credential);
  currentEmail = decodeEmail(credential);
  notifyAuthChange(true);
}

function initGoogleSignIn(clientId) {
  google.accounts.id.initialize({
    client_id: clientId,
    callback: handleCredential,
    auto_select: true,
    hosted_domain: 'aspadeco.com',
  });
}

function flushReadyQueue() {
  googleReady = true;
  while (readyQueue.length) readyQueue.shift()();
}

export function whenGoogleReady(fn) {
  if (googleReady && window.google?.accounts?.id) fn();
  else readyQueue.push(fn);
}

function ensureGoogleScript(clientId) {
  if (googleReady && window.google?.accounts?.id) return;
  if (googleLoadStarted) return;
  googleLoadStarted = true;

  if (window.google?.accounts?.id) {
    initGoogleSignIn(clientId);
    flushReadyQueue();
    return;
  }

  const script = document.createElement('script');
  script.src = 'https://accounts.google.com/gsi/client';
  script.async = true;
  script.defer = true;
  script.onload = () => {
    initGoogleSignIn(clientId);
    flushReadyQueue();
  };
  document.head.append(script);
}

export function renderGoogleButton(mount, options = {}) {
  whenGoogleReady(() => {
    mount.innerHTML = '';
    google.accounts.id.renderButton(mount, {
      theme: 'filled_black',
      size: 'medium',
      text: 'signin_with',
      shape: 'rectangular',
      ...options,
    });
  });
}

function renderAuthArea(area) {
  area.innerHTML = '';
  if (!isAuthRequired()) {
    area.innerHTML = '<span class="auth-label muted">Local dev</span>';
    return;
  }

  if (currentEmail) {
    const wrap = document.createElement('div');
    wrap.className = 'auth-signed-in';
    const label = document.createElement('span');
    label.className = 'auth-label';
    label.textContent = currentEmail;
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'btn btn-sm btn-ghost';
    btn.textContent = 'Sign out';
    btn.addEventListener('click', signOut);
    wrap.append(label, btn);
    area.append(wrap);
    return;
  }

  const mount = document.createElement('div');
  mount.id = 'google-signin-btn';
  area.append(mount);
  renderGoogleButton(mount);
}

export function mountAuthHeader(area, authChangeCallback) {
  onAuthChange = authChangeCallback;
  renderAuthArea(area);
}

async function validateStoredToken() {
  const token = getToken();
  if (!token) return false;
  try {
    const me = await api.me();
    currentEmail = me.email || decodeEmail(token);
    return true;
  } catch {
    setToken(null);
    currentEmail = null;
    return false;
  }
}

export async function initAuth(authChangeCallback) {
  onAuthChange = authChangeCallback;
  setAuthTokenGetter(getToken);
  setUnauthorizedHandler(() => {
    if (!isAuthRequired()) return;
    setToken(null);
    currentEmail = null;
    notifyAuthChange(false);
  });

  if (!isAuthRequired()) {
    authChangeCallback({ authenticated: true, skipped: true });
    return;
  }

  const clientId = window.AYO_GOOGLE_CLIENT_ID;
  if (!clientId) {
    authChangeCallback({ authenticated: false, error: 'Missing AYO_GOOGLE_CLIENT_ID in config.js' });
    return;
  }

  ensureGoogleScript(clientId);

  if (await validateStoredToken()) {
    authChangeCallback({ authenticated: true, email: currentEmail });
    return;
  }

  authChangeCallback({ authenticated: false });
}

export function setupGoogleButton(authArea) {
  if (!isAuthRequired()) {
    renderAuthArea(authArea);
    return;
  }
  ensureGoogleScript(window.AYO_GOOGLE_CLIENT_ID);
  renderAuthArea(authArea);
}

export function refreshAuthHeader(authArea) {
  renderAuthArea(authArea);
}

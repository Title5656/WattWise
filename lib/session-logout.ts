export const LOGOUT_STORAGE_KEY = 'wattwise:logout';
export const LOGOUT_EVENT = 'wattwise:logout';
export const LOGOUT_CHANNEL = 'wattwise-session';
export const ACCESS_LOGOUT_PATH = '/cdn-cgi/access/logout';

export function readLogoutStamp(): string | null {
  try { return window.localStorage.getItem(LOGOUT_STORAGE_KEY); } catch { return null; }
}

export function watchSessionLogout(onLogout: () => void) {
  const initialStamp = readLogoutStamp();
  let ended = false;
  const stop = () => {
    if (ended) return;
    ended = true;
    onLogout();
  };
  const checkStamp = () => { if (readLogoutStamp() !== initialStamp) stop(); };
  const onStorage = (event: StorageEvent) => {
    if (event.key === LOGOUT_STORAGE_KEY && event.newValue !== initialStamp) stop();
  };
  let channel: BroadcastChannel | undefined;
  try {
    channel = new BroadcastChannel(LOGOUT_CHANNEL);
    channel.onmessage = (event) => { if (event.data === 'logout') stop(); };
  } catch { /* Storage events still work without BroadcastChannel. */ }
  window.addEventListener(LOGOUT_EVENT, stop);
  window.addEventListener('storage', onStorage);
  window.addEventListener('pageshow', checkStamp);
  window.addEventListener('focus', checkStamp);
  return () => {
    channel?.close();
    window.removeEventListener(LOGOUT_EVENT, stop);
    window.removeEventListener('storage', onStorage);
    window.removeEventListener('pageshow', checkStamp);
    window.removeEventListener('focus', checkStamp);
  };
}

export function logoutFromAccess() {
  // Broadcast before navigating. The boundary synchronously unmounts account UI,
  // disposing requests and autosave controllers while leaving scoped drafts intact.
  const stamp = crypto.randomUUID();
  try { window.localStorage.setItem(LOGOUT_STORAGE_KEY, stamp); } catch { /* Channel remains available. */ }
  try {
    const channel = new BroadcastChannel(LOGOUT_CHANNEL);
    channel.postMessage('logout');
    channel.close();
  } catch { /* The storage event is the fallback for older browsers. */ }
  window.dispatchEvent(new Event(LOGOUT_EVENT));
  // Cloudflare owns this endpoint; a client-side router transition cannot revoke its cookie.
  // eslint-disable-next-line @next/next/no-location-assign-relative-destination
  window.location.assign(ACCESS_LOGOUT_PATH);
}

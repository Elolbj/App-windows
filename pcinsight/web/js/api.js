// Accès à l'API locale. Le jeton est transmis par l'URL de démarrage (#token=...),
// puis conservé en mémoire de session et retiré de la barre d'adresse.

const KEY = "pcinsight-token";

function readToken() {
  const m = location.hash.match(/token=([\w-]+)/);
  if (m) {
    try { sessionStorage.setItem(KEY, m[1]); } catch { /* stockage indisponible */ }
    history.replaceState(null, "", location.pathname + "#/dashboard");
    return m[1];
  }
  try { return sessionStorage.getItem(KEY) || ""; } catch { return ""; }
}

const TOKEN = readToken();

async function request(method, path, body) {
  const res = await fetch(`/api/${path}`, {
    method,
    headers: { "X-Token": TOKEN, ...(body ? { "Content-Type": "application/json" } : {}) },
    body: body ? JSON.stringify(body) : undefined,
  });
  let data = null;
  try { data = await res.json(); } catch { /* corps vide */ }
  if (!res.ok) throw new Error((data && data.error) || `Erreur HTTP ${res.status}`);
  return data;
}

export const api = {
  get: (path, params = {}) => {
    const q = new URLSearchParams(Object.entries(params).filter(([, v]) => v !== undefined && v !== null && v !== false)).toString();
    return request("GET", q ? `${path}?${q}` : path);
  },
  post: (path, body = {}) => request("POST", path, body),
  /** Section mise en cache côté serveur : renvoie { data, error, updated }. */
  section: async (name, refresh = false) => {
    const r = await request("GET", refresh ? `${name}?refresh=1` : name);
    if (r.error && !r.data) throw new Error(r.error);
    return r;
  },
};

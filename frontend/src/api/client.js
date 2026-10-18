// frontend/src/api/client.js
// ─────────────────────────────────────────────────────────────────
// Shared login-aware fetch for every API file (analytics.js, financeApi.js,
// overviewApi.js, villaFeesApi.js, forecastApi.js) and the auth screens.
//
//   authFetch(url, options)  same as fetch(), plus:
//     - adds "Authorization: Bearer <token>" when the user is logged in
//     - on a 401 (not logged in / session expired / account disabled) clears
//       the token and fires the "auth:logout" event, which AuthContext turns
//       into "show the login page"
//   apiJson(endpoint, options)  authFetch + JSON body + readable errors,
//     used by the auth screens.
//
// The token lives in sessionStorage: it survives a page refresh but is gone
// when the browser closes. The backend expires it after 8 hours regardless.
// ─────────────────────────────────────────────────────────────────

export const API_BASE_URL = import.meta.env.VITE_API_URL;

const TOKEN_KEY = "demowrk_token";

// ── Token storage (sessionStorage can be blocked, so never let it throw) ──
export function getToken() {
  try {
    return sessionStorage.getItem(TOKEN_KEY);
  } catch {
    return null;
  }
}

export function setToken(token) {
  try {
    sessionStorage.setItem(TOKEN_KEY, token);
  } catch {
    /* storage blocked: the user stays logged in until the page reloads */
  }
}

export function clearToken() {
  try {
    sessionStorage.removeItem(TOKEN_KEY);
  } catch {
    /* ignore */
  }
}

// ── Fetch with the login token ──
export async function authFetch(url, options = {}) {
  const headers = new Headers(options.headers || {});
  const token = getToken();
  if (token) headers.set("Authorization", `Bearer ${token}`);

  const response = await fetch(url, { ...options, headers });

  if (response.status === 401 && token) {
    clearToken();
    window.dispatchEvent(new Event("auth:logout"));
  }
  return response;
}

// ── JSON helper for the auth screens ──
export async function apiJson(endpoint, { method = "GET", body } = {}) {
  const response = await authFetch(`${API_BASE_URL}${endpoint}`, {
    method,
    headers: body ? { "Content-Type": "application/json" } : undefined,
    body: body ? JSON.stringify(body) : undefined,
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) {
    // FastAPI sends {detail: "..."} or, for validation errors, {detail: [{msg: ...}]}
    const detail = Array.isArray(data.detail)
      ? data.detail.map((d) => d.msg).join("; ")
      : data.detail;
    throw new Error(detail || `Request failed (${response.status})`);
  }
  return data;
}

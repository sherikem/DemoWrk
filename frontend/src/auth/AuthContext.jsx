// frontend/src/auth/AuthContext.jsx
// ─────────────────────────────────────────────────────────────────
// Holds the logged-in user for the whole app.
//
//   <AuthProvider>   wrap the app in it (App.jsx)
//   useAuth()        { user, loading, login(username, password), logout(),
//                      canEdit(tabId) }
//
// user = { id, username, full_name, role, tabs: [...], edit_tabs: [...] }
// from GET /auth/me.
// `tabs` is the list of tab ids this role may open (backend/postgres/
// access_rules.py) — Dashboard.jsx shows only those.
// `edit_tabs` is the subset where the role may also make changes.
// canEdit("market") is true only if the role may edit that tab; use it to
// hide Add / Edit / Delete buttons. The backend enforces this regardless.
// ─────────────────────────────────────────────────────────────────
import { createContext, useCallback, useContext, useEffect, useState } from "react";
import { apiJson, clearToken, getToken, setToken } from "../api/client";

const AuthContext = createContext(null);

export function AuthProvider({ children }) {
  const [user, setUser] = useState(null);
  const [loading, setLoading] = useState(true);

  // On first load: if a token is stored, check it is still valid.
  useEffect(() => {
    if (!getToken()) {
      setLoading(false);
      return;
    }
    apiJson("/auth/me")
      .then(setUser)
      .catch(() => clearToken())
      .finally(() => setLoading(false));
  }, []);

  // Any API call that gets a 401 fires "auth:logout" (api/client.js).
  useEffect(() => {
    const onLogout = () => setUser(null);
    window.addEventListener("auth:logout", onLogout);
    return () => window.removeEventListener("auth:logout", onLogout);
  }, []);

  const login = useCallback(async (username, password) => {
    const data = await apiJson("/auth/login", { method: "POST", body: { username, password } });
    setToken(data.access_token);
    setUser(data.user);
  }, []);

  const logout = useCallback(() => {
    clearToken();
    setUser(null);
  }, []);

  // True if the current role may make changes on this tab.
  const canEdit = useCallback(
    (tabId) => !!user?.edit_tabs?.includes(tabId),
    [user]
  );

  return (
    <AuthContext.Provider value={{ user, loading, login, logout, canEdit }}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error("useAuth must be used inside <AuthProvider>");
  return ctx;
}
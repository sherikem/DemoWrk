// frontend/src/auth/UsersAdmin.jsx
// ─────────────────────────────────────────────────────────────────
// Admin-only "Users" tab: list users, add a user, change role, reset a
// password, disable/enable an account. Talks to /auth/users (backend/
// postgres/auth.py), which refuses non-admins on the server side too.
// ─────────────────────────────────────────────────────────────────
import { useCallback, useEffect, useState } from "react";
import { apiJson } from "../api/client";
import { useAuth } from "./AuthContext";

const ROLES = ["Admin", "Read-Only", "Power-User", "Finance"];
const EMPTY_FORM = { username: "", full_name: "", password: "", role: "Read-Only" };

export default function UsersAdmin() {
  const { user: me } = useAuth();
  const [users, setUsers] = useState([]);
  const [form, setForm] = useState(EMPTY_FORM);
  const [message, setMessage] = useState({ text: "", error: false });

  const say = (text, error = false) => setMessage({ text, error });

  const load = useCallback(() => {
    apiJson("/auth/users").then(setUsers).catch((e) => say(e.message, true));
  }, []);

  useEffect(() => { load(); }, [load]);

  async function addUser(e) {
    e.preventDefault();
    try {
      await apiJson("/auth/users", { method: "POST", body: { ...form, full_name: form.full_name || null } });
      say(`Added ${form.username}.`);
      setForm(EMPTY_FORM);
      load();
    } catch (err) {
      say(err.message, true);
    }
  }

  async function update(u, changes, done) {
    try {
      await apiJson(`/auth/users/${u.id}`, { method: "PATCH", body: changes });
      say(done);
      load();
    } catch (err) {
      say(err.message, true);
    }
  }

  function resetPassword(u) {
    // The viewer's browser may block prompt(), so the new password is typed
    // into the row's own input instead (see ResetBox below).
    return (pw) => update(u, { new_password: pw }, `Password reset for ${u.username}.`);
  }

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 20 }}>
      {message.text && (
        <p role="status" style={{ margin: 0, color: message.error ? "#b42318" : "#027a48" }}>{message.text}</p>
      )}

      {/* ── Add user ── */}
      <form onSubmit={addUser} className="dashboard-card" style={styles.formRow}>
        <h2 className="dashboard-card-title" style={{ width: "100%", margin: 0 }}>Add a user</h2>
        <input id="new-username" placeholder="Username" value={form.username} required minLength={3}
               onChange={(e) => setForm({ ...form, username: e.target.value })} style={styles.input} />
        <input id="new-fullname" placeholder="Full name" value={form.full_name}
               onChange={(e) => setForm({ ...form, full_name: e.target.value })} style={styles.input} />
        <input id="new-password" type="password" placeholder="Password (10+ characters)" value={form.password}
               required minLength={10} autoComplete="new-password"
               onChange={(e) => setForm({ ...form, password: e.target.value })} style={styles.input} />
        <select id="new-role" value={form.role} onChange={(e) => setForm({ ...form, role: e.target.value })}
                style={styles.input}>
          {ROLES.map((r) => <option key={r} value={r}>{r}</option>)}
        </select>
        <button type="submit" style={styles.primary}>Add user</button>
      </form>

      {/* ── User list ── */}
      <div className="dashboard-card" style={{ overflowX: "auto" }}>
        <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 13 }}>
          <thead>
            <tr>
              {["Username", "Name", "Role", "Status", "Last login", "Reset password", ""].map((h) => (
                <th key={h} style={styles.th}>{h}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {users.map((u) => {
              const isMe = u.id === me?.id;
              return (
                <tr key={u.id}>
                  <td style={styles.td}>{u.username}{isMe && " (you)"}</td>
                  <td style={styles.td}>{u.full_name || "—"}</td>
                  <td style={styles.td}>
                    <select value={u.role} disabled={isMe} style={styles.input}
                            onChange={(e) => update(u, { role: e.target.value }, `${u.username} is now ${e.target.value}.`)}>
                      {ROLES.map((r) => <option key={r} value={r}>{r}</option>)}
                    </select>
                  </td>
                  <td style={styles.td}>{u.is_active ? "Active" : "Disabled"}</td>
                  <td style={styles.td}>{u.last_login_at ? new Date(u.last_login_at).toLocaleString() : "Never"}</td>
                  <td style={styles.td}><ResetBox onReset={resetPassword(u)} /></td>
                  <td style={styles.td}>
                    {!isMe && (
                      <button style={styles.secondary}
                              onClick={() => update(u, { is_active: !u.is_active },
                                `${u.username} ${u.is_active ? "disabled" : "enabled"}.`)}>
                        {u.is_active ? "Disable" : "Enable"}
                      </button>
                    )}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function ResetBox({ onReset }) {
  const [pw, setPw] = useState("");
  return (
    <span style={{ display: "inline-flex", gap: 6 }}>
      <input type="password" placeholder="New password" value={pw} autoComplete="new-password"
             onChange={(e) => setPw(e.target.value)} style={{ ...styles.input, width: 150 }} />
      <button style={styles.secondary} disabled={pw.length < 10}
              onClick={() => { onReset(pw); setPw(""); }}>Set</button>
    </span>
  );
}

const styles = {
  formRow: { display: "flex", flexWrap: "wrap", gap: 10, alignItems: "center" },
  input: { padding: "7px 9px", borderRadius: 7, border: "1px solid #cfd6dd", fontSize: 13 },
  th: { textAlign: "left", padding: "8px 10px", borderBottom: "1px solid #dde3e8", whiteSpace: "nowrap" },
  td: { padding: "8px 10px", borderBottom: "1px solid #eef1f4", verticalAlign: "middle" },
  primary: { padding: "8px 14px", borderRadius: 7, border: "none", background: "#003a59", color: "#fff",
             fontWeight: 600, cursor: "pointer" },
  secondary: { padding: "6px 10px", borderRadius: 7, border: "1px solid #cfd6dd", background: "transparent",
               cursor: "pointer" },
};

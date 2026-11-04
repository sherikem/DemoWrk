// frontend/src/auth/UsersAdmin.jsx
// ─────────────────────────────────────────────────────────────────
// Admin-only "Users" tab: list users, add a user, pick what each person can
// see / edit / export, change role, reset a password, disable/enable, delete.
// Talks to /auth/users and /auth/permissions-meta (backend/postgres/auth.py),
// which refuse non-admins on the server side too.
//
// PERMISSIONS: a role is a preset. Clicking a role button ticks that role's
// tabs; the admin can then tick or untick anything. If the ticks end up
// exactly equal to the role's preset the user just follows the preset;
// otherwise their own custom permissions are saved. Presets live in
// backend/postgres/access_rules.py (PRESETS), not here.
//
// Name and password rules live in ./formRules.js (mirrors
// backend/postgres/form_rules.py). The form shows them live; the server
// re-checks them.
// ─────────────────────────────────────────────────────────────────
import { useCallback, useEffect, useState } from "react";
import { Eye, EyeOff } from "lucide-react";
import { apiJson } from "../api/client";
import { useAuth } from "./AuthContext";
import { cleanName, nameProblems, passwordChecklist } from "./formRules";

// Used until /auth/permissions-meta answers. Must match ROLES in
// backend/postgres/access_rules.py and the CHECK constraint on app_users.role.
const FALLBACK_ROLES = ["Admin", "Power-User", "Read-Only", "Finance", "Sales Power-User"];
const DEFAULT_ROLE = "Read-Only";
const EMPTY_FORM = { username: "", first_name: "", last_name: "", password: "", role: DEFAULT_ROLE, perms: null };

const same = (a, b) => a.length === b.length && a.every((x) => b.includes(x));
const withoutUsers = (list) => (list || []).filter((t) => t !== "users");
const cleanPerms = (p) => ({
  view_tabs: withoutUsers(p?.view_tabs),
  edit_tabs: withoutUsers(p?.edit_tabs),
  can_export: !!p?.can_export,
});

export default function UsersAdmin() {
  const { user: me } = useAuth();
  const [users, setUsers] = useState([]);
  const [meta, setMeta] = useState(null);               // { tabs, presets, roles }
  const [form, setForm] = useState(EMPTY_FORM);
  const [showPw, setShowPw] = useState(false);
  const [pwFocused, setPwFocused] = useState(false);
  const [touched, setTouched] = useState({});
  const [editing, setEditing] = useState(null);         // { id, role, perms } while a row's editor is open
  const [message, setMessage] = useState({ text: "", error: false });

  const say = (text, error = false) => setMessage({ text, error });
  const touch = (field) => setTouched((t) => ({ ...t, [field]: true }));

  const load = useCallback(() => {
    apiJson("/auth/users").then(setUsers).catch((e) => say(e.message, true));
  }, []);

  useEffect(() => { load(); }, [load]);
  useEffect(() => {
    apiJson("/auth/permissions-meta").then(setMeta).catch((e) => say(e.message, true));
  }, []);

  const roles = meta?.roles || FALLBACK_ROLES;
  const presetFor = (role) => cleanPerms(meta?.presets?.[role]);

  // ── Live validation for the Add-user form ──
  const addPerms = form.perms ?? presetFor(form.role);
  const firstProblems = nameProblems(form.first_name, "First name");
  const lastProblems = nameProblems(form.last_name, "Last name");
  const checklist = passwordChecklist(form.password, {
    username: form.username,
    names: [form.first_name, form.last_name],
  });
  const passwordOk = form.password.length > 0 && checklist.every((r) => r.ok);
  const formOk =
    form.username.trim().length >= 3 &&
    firstProblems.length === 0 &&
    lastProblems.length === 0 &&
    passwordOk;

  async function addUser(e) {
    e.preventDefault();
    setTouched({ first_name: true, last_name: true, password: true });
    if (!formOk) return;
    try {
      await apiJson("/auth/users", {
        method: "POST",
        body: {
          username: form.username.trim(),
          first_name: cleanName(form.first_name),
          last_name: cleanName(form.last_name),
          password: form.password,
          role: form.role,
          permissions: addPerms,
        },
      });
      say(`Added ${form.username.trim()}.`);
      setForm(EMPTY_FORM);
      setTouched({});
      setShowPw(false);
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
      return true;
    } catch (err) {
      say(err.message, true);
      return false;
    }
  }

  async function removeUser(u) {
    if (!window.confirm(`Permanently delete ${u.username}? This can't be undone. (Use Disable to just block their login.)`)) return;
    try {
      await apiJson(`/auth/users/${u.id}`, { method: "DELETE" });
      say(`Deleted ${u.username}.`);
      if (editing?.id === u.id) setEditing(null);
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

  function openEditor(u) {
    setEditing({ id: u.id, role: u.role, perms: cleanPerms(u.effective) });
  }

  async function saveEditor(u) {
    const body = { permissions: editing.perms };
    if (editing.role !== u.role) body.role = editing.role;
    if (await update(u, body, `Permissions saved for ${u.username}.`)) setEditing(null);
  }

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 20 }}>
      {message.text && (
        <p role="status" style={{ margin: 0, color: message.error ? "#b42318" : "#027a48" }}>{message.text}</p>
      )}

      {/* ── Add user ── */}
      <form onSubmit={addUser} className="dashboard-card" style={styles.formRow} noValidate>
        <h2 className="dashboard-card-title" style={{ width: "100%", margin: 0 }}>Add a user</h2>

        <div style={styles.field}>
          <input id="new-first" placeholder="First name" value={form.first_name} autoComplete="off"
                 onChange={(e) => setForm({ ...form, first_name: e.target.value })}
                 onBlur={() => touch("first_name")} style={styles.input} />
          {touched.first_name && firstProblems.map((p) => <small key={p} style={styles.bad}>{p}</small>)}
        </div>

        <div style={styles.field}>
          <input id="new-last" placeholder="Last name" value={form.last_name} autoComplete="off"
                 onChange={(e) => setForm({ ...form, last_name: e.target.value })}
                 onBlur={() => touch("last_name")} style={styles.input} />
          {touched.last_name && lastProblems.map((p) => <small key={p} style={styles.bad}>{p}</small>)}
        </div>

        <div style={styles.field}>
          <input id="new-username" placeholder="Username (3+ characters)" value={form.username}
                 autoComplete="off" onChange={(e) => setForm({ ...form, username: e.target.value })}
                 style={styles.input} />
        </div>

        <div style={styles.field}>
          {/* Rules appear above the box while it is selected, and stay until every rule is met. */}
          {(pwFocused || (touched.password && !passwordOk)) && <Checklist items={checklist} />}
          <span style={{ position: "relative", display: "inline-flex" }}>
            <input id="new-password" type={showPw ? "text" : "password"} placeholder="Password"
                   value={form.password} autoComplete="new-password"
                   onChange={(e) => setForm({ ...form, password: e.target.value })}
                   onFocus={() => { setPwFocused(true); touch("password"); }}
                   onBlur={() => setPwFocused(false)}
                   style={{ ...styles.input, paddingRight: 34 }} />
            <button type="button" onMouseDown={(e) => e.preventDefault()} onClick={() => setShowPw((v) => !v)}
                    style={styles.eye}
                    title={showPw ? "Hide password" : "Show password"}
                    aria-label={showPw ? "Hide password" : "Show password"}>
              {showPw ? <EyeOff size={16} /> : <Eye size={16} />}
            </button>
          </span>
        </div>

        <button type="submit" style={{ ...styles.primary, opacity: formOk ? 1 : 0.55 }}>Add user</button>

        {/* ── Permissions for the new user ── */}
        <div style={{ width: "100%" }}>
          <PermissionsEditor
            idPrefix="new"
            meta={meta}
            roles={roles}
            role={form.role}
            perms={addPerms}
            onRole={(role) => setForm({ ...form, role, perms: presetFor(role) })}
            onPerms={(perms) => setForm({ ...form, perms })}
          />
        </div>
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
              const open = editing?.id === u.id;
              return (
                <RowGroup key={u.id}>
                  <tr>
                    <td style={styles.td}>{u.username}{isMe && " (you)"}</td>
                    <td style={styles.td}>{u.full_name || "—"}</td>
                    <td style={styles.td}>
                      <select value={u.role} disabled={isMe} style={styles.input}
                              onChange={(e) => update(u, { role: e.target.value }, `${u.username} is now ${e.target.value} (role's default permissions applied).`)}>
                        {roles.map((r) => <option key={r} value={r}>{r}</option>)}
                      </select>
                      {u.custom_permissions && <span style={styles.badge} title="This user has their own permissions">Custom</span>}
                    </td>
                    <td style={styles.td}>{u.is_active ? "Active" : "Disabled"}</td>
                    <td style={styles.td}>{u.last_login_at ? new Date(u.last_login_at).toLocaleString() : "Never"}</td>
                    <td style={styles.td}><ResetBox user={u} onReset={resetPassword(u)} /></td>
                    <td style={styles.td}>
                      <span style={{ display: "inline-flex", gap: 6 }}>
                        {u.role !== "Admin" && (
                          <button style={styles.secondary} onClick={() => (open ? setEditing(null) : openEditor(u))}>
                            {open ? "Close" : "Permissions"}
                          </button>
                        )}
                        {!isMe && (
                          <>
                            <button style={styles.secondary}
                                    onClick={() => update(u, { is_active: !u.is_active },
                                      `${u.username} ${u.is_active ? "disabled" : "enabled"}.`)}>
                              {u.is_active ? "Disable" : "Enable"}
                            </button>
                            <button style={{ ...styles.secondary, color: "#b42318", border: "1px solid #f1b5ae" }}
                                    onClick={() => removeUser(u)}>
                              Delete
                            </button>
                          </>
                        )}
                      </span>
                    </td>
                  </tr>
                  {open && (
                    <tr>
                      <td colSpan={7} style={{ ...styles.td, background: "#f8fafb" }}>
                        <PermissionsEditor
                          idPrefix={`u${u.id}`}
                          meta={meta}
                          roles={roles}
                          role={editing.role}
                          perms={editing.perms}
                          onRole={(role) => setEditing({ ...editing, role, perms: presetFor(role) })}
                          onPerms={(perms) => setEditing({ ...editing, perms })}
                        />
                        <div style={{ display: "flex", gap: 8, marginTop: 10 }}>
                          <button type="button" style={styles.primary} onClick={() => saveEditor(u)}>Save permissions</button>
                          <button type="button" style={styles.secondary} onClick={() => setEditing(null)}>Cancel</button>
                        </div>
                      </td>
                    </tr>
                  )}
                </RowGroup>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}

// A table row plus its optional editor row, without adding a DOM wrapper.
function RowGroup({ children }) { return <>{children}</>; }

// ── Permissions editor (used for a new user and for an existing one) ──
//   role   : the selected preset
//   perms  : { view_tabs, edit_tabs, can_export }  (controlled)
// Clicking a role button replaces the ticks with that role's preset.
function PermissionsEditor({ idPrefix, meta, roles, role, perms, onRole, onPerms }) {
  if (!meta) return <small style={{ color: "#5b6670" }}>Loading permissions…</small>;

  const preset = cleanPerms(meta.presets?.[role]);
  const isAdmin = role === "Admin";
  const custom =
    !isAdmin &&
    !(same(perms.view_tabs, preset.view_tabs) &&
      same(perms.edit_tabs, preset.edit_tabs) &&
      perms.can_export === preset.can_export);

  const toggleView = (id, on) =>
    onPerms({
      ...perms,
      view_tabs: on ? [...perms.view_tabs, id] : perms.view_tabs.filter((t) => t !== id),
      edit_tabs: on ? perms.edit_tabs : perms.edit_tabs.filter((t) => t !== id),   // no edit without view
    });
  const toggleEdit = (id, on) =>
    onPerms({
      ...perms,
      edit_tabs: on ? [...perms.edit_tabs, id] : perms.edit_tabs.filter((t) => t !== id),
      view_tabs: on && !perms.view_tabs.includes(id) ? [...perms.view_tabs, id] : perms.view_tabs,  // edit implies view
    });

  const allView = meta.tabs.every((t) => perms.view_tabs.includes(t.id));
  const allEdit = meta.tabs.every((t) => perms.edit_tabs.includes(t.id));

  return (
    <fieldset style={styles.permBox}>
      <legend style={styles.legend}>Permissions</legend>

      <div role="group" aria-label="Role presets" style={{ display: "flex", flexWrap: "wrap", gap: 6, alignItems: "center" }}>
        <span style={{ fontSize: 12, color: "#5b6670" }}>Start from a role:</span>
        {roles.map((r) => (
          <button key={r} type="button" aria-pressed={r === role} onClick={() => onRole(r)}
                  style={{ ...styles.chip, ...(r === role ? styles.chipOn : null) }}>
            {r}
          </button>
        ))}
        {custom && (
          <>
            <span style={styles.badge}>Customised</span>
            <button type="button" style={styles.link} onClick={() => onRole(role)}>Reset to {role}</button>
          </>
        )}
      </div>

      {isAdmin ? (
        <p style={{ margin: "8px 0 0", fontSize: 12, color: "#5b6670" }}>
          Admin always has full access to every tab, can edit and export everything, and manages users.
          This can't be reduced.
        </p>
      ) : (
        <>
          <table style={{ borderCollapse: "collapse", fontSize: 13, marginTop: 8 }}>
            <thead>
              <tr>
                <th style={styles.pth}>Tab</th>
                <th style={styles.pth}>
                  <label style={styles.cbLabel}>
                    <input type="checkbox" checked={allView}
                           onChange={(e) => onPerms({
                             ...perms,
                             view_tabs: e.target.checked ? meta.tabs.map((t) => t.id) : [],
                             edit_tabs: e.target.checked ? perms.edit_tabs : [],
                           })} /> Can see
                  </label>
                </th>
                <th style={styles.pth}>
                  <label style={styles.cbLabel}>
                    <input type="checkbox" checked={allEdit}
                           onChange={(e) => onPerms({
                             ...perms,
                             edit_tabs: e.target.checked ? meta.tabs.map((t) => t.id) : [],
                             view_tabs: e.target.checked ? meta.tabs.map((t) => t.id) : perms.view_tabs,
                           })} /> Can edit
                  </label>
                </th>
              </tr>
            </thead>
            <tbody>
              {meta.tabs.map((t) => (
                <tr key={t.id}>
                  <td style={styles.ptd}>{t.label}</td>
                  <td style={styles.ptd}>
                    <input id={`${idPrefix}-view-${t.id}`} type="checkbox" aria-label={`${t.label}: can see`}
                           checked={perms.view_tabs.includes(t.id)}
                           onChange={(e) => toggleView(t.id, e.target.checked)} />
                  </td>
                  <td style={styles.ptd}>
                    <input id={`${idPrefix}-edit-${t.id}`} type="checkbox" aria-label={`${t.label}: can edit`}
                           checked={perms.edit_tabs.includes(t.id)}
                           onChange={(e) => toggleEdit(t.id, e.target.checked)} />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>

          <label style={{ ...styles.cbLabel, marginTop: 8 }}>
            <input id={`${idPrefix}-export`} type="checkbox" checked={perms.can_export}
                   onChange={(e) => onPerms({ ...perms, can_export: e.target.checked })} />
            Can export data (CSV, Excel, PDF)
          </label>
          <p style={{ margin: "6px 0 0", fontSize: 12, color: "#5b6670" }}>
            "Can edit" lets the person make changes on that tab (it also lets them see it).
            Only admins can open this Users tab.
          </p>
        </>
      )}
    </fieldset>
  );
}

// Live "what's still missing" list under the password box.
function Checklist({ items }) {
  return (
    <ul style={styles.checklist} aria-live="polite">
      {items.map((r) => (
        <li key={r.label} style={{ color: r.ok ? "#027a48" : "#b42318" }}>
          <span aria-hidden="true">{r.ok ? "✓" : "○"}</span> {r.label}
        </li>
      ))}
    </ul>
  );
}

function ResetBox({ user, onReset }) {
  const [pw, setPw] = useState("");
  const [open, setOpen] = useState(false);
  const items = passwordChecklist(pw, { username: user.username, names: [user.full_name || ""] });
  const ok = pw.length > 0 && items.every((r) => r.ok);
  return (
    <span style={{ display: "inline-flex", flexDirection: "column", gap: 4 }}>
      <span style={{ display: "inline-flex", gap: 6 }}>
        <input type="password" placeholder="New password" value={pw} autoComplete="new-password"
               onFocus={() => setOpen(true)} onChange={(e) => setPw(e.target.value)}
               style={{ ...styles.input, width: 150 }} />
        <button style={{ ...styles.secondary, opacity: ok ? 1 : 0.5 }} disabled={!ok}
                onClick={() => { onReset(pw); setPw(""); setOpen(false); }}>Set</button>
      </span>
      {open && pw.length > 0 && !ok && (
        <small style={styles.bad}>
          Still needed: {items.filter((r) => !r.ok).map((r) => r.label.toLowerCase()).join(", ")}
        </small>
      )}
    </span>
  );
}

const styles = {
  formRow: { display: "flex", flexWrap: "wrap", gap: 10, alignItems: "flex-start" },
  field: { display: "flex", flexDirection: "column", gap: 3, maxWidth: 300 },
  input: { padding: "7px 9px", borderRadius: 7, border: "1px solid #cfd6dd", fontSize: 13 },
  eye: { position: "absolute", right: 6, top: "50%", transform: "translateY(-50%)", border: "none",
         background: "transparent", cursor: "pointer", display: "flex", color: "#5b6670", padding: 2 },
  bad: { color: "#b42318", fontSize: 12, lineHeight: 1.3 },
  checklist: { margin: "0 0 4px", padding: "8px 10px", listStyle: "none", fontSize: 12, lineHeight: 1.5,
               display: "flex", flexDirection: "column", gap: 2, border: "1px solid #dde3e8",
               borderRadius: 7, background: "#f8fafb" },
  th: { textAlign: "left", padding: "8px 10px", borderBottom: "1px solid #dde3e8", whiteSpace: "nowrap" },
  td: { padding: "8px 10px", borderBottom: "1px solid #eef1f4", verticalAlign: "middle" },
  primary: { padding: "8px 14px", borderRadius: 7, border: "none", background: "#003a59", color: "#fff",
             fontWeight: 600, cursor: "pointer" },
  secondary: { padding: "6px 10px", borderRadius: 7, border: "1px solid #cfd6dd", background: "transparent",
               cursor: "pointer" },
  permBox: { border: "1px solid #dde3e8", borderRadius: 9, padding: "10px 12px", margin: 0 },
  legend: { fontSize: 13, fontWeight: 600, padding: "0 6px" },
  chip: { padding: "5px 11px", borderRadius: 999, border: "1px solid #cfd6dd", background: "#fff",
          cursor: "pointer", fontSize: 12 },
  chipOn: { background: "#003a59", color: "#fff", border: "1px solid #003a59" },
  badge: { marginLeft: 8, padding: "2px 8px", borderRadius: 999, background: "#fef0c7", color: "#93370d",
           fontSize: 11, fontWeight: 600 },
  link: { border: "none", background: "transparent", color: "#003a59", textDecoration: "underline",
          cursor: "pointer", fontSize: 12, padding: 0 },
  pth: { textAlign: "left", padding: "4px 18px 4px 0", borderBottom: "1px solid #dde3e8", whiteSpace: "nowrap" },
  ptd: { padding: "3px 18px 3px 0" },
  cbLabel: { display: "inline-flex", alignItems: "center", gap: 6, cursor: "pointer", fontWeight: "normal" },
};
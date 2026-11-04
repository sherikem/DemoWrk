// frontend/src/auth/LoginPage.jsx
// ─────────────────────────────────────────────────────────────────
// Sign-in screen shown by App.jsx whenever nobody is logged in.
// Restyled: split layout (villa photo + sign-in form), underline fields,
// dashboard blue/white palette. Auth logic is unchanged.
//
// ASSETS: drop these two files in frontend/src/assets/ (or change the paths):
//   login-villa.jpg  — the sunset villa/pool photo
//   login-logo.png   — the hummingbird logo
// ─────────────────────────────────────────────────────────────────
import { useState } from "react";
import { useAuth } from "./AuthContext";
import villaImg from "../assets/login-villa.jpg";
import logoImg from "../assets/login-logo.png";

const serif = "'Cormorant Garamond', Georgia, serif";

// Palette — uses the dashboard CSS variables, with the literal values as fallbacks.
const C = {
  page: "var(--dashboard-abyssal, #01263a)",
  deep: "var(--dashboard-deep-blue, #013a59)",
  flame: "var(--dashboard-flame, #2f89c5)",
  truffle: "var(--dashboard-truffle, #0b5d8a)",
  oatmeal: "var(--dashboard-oatmeal, #d7e3eb)",
  text: "var(--dashboard-abyssal, #01263a)",
  muted: "#35566b",
  error: "#b3402a",
};

export default function LoginPage() {
  const { login } = useAuth();
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");

  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  async function onSubmit(e) {
    e.preventDefault();
    setError("");
    setBusy(true);
    try {
      await login(username.trim(), password);
    } catch (err) {
      setError(err.message || "Couldn't sign in. Try again.");
      setPassword("");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="dashboard-shell" style={styles.page}>
      {/* Hover/focus states and the mobile layout can't be done with inline
          styles, so they live here, scoped with the "lp-" prefix. */}
      <style>{`
        .lp-input { transition: border-color .2s, box-shadow .2s; }
        .lp-input::placeholder { color: rgba(1,38,58,.35); }
        .lp-input:focus { border-bottom-color: ${C.flame}; box-shadow: 0 2px 0 ${C.flame}; }
        .lp-toggle:hover { color: ${C.flame}; }
        .lp-toggle:focus-visible, .lp-button:focus-visible { outline: 2px solid ${C.flame}; outline-offset: 3px; }
        .lp-button:not(:disabled):hover { background: ${C.flame}; }
        .lp-button:not(:disabled):active { transform: translateY(1px); }
        .lp-button:disabled { opacity: .7; cursor: default; }
        @media (max-width: 760px) {
          .lp-shell { grid-template-columns: 1fr !important; max-width: 420px !important; }
          .lp-art { display: none !important; }
          .lp-form { padding: 40px 24px 32px !important; }
        }
        @media (prefers-reduced-motion: reduce) { .lp-input, .lp-button { transition: none; } }
      `}</style>

      <div className="lp-shell" style={styles.shell}>
        {/* ── Photo panel ── */}
        <aside className="lp-art" style={styles.art}>
          <img src={villaImg} alt="" style={styles.photo} />
          <div style={styles.caption}>
            <h2 style={styles.captionTitle}>Everything at a glance</h2>
            <p style={styles.captionText}>Bookings, revenue and members, all in one place.</p>
          </div>
        </aside>

        {/* ── Sign-in form ── */}
        <form onSubmit={onSubmit} className="lp-form" style={styles.form}>
          <img src={logoImg} alt="" style={styles.logo} />
          <h1 style={styles.title}>DemoWrk Dashboard</h1>
          <p style={styles.subtitle}>User sign in</p>

          <div style={styles.rule}>
            <span style={styles.ruleLine} />
            <span style={styles.ruleDiamond} />
            <span style={styles.ruleLine} />
          </div>

          <div style={styles.field}>
            <label htmlFor="login-username" style={styles.label}>Username</label>
            <input
              id="login-username"
              className="lp-input"
              autoComplete="username"
              placeholder="Enter your username"
              value={username}
              onChange={(e) => setUsername(e.target.value)}
              style={styles.input}
              required
              autoFocus
            />
          </div>

          <div style={styles.field}>
            <label htmlFor="login-password" style={styles.label}>Password</label>
            <input
              id="login-password"
              className="lp-input"
              type= "password"
              autoComplete="current-password"
              placeholder="Enter your password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              style={{ ...styles.input, paddingRight: 52 }}
              required
            />
           
          </div>

          {error && <p role="alert" style={styles.error}>{error}</p>}

          <button type="submit" disabled={busy} className="lp-button" style={styles.button}>
            {busy ? "Signing in…" : "ENTER"}
          </button>

          <p style={styles.help}>
            Forgot your password? Ask a dashboard admin to reset it.
          </p>
        </form>
      </div>
    </div>
  );
}

const styles = {
  page: {
    minHeight: "100vh", display: "flex", alignItems: "center", justifyContent: "center",
    padding: 24, background: C.page,
  },
  shell: {
    width: "100%", maxWidth: 960, display: "grid", gridTemplateColumns: "1fr 1fr",
    background: "#fff", borderRadius: 6, overflow: "hidden", border: `2px solid ${C.flame}`,
  },

  // photo panel
  art: { position: "relative", minHeight: 560, background: C.deep, color: "#fff" },
  photo: {
    position: "absolute", inset: 0, width: "100%", height: "100%",
    objectFit: "cover", objectPosition: "center 60%", display: "block",
  },
  caption: {
    position: "absolute", left: 24, bottom: 24, width: "min(calc(100% - 48px), 360px)",
    textAlign: "left", background: C.deep, padding: "28px 30px",
    border: `2px solid ${C.flame}`, borderRadius: 4, zIndex: 1,
  },
  captionTitle: { fontFamily: serif, fontWeight: 500, fontSize: 36, lineHeight: 1.15, margin: "0 0 10px" },
  captionText: { margin: 0, fontSize: 18, color: C.oatmeal, lineHeight: 1.5, fontFamily: "sans-serif" },

  // form panel
  form: { padding: "44px 40px 36px", display: "flex", flexDirection: "column", justifyContent: "center" },
  logo: { display: "block", margin: "0 auto 14px", height: 76, width: "auto" },
  title: {
    fontFamily: serif, fontWeight: 700, fontSize: 42, lineHeight: 1.1,
    textAlign: "center", margin: 0, color: C.deep, letterSpacing: "0.01em",
  },
  subtitle: { textAlign: "center", margin: "10px 0 0", fontSize: 18, color: C.muted, letterSpacing: "0.03em", fontFamily: "sans-serif" },
  rule: { display: "flex", alignItems: "center", gap: 12, margin: "26px 0 28px" },
  ruleLine: { flex: 1, height: 2, background: C.oatmeal },
  ruleDiamond: { width: 5, height: 5, background: C.flame, transform: "rotate(45deg)" },

  field: { position: "relative", marginBottom: 20 },
  label: { display: "block", fontSize: 16, fontWeight: 500, color: C.truffle, margin: "0 0 8px", letterSpacing: "0.03em", fontFamily: "sans-serif" },
  input: {
    width: "100%", boxSizing: "border-box", background: "transparent", color: C.text,
    fontSize: 19, fontFamily: "sans-serif",
    border: 0, borderBottom: `2px solid ${C.truffle}`, borderRadius: 0,
    padding: "10px 0 12px", outline: "none",
  },
  toggle: {
    position: "absolute", right: 0, bottom: 11, background: "none", border: 0,
    color: C.truffle, fontSize: 16, fontWeight: 500, fontFamily: "sans-serif",
    cursor: "pointer", padding: "2px 4px",
  },
  error: { color: C.error, fontSize: 16, fontWeight: 500, margin: "0 0 4px", textAlign: "center", fontFamily: "sans-serif" },
  button: {
    width: "100%", marginTop: 12, padding: "18px 0", border: 0, borderRadius: 2,
    background: C.deep, color: "#fff", cursor: "pointer",
    fontFamily: serif, fontSize: 26, fontWeight: 600, letterSpacing: "0.14em",
  },
  help: { textAlign: "center", margin: "16px 0 0", fontSize: 14, color: C.muted, fontFamily: "sans-serif" },
};
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
      <form onSubmit={onSubmit} className="dashboard-card" style={styles.card}>
        <h1 className="dashboard-page-title" style={{ margin: 0 }}>
          DemoWrk Dashboard
        </h1>
        <p className="dashboard-page-subtitle" style={{ marginTop: 4 }}>
          Sign in to continue
        </p>

        <label htmlFor="login-username" style={styles.label}>
          Username
        </label>
        <input
          id="login-username"
          autoComplete="username"
          value={username}
          onChange={(e) => setUsername(e.target.value)}
          style={styles.input}
          required
          autoFocus
        />

        <label htmlFor="login-password" style={styles.label}>
          Password
        </label>
        <input
          id="login-password"
          type="password"
          autoComplete="current-password"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          style={styles.input}
          required
        />

        {error && (
          <p role="alert" style={styles.error}>
            {error}
          </p>
        )}

        <button type="submit" disabled={busy} style={styles.button}>
          {busy ? "Signing in…" : "Sign in"}
        </button>
        <p
          className="dashboard-page-subtitle"
          style={{ fontSize: 12, marginTop: 12 }}
        >
          Forgot your password? Ask a dashboard admin to reset it.
        </p>
      </form>
    </div>
  );
}

const styles = {
  page: {
    minHeight: "100vh",
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    padding: 16,
  },
  card: {
    width: "100%",
    maxWidth: 380,
    display: "flex",
    flexDirection: "column",
    gap: 6,
    padding: 28,
  },
  label: { fontSize: 13, fontWeight: 600, marginTop: 10 },
  input: {
    padding: "9px 11px",
    borderRadius: 8,
    border: "1px solid #cfd6dd",
    fontSize: 14,
  },
  error: { color: "#b42318", fontSize: 13, margin: "8px 0 0" },
  button: {
    marginTop: 16,
    padding: "10px 14px",
    borderRadius: 8,
    border: "none",
    background: "#003a59",
    color: "#fff",
    fontWeight: 600,
    fontSize: 14,
    cursor: "pointer",
  },
  help: { textAlign: "center", margin: "16px 0 0", fontSize: 14, color: C.muted, fontFamily: "sans-serif" },
};
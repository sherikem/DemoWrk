import { useEffect, useState } from "react";

// Waits `delay` ms before showing, so fast loads don't flash the overlay.
export default function LoadingOverlay({
  show,
  text = "Loading…",
  fullScreen = false,
  delay = 100,
}) {
  const [visible, setVisible] = useState(false);

  useEffect(() => {
    if (!show) {
      setVisible(false);
      return undefined;
    }
    const t = setTimeout(() => setVisible(true), delay);
    return () => clearTimeout(t);
  }, [show, delay]);

  if (!visible) return null;
  return (
    <div
      className={`loading-overlay${fullScreen ? " is-fullscreen" : ""}`}
      role="status"
      aria-live="polite"
    >
      <div className="loader" />
      <span className="loading-overlay-text">{text}</span>
    </div>
  );
}

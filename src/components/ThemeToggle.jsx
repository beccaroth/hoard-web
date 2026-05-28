import { useEffect, useState } from "react";
import { Sun, Moon, Monitor } from "lucide-react";

const KEY = "hoard:theme";
const ORDER = ["system", "light", "dark"];
const CURRENT_LABEL = { system: "System", light: "Light", dark: "Dark" };

function read() {
  try {
    const t = localStorage.getItem(KEY);
    return t === "light" || t === "dark" ? t : "system";
  } catch {
    return "system";
  }
}

function apply(theme) {
  const root = document.documentElement;
  if (theme === "system") delete root.dataset.theme;
  else root.dataset.theme = theme;
  try {
    if (theme === "system") localStorage.removeItem(KEY);
    else localStorage.setItem(KEY, theme);
  } catch {}
}

export default function ThemeToggle() {
  const [theme, setTheme] = useState(read);

  useEffect(() => { apply(theme); }, [theme]);

  function cycle() {
    const i = ORDER.indexOf(theme);
    setTheme(ORDER[(i + 1) % ORDER.length]);
  }

  const next = ORDER[(ORDER.indexOf(theme) + 1) % ORDER.length];
  const Icon = theme === "light" ? Sun : theme === "dark" ? Moon : Monitor;
  const aria = `Theme: ${CURRENT_LABEL[theme]}. Click to switch to ${CURRENT_LABEL[next]}.`;

  return (
    <button
      className="btn-ghost icon-btn theme-btn"
      aria-label={aria}
      onClick={cycle}
    >
      <Icon size={15} />
      <span className="theme-btn-tooltip" role="tooltip">
        <span className="tt-cur">{CURRENT_LABEL[theme]}</span>
        <span className="tt-sep">→</span>
        <span className="tt-next">{CURRENT_LABEL[next]}</span>
      </span>
    </button>
  );
}

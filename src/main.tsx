import { createRoot } from "react-dom/client";
import "./index.css";
import App from "./App";

createRoot(document.getElementById("root")!).render(
  // no StrictMode: its double mount rebuilt every 3-D scene and field twice in development
  <App />
);

// Development only: reload the page on every code change instead of hot-swapping modules.
// Hot-swapped 3-D modules left their old WebGL contexts and scenes alive in the tab, so memory
// grew with every edit. A full reload starts clean each time.
if (import.meta.hot) {
  import.meta.hot.on("vite:beforeUpdate", () => location.reload());
}

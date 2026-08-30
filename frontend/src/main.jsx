import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import "./index.css";
import App from "./App.jsx";
import { runSyncOnReconnect } from "./lib/api.js";

// Fire sync whenever the browser regains connectivity.
// Lazy — doesn't block rendering at all.
window.addEventListener("online", () => {
  runSyncOnReconnect().catch(() => {});
});

// And once on startup: a device that never lost connectivity never fires
// the "online" event, and its queued sessions would otherwise sit in
// IndexedDB forever.
runSyncOnReconnect().catch(() => {});

createRoot(document.getElementById("root")).render(
  <StrictMode>
    <App />
  </StrictMode>
);

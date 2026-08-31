import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import "./index.css";
import App from "./App.jsx";
import { resetSyncBackoff, runSyncOnReconnect } from "./lib/api.js";

// Fire sync whenever the browser regains connectivity.
// Lazy — doesn't block rendering at all.
//
// Coming back online is the one signal that genuinely means "try again now",
// so it clears any backoff earned while the network was gone. Without this a
// device that reconnects would sit out the tail of a wait it accumulated for
// reasons that no longer apply.
window.addEventListener("online", () => {
  resetSyncBackoff();
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

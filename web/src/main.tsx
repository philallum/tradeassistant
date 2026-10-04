import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { App } from "./App.tsx";

// Impure bootstrap: locate the mount node and render the React tree.
// The full app shell (header selectors, tab bar, routing) is task 9; this is the
// minimal placeholder that must render without error (task 6.1).
const container = document.getElementById("root");
if (container === null) {
  throw new Error("Root container #root not found in index.html");
}

createRoot(container).render(
  <StrictMode>
    <App />
  </StrictMode>,
);

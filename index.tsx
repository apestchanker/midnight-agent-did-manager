import React from "react";
import ReactDOM from "react-dom/client";
import { Buffer } from "buffer";
import App from "./src/App";
import "./index.css";

if (typeof globalThis.Buffer === "undefined") {
  globalThis.Buffer = Buffer;
}

ReactDOM.createRoot(document.getElementById("root") as HTMLElement).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
);

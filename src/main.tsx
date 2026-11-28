import React from "react";
import ReactDOM from "react-dom/client";
import App from "./App";
import WhatsAppFloat from "./WhatsAppFloat";
import "./index.css";
import "./account.css";
import "./admin.css";
import "./responsive.css";
import "./site-polish.css";

ReactDOM.createRoot(document.getElementById("root")!).render(
  <React.StrictMode><App /><WhatsAppFloat /></React.StrictMode>
);
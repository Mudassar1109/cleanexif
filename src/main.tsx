import React from "react";
import ReactDOM from "react-dom/client";
import App from "./App";
import WhatsAppFloat from "./WhatsAppFloat";
import "./index.css";
import "./account.css";
import "./admin.css";
import "./responsive.css";
import "./site-polish.css";
import "./more-apps-tools.css";

const isAdminRoute = window.location.pathname.replace(/^\\/|\\/$/g, "") === "admin";

ReactDOM.createRoot(document.getElementById("root")!).render(
  <React.StrictMode><App />{!isAdminRoute && <WhatsAppFloat />}</React.StrictMode>
);
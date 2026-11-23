import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import "./fonts.css";
import "../app/globals.css";
import Dashboard from "../components/dashboard";

const root = document.getElementById("root");
if (!root) throw new Error("Нет узла #root");

createRoot(root).render(
  <StrictMode>
    <Dashboard />
  </StrictMode>,
);

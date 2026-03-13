import React from "react";
import { createRoot } from "react-dom/client";
import { WizardWidget } from "./components/WizardWidget";
import "./styles/widget.css";

export interface LeadrWizardConfig {
  sessionId: string;
  containerId: string;
  apiBaseUrl: string;          // e.g. "https://app.leadrwizard.com" — required for cross-origin API calls
  supabaseUrl?: string;
  supabaseKey?: string;
  theme?: {
    primaryColor?: string;
    borderRadius?: string;
    fontFamily?: string;
  };
}

function init(config: LeadrWizardConfig) {
  const container = document.getElementById(config.containerId);
  if (!container) {
    console.error(
      `[LeadrWizard] Container #${config.containerId} not found`
    );
    return;
  }

  // Create Shadow DOM for style isolation
  const shadowRoot = container.attachShadow({ mode: "open" });

  // Create a mount point inside shadow DOM
  const mountPoint = document.createElement("div");
  mountPoint.id = "leadrwizard-root";
  shadowRoot.appendChild(mountPoint);

  // Inject styles into shadow DOM
  const style = document.createElement("style");
  style.textContent = getWidgetStyles(config.theme);
  shadowRoot.appendChild(style);

  const root = createRoot(mountPoint);
  root.render(
    <React.StrictMode>
      <WizardWidget
        sessionId={config.sessionId}
        apiBaseUrl={config.apiBaseUrl}
        supabaseUrl={config.supabaseUrl}
        supabaseKey={config.supabaseKey}
      />
    </React.StrictMode>
  );
}

function getWidgetStyles(theme?: LeadrWizardConfig["theme"]): string {
  const primary = theme?.primaryColor || "#6366f1";
  const radius = theme?.borderRadius || "12px";
  const font = theme?.fontFamily || "system-ui, -apple-system, sans-serif";

  return `
    :host {
      --lw-primary: ${primary};
      --lw-radius: ${radius};
      --lw-font: ${font};
    }
    #leadrwizard-root {
      font-family: var(--lw-font);
      color: #1f2937;
      line-height: 1.5;
    }
  `;
}

// Expose to global scope
const LeadrWizardAPI = { init };

if (typeof window !== "undefined") {
  (window as unknown as Record<string, unknown>).LeadrWizard = LeadrWizardAPI;
}

export default LeadrWizardAPI;

import React from "react";
import { createRoot } from "react-dom/client";
import { WizardWidget } from "./components/WizardWidget";
import "./styles/widget.css";

export interface LeadrWizardConfig {
  sessionId: string;
  containerId: string;
  apiBaseUrl: string;
  allowedOrigins?: string[];
  theme?: {
    primaryColor?: string;
    borderRadius?: string;
    fontFamily?: string;
  };
}

/**
 * Validate that the widget is embedded on an allowed origin.
 *
 * Resolution order:
 * 1. window.location.ancestorOrigins (Chromium: Chrome, Edge, Safari)
 * 2. document.referrer (Firefox fallback)
 * 3. window.location.origin (direct script tag, not in iframe)
 *
 * If allowedOrigins is not provided or empty, validation is skipped (backwards compatible).
 */
function validateOrigin(allowedOrigins?: string[]): boolean {
  if (!allowedOrigins || allowedOrigins.length === 0) return true;

  let embeddingOrigin: string | null = null;

  // Prefer ancestorOrigins (Chrome, Edge, Safari)
  if (
    typeof window !== "undefined" &&
    window.location.ancestorOrigins &&
    window.location.ancestorOrigins.length > 0
  ) {
    embeddingOrigin = window.location.ancestorOrigins[0];
  }
  // Fallback to referrer (Firefox)
  else if (document.referrer) {
    try {
      embeddingOrigin = new URL(document.referrer).origin;
    } catch {
      // Invalid referrer URL
    }
  }
  // Direct page load: widget script loaded via <script> tag on host page
  else {
    embeddingOrigin = window.location.origin;
  }

  if (!embeddingOrigin) return false;

  return allowedOrigins.includes(embeddingOrigin);
}

function init(config: LeadrWizardConfig) {
  // Origin validation BEFORE any DOM manipulation or React mounting
  if (!validateOrigin(config.allowedOrigins)) {
    console.error(
      "[LeadrWizard] Widget blocked: embedding origin is not in allowedOrigins. " +
        "Current origin: " +
        (typeof window !== "undefined" ? window.location.origin : "unknown")
    );
    // Clear container if it exists so nothing renders
    const container = document.getElementById(config.containerId);
    if (container) {
      container.innerHTML = "";
    }
    return;
  }

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

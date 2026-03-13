import React from "react";
import type { ServiceWithProgress } from "../hooks/useWizardSession";

interface ProgressBarProps {
  completionPct: number;
  services: ServiceWithProgress[];
}

export function ProgressBar({ completionPct, services }: ProgressBarProps) {
  return (
    <div className="lw-progress">
      <div className="lw-progress-header">
        <span className="lw-progress-label">Setup Progress</span>
        <span className="lw-progress-pct">{completionPct}%</span>
      </div>
      <div className="lw-progress-bar">
        <div
          className="lw-progress-fill"
          style={{ width: `${completionPct}%` }}
        />
      </div>
      <div className="lw-progress-services">
        {services.map((s) => (
          <div key={s.serviceId} className="lw-progress-service">
            <span
              className={`lw-progress-dot ${s.pct === 100 ? "lw-done" : ""}`}
            />
            <span className="lw-progress-service-name">
              {s.serviceName}
            </span>
            {s.missingFields.length > 0 && (
              <span className="lw-progress-remaining">
                {s.missingFields.length} remaining
              </span>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}

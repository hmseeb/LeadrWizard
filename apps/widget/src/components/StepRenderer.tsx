import React, { useState } from "react";
import type { AgentDecision } from "@leadrwizard/shared/types";

interface StepRendererProps {
  question: AgentDecision;
  submitting: boolean;
  stepError: string | null;
  onSubmit: (value: string) => void;
  onRetry: () => void;
}

export function StepRenderer({
  question,
  submitting,
  stepError,
  onSubmit,
  onRetry,
}: StepRendererProps) {
  const [textValue, setTextValue] = useState("");

  // ----- Completion screen -----
  if (question.action === "complete") {
    return (
      <div className="lw-step lw-complete">
        <div className="lw-complete-icon">&#10003;</div>
        <h3 className="lw-step-title">You're all set!</h3>
        <p className="lw-step-message">
          We've collected everything we need. Your services are now being set
          up.
        </p>
        <div className="lw-next-steps">
          <h4 className="lw-next-steps-heading">What happens next?</h4>
          <ul className="lw-next-steps-list">
            <li>Our team will begin setting up your services</li>
            <li>You'll receive updates via email as each service is ready</li>
            <li>If we need anything else, we'll reach out</li>
          </ul>
        </div>
      </div>
    );
  }

  // ----- Step error with retry -----
  if (stepError) {
    return (
      <div className="lw-step lw-step-error-container">
        <div className="lw-step-error-icon">!</div>
        <p className="lw-step-error-message">{stepError}</p>
        <button className="lw-retry-btn" onClick={onRetry}>
          Try Again
        </button>
      </div>
    );
  }

  // ----- Multiple choice -----
  if (question.options && question.options.length > 0) {
    return (
      <div className="lw-step">
        <h3 className="lw-step-title">{question.message}</h3>
        <div className="lw-options">
          {question.options.map((option) => (
            <button
              key={option}
              className="lw-option-card"
              onClick={() => onSubmit(option)}
              disabled={submitting}
            >
              {option}
            </button>
          ))}
        </div>
        {submitting && (
          <p className="lw-submitting-text">Saving your response...</p>
        )}
      </div>
    );
  }

  // ----- Text input -----
  return (
    <div className="lw-step">
      <h3 className="lw-step-title">{question.message}</h3>
      <form
        className="lw-input-form"
        onSubmit={(e) => {
          e.preventDefault();
          if (textValue.trim() && !submitting) {
            onSubmit(textValue.trim());
            setTextValue("");
          }
        }}
      >
        <input
          type="text"
          value={textValue}
          onChange={(e) => setTextValue(e.target.value)}
          className="lw-text-input"
          placeholder="Type your answer..."
          autoFocus
          disabled={submitting}
        />
        <button
          type="submit"
          className="lw-submit-btn"
          disabled={!textValue.trim() || submitting}
        >
          {submitting ? "Submitting..." : "Next"}
        </button>
      </form>
    </div>
  );
}

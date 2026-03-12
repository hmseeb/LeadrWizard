import React, { useState } from "react";
import type { AgentDecision } from "@leadrwizard/shared/types";

interface StepRendererProps {
  question: AgentDecision;
  onSubmit: (value: string) => void;
}

export function StepRenderer({ question, onSubmit }: StepRendererProps) {
  const [textValue, setTextValue] = useState("");

  if (question.action === "complete") {
    return (
      <div className="lw-step lw-complete">
        <div className="lw-complete-icon">&#10003;</div>
        <h3 className="lw-step-title">All Done!</h3>
        <p className="lw-step-message">{question.message}</p>
      </div>
    );
  }

  // Multiple choice (if options provided)
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
            >
              {option}
            </button>
          ))}
        </div>
      </div>
    );
  }

  // Text input
  return (
    <div className="lw-step">
      <h3 className="lw-step-title">{question.message}</h3>
      <form
        className="lw-input-form"
        onSubmit={(e) => {
          e.preventDefault();
          if (textValue.trim()) {
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
        />
        <button type="submit" className="lw-submit-btn" disabled={!textValue.trim()}>
          Next
        </button>
      </form>
    </div>
  );
}

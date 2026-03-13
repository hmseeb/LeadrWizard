import React from "react";
import { useWizardSession } from "../hooks/useWizardSession";
import { ProgressBar } from "./ProgressBar";
import { StepRenderer } from "./StepRenderer";

interface WizardWidgetProps {
  sessionId: string;
  apiBaseUrl?: string;
}

export function WizardWidget({ sessionId, apiBaseUrl }: WizardWidgetProps) {
  const {
    loading,
    error,
    client,
    session,
    services,
    currentQuestion,
    completionPct,
    submitResponse,
    submitting,
    stepError,
    clearStepError,
  } = useWizardSession(sessionId, apiBaseUrl);

  if (loading) {
    return (
      <div className="lw-widget lw-loading">
        <div className="lw-spinner" />
        <p>Loading your onboarding...</p>
      </div>
    );
  }

  if (error) {
    return (
      <div className="lw-widget lw-error">
        <p>Something went wrong: {error}</p>
        <p className="lw-error-hint">
          Please try refreshing or contact support.
        </p>
      </div>
    );
  }

  const isReturning =
    session?.last_interaction_at && completionPct > 0 && completionPct < 100;

  return (
    <div className="lw-widget">
      {/* Header */}
      <div className="lw-header">
        <h2 className="lw-title">
          {isReturning
            ? `Welcome back${client?.name ? `, ${client.name}` : ""}!`
            : `Hi${client?.name ? ` ${client.name}` : ""}! Let's get you set up.`}
        </h2>
        {isReturning && (
          <p className="lw-subtitle">
            You have{" "}
            {services.reduce((sum, s) => sum + s.missingFields.length, 0)}{" "}
            items remaining.
          </p>
        )}
      </div>

      {/* Progress */}
      <ProgressBar completionPct={completionPct} services={services} />

      {/* Step Content — visual mode only (voice toggle hidden until Phase 6) */}
      {currentQuestion && (
        <StepRenderer
          question={currentQuestion}
          submitting={submitting}
          stepError={stepError}
          onSubmit={(value) => {
            if (currentQuestion.field_key) {
              const serviceMatch = services.find(
                (s) => s.serviceId === currentQuestion.service_id
              );
              submitResponse(
                currentQuestion.field_key,
                value,
                serviceMatch?.clientServiceId || null,
                "click"
              );
            }
          }}
          onRetry={clearStepError}
        />
      )}
    </div>
  );
}

import React from "react";
import { useWizardSession } from "../hooks/useWizardSession";
import { ProgressBar } from "./ProgressBar";
import { StepRenderer } from "./StepRenderer";
import { VoiceBotToggle } from "./VoiceBotToggle";
import { VoiceBot } from "./VoiceBot";

interface WizardWidgetProps {
  sessionId: string;
  apiBaseUrl?: string;
  supabaseUrl?: string;
  supabaseKey?: string;
}

export function WizardWidget({
  sessionId,
  apiBaseUrl,
  supabaseUrl,
  supabaseKey,
}: WizardWidgetProps) {
  const {
    loading,
    error,
    client,
    session,
    services,
    currentQuestion,
    completionPct,
    mode,
    submitResponse,
    setMode,
  } = useWizardSession(sessionId, apiBaseUrl, supabaseUrl, supabaseKey);

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
            You have {services.reduce((sum, s) => sum + s.missingFields.length, 0)}{" "}
            items remaining.
          </p>
        )}
      </div>

      {/* Progress */}
      <ProgressBar completionPct={completionPct} services={services} />

      {/* Mode Toggle */}
      <VoiceBotToggle mode={mode} onToggle={setMode} />

      {/* Content Area */}
      {mode === "voice" ? (
        <VoiceBot
          sessionId={sessionId}
          isActive={true}
          onAnswer={(fieldKey, value) => {
            const serviceWithMissing = services.find((s) =>
              s.missingFields.some((f) => f.key === fieldKey)
            );
            submitResponse(
              fieldKey,
              value,
              serviceWithMissing?.clientService.id || null,
              "voice"
            );
          }}
        />
      ) : currentQuestion ? (
        <StepRenderer
          question={currentQuestion}
          onSubmit={(value) => {
            if (currentQuestion.field_key) {
              const serviceWithMissing = services.find(
                (s) => s.definition.id === currentQuestion.service_id
              );
              submitResponse(
                currentQuestion.field_key,
                value,
                serviceWithMissing?.clientService.id || null,
                "click"
              );
            }
          }}
        />
      ) : null}

      {/* Completion Gate */}
      {completionPct === 100 && (
        <div className="lw-complete-banner">
          All information collected! Your services are being set up.
        </div>
      )}
    </div>
  );
}

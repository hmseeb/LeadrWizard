import React from "react";
import { useWizardSession } from "../hooks/useWizardSession";
import { ProgressBar } from "./ProgressBar";
import { StepRenderer } from "./StepRenderer";
import { VoiceBotToggle } from "./VoiceBotToggle";
import { VoiceBot } from "./VoiceBot";

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
    mode,
    setMode,
    submitResponse,
    submitting,
    stepError,
    clearStepError,
    voiceConfig,
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

  // Voice is available only when org has an ElevenLabs agent configured
  const voiceAvailable = !!voiceConfig?.elevenlabsAgentId;

  // Session is not complete (still has questions)
  const isActive = currentQuestion?.action !== "complete";

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

      {/* Mode Toggle: only when voice available AND session not complete */}
      {voiceAvailable && isActive && (
        <VoiceBotToggle mode={mode} onToggle={setMode} />
      )}

      {/* Voice Mode */}
      {mode === "voice" && voiceAvailable && isActive && (
        <VoiceBot
          sessionId={sessionId}
          isActive={true}
          agentId={voiceConfig.elevenlabsAgentId!}
          onAnswer={(fieldKey, value) => {
            const serviceMatch = services.find((s) =>
              s.missingFields.some((f) => f.key === fieldKey)
            );
            submitResponse(
              fieldKey,
              value,
              serviceMatch?.clientServiceId || null,
              "voice"
            );
          }}
        />
      )}

      {/* Form Mode (default, or when voice not available) */}
      {mode === "visual" && currentQuestion && (
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

      {/* Completion screen in voice mode (switch to visual to show it) */}
      {mode === "voice" && !isActive && currentQuestion && (
        <StepRenderer
          question={currentQuestion}
          submitting={false}
          stepError={null}
          onSubmit={() => {}}
          onRetry={() => {}}
        />
      )}
    </div>
  );
}

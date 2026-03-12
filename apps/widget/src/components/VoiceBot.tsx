import React from "react";

interface VoiceBotProps {
  sessionId: string;
  isActive: boolean;
}

/**
 * Voice bot component — ElevenLabs Conversational AI integration.
 *
 * TODO (Session 2): Wire up @11labs/react SDK:
 * - useConversation hook with agent ID from config
 * - System prompt built from wizard context (services, questions, collected answers)
 * - Client-side tools: recordAnswer(), advanceToNextItem(), requestCallback()
 * - Visual indicators: listening, speaking, thinking states
 * - Dynamic context injection via sendContextualUpdate()
 */
export function VoiceBot({ sessionId, isActive }: VoiceBotProps) {
  if (!isActive) return null;

  return (
    <div className="lw-voice-bot">
      <div className="lw-voice-avatar">
        <div className="lw-voice-pulse" />
        <svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
          <path d="M12 1a3 3 0 0 0-3 3v8a3 3 0 0 0 6 0V4a3 3 0 0 0-3-3z" />
          <path d="M19 10v2a7 7 0 0 1-14 0v-2" />
          <line x1="12" y1="19" x2="12" y2="23" />
          <line x1="8" y1="23" x2="16" y2="23" />
        </svg>
      </div>
      <p className="lw-voice-status">
        Voice assistant ready. Click the microphone to start talking.
      </p>
      <button className="lw-voice-start-btn">
        Start Voice Onboarding
      </button>
      <p className="lw-voice-note">
        ElevenLabs integration coming in the next session.
        Switch to Visual mode to use the form-based onboarding.
      </p>
    </div>
  );
}

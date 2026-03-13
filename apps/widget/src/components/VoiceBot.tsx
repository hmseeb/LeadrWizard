import React, { useState, useCallback, useEffect, useRef } from "react";

interface VoiceBotProps {
  sessionId: string;
  isActive: boolean;
  agentId?: string;
  onAnswer?: (fieldKey: string, value: string) => void;
}

type ConversationStatus = "idle" | "connecting" | "listening" | "speaking" | "thinking";

/**
 * Voice bot component — ElevenLabs Conversational AI integration.
 *
 * Uses the ElevenLabs WebSocket API for real-time voice conversation.
 * The agent ID is configured via the NEXT_PUBLIC_ELEVENLABS_AGENT_ID env var
 * or passed as a prop.
 *
 * Client-side tools available to the agent:
 * - recordAnswer: Records a field response from the voice conversation
 * - advanceToNextItem: Signals the widget to move to the next question
 * - requestCallback: Schedules a callback for the client
 */
export function VoiceBot({ sessionId, isActive, agentId, onAnswer }: VoiceBotProps) {
  const [status, setStatus] = useState<ConversationStatus>("idle");
  const [transcript, setTranscript] = useState<string[]>([]);
  const [error, setError] = useState<string | null>(null);
  const wsRef = useRef<WebSocket | null>(null);
  const audioContextRef = useRef<AudioContext | null>(null);
  const mediaStreamRef = useRef<MediaStream | null>(null);

  const resolvedAgentId =
    agentId || getMetaContent("leadrwizard:elevenlabs-agent-id") || "";

  const cleanup = useCallback(() => {
    if (wsRef.current) {
      wsRef.current.close();
      wsRef.current = null;
    }
    if (mediaStreamRef.current) {
      mediaStreamRef.current.getTracks().forEach((t) => t.stop());
      mediaStreamRef.current = null;
    }
    if (audioContextRef.current) {
      audioContextRef.current.close();
      audioContextRef.current = null;
    }
  }, []);

  const startConversation = useCallback(async () => {
    if (!resolvedAgentId) {
      setError("ElevenLabs agent ID not configured.");
      return;
    }

    setError(null);
    setStatus("connecting");

    try {
      // Request microphone access
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      mediaStreamRef.current = stream;

      // Get a signed URL for the conversation
      const signedUrlResponse = await fetch(
        `https://api.elevenlabs.io/v1/convai/conversation/get_signed_url?agent_id=${resolvedAgentId}`
      );

      if (!signedUrlResponse.ok) {
        throw new Error("Failed to get signed URL from ElevenLabs");
      }

      const { signed_url } = (await signedUrlResponse.json()) as { signed_url: string };

      // Connect via WebSocket
      const ws = new WebSocket(signed_url);
      wsRef.current = ws;

      // Set up AudioContext for playback
      const audioContext = new AudioContext({ sampleRate: 16000 });
      audioContextRef.current = audioContext;

      ws.onopen = () => {
        setStatus("listening");

        // Send session context as initial metadata
        ws.send(
          JSON.stringify({
            type: "conversation_initiation_client_data",
            conversation_initiation_client_data: {
              conversation_config_override: {
                agent: {
                  prompt: {
                    prompt: `Session ID: ${sessionId}. Help the user complete their onboarding by asking about each missing field one at a time.`,
                  },
                },
              },
            },
          })
        );

        // Start streaming audio from microphone
        startAudioCapture(stream, ws);
      };

      ws.onmessage = (event) => {
        const data = JSON.parse(event.data as string) as {
          type: string;
          audio?: { chunk?: string };
          user_transcript?: string;
          agent_response?: string;
          client_tool_call?: {
            tool_name: string;
            parameters: string;
            tool_call_id: string;
          };
        };

        switch (data.type) {
          case "audio":
            setStatus("speaking");
            if (data.audio?.chunk) {
              playAudioChunk(audioContext, data.audio.chunk);
            }
            break;

          case "user_transcript":
            if (data.user_transcript) {
              setTranscript((prev) => [...prev, `You: ${data.user_transcript}`]);
            }
            break;

          case "agent_response":
            setStatus("thinking");
            if (data.agent_response) {
              setTranscript((prev) => [...prev, `Assistant: ${data.agent_response}`]);
            }
            break;

          case "agent_response_correction":
            setStatus("listening");
            break;

          case "client_tool_call":
            handleToolCall(ws, data.client_tool_call!, onAnswer);
            break;

          case "interruption":
            setStatus("listening");
            break;
        }
      };

      ws.onerror = () => {
        setError("Connection lost. Please try again.");
        setStatus("idle");
        cleanup();
      };

      ws.onclose = () => {
        setStatus("idle");
      };
    } catch (err) {
      const message =
        err instanceof DOMException && err.name === "NotAllowedError"
          ? "Microphone access denied. Please allow microphone access and try again."
          : err instanceof Error
            ? err.message
            : "Failed to start voice conversation";
      setError(message);
      setStatus("idle");
      cleanup();
    }
  }, [resolvedAgentId, sessionId, onAnswer, cleanup]);

  const stopConversation = useCallback(() => {
    cleanup();
    setStatus("idle");
  }, [cleanup]);

  // Clean up on unmount
  useEffect(() => {
    return cleanup;
  }, [cleanup]);

  if (!isActive) return null;

  return (
    <div className="lw-voice-bot">
      {/* Visual indicator */}
      <div className={`lw-voice-avatar ${status !== "idle" ? "lw-voice-active" : ""}`}>
        <div className={`lw-voice-pulse ${status === "speaking" ? "lw-voice-speaking" : ""}`} />
        <svg
          width="32"
          height="32"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
        >
          <path d="M12 1a3 3 0 0 0-3 3v8a3 3 0 0 0 6 0V4a3 3 0 0 0-3-3z" />
          <path d="M19 10v2a7 7 0 0 1-14 0v-2" />
          <line x1="12" y1="19" x2="12" y2="23" />
          <line x1="8" y1="23" x2="16" y2="23" />
        </svg>
      </div>

      {/* Status text */}
      <p className="lw-voice-status">
        {status === "idle" && "Click the button below to start voice onboarding."}
        {status === "connecting" && "Connecting..."}
        {status === "listening" && "Listening... speak now."}
        {status === "speaking" && "Speaking..."}
        {status === "thinking" && "Processing..."}
      </p>

      {/* Error message */}
      {error && <p className="lw-voice-error">{error}</p>}

      {/* Transcript */}
      {transcript.length > 0 && (
        <div className="lw-voice-transcript">
          {transcript.slice(-6).map((line, i) => (
            <p key={i} className={line.startsWith("You:") ? "lw-transcript-user" : "lw-transcript-agent"}>
              {line}
            </p>
          ))}
        </div>
      )}

      {/* Control button */}
      {status === "idle" ? (
        <button className="lw-voice-start-btn" onClick={startConversation}>
          Start Voice Onboarding
        </button>
      ) : (
        <button className="lw-voice-stop-btn" onClick={stopConversation}>
          End Conversation
        </button>
      )}

      {!resolvedAgentId && (
        <p className="lw-voice-note">
          Voice onboarding requires an ElevenLabs agent ID. Switch to Visual
          mode to use the form-based onboarding.
        </p>
      )}
    </div>
  );
}

function startAudioCapture(stream: MediaStream, ws: WebSocket) {
  const audioContext = new AudioContext({ sampleRate: 16000 });
  const source = audioContext.createMediaStreamSource(stream);
  const processor = audioContext.createScriptProcessor(4096, 1, 1);

  processor.onaudioprocess = (event) => {
    if (ws.readyState !== WebSocket.OPEN) return;

    const inputData = event.inputBuffer.getChannelData(0);
    const pcm16 = float32ToPCM16(inputData);
    const base64 = btoa(String.fromCharCode(...new Uint8Array(pcm16.buffer)));

    ws.send(
      JSON.stringify({
        user_audio_chunk: base64,
      })
    );
  };

  source.connect(processor);
  processor.connect(audioContext.destination);
}

function float32ToPCM16(float32: Float32Array): Int16Array {
  const pcm16 = new Int16Array(float32.length);
  for (let i = 0; i < float32.length; i++) {
    const clamped = Math.max(-1, Math.min(1, float32[i]));
    pcm16[i] = clamped < 0 ? clamped * 0x8000 : clamped * 0x7fff;
  }
  return pcm16;
}

function playAudioChunk(audioContext: AudioContext, base64Audio: string) {
  const binaryString = atob(base64Audio);
  const bytes = new Uint8Array(binaryString.length);
  for (let i = 0; i < binaryString.length; i++) {
    bytes[i] = binaryString.charCodeAt(i);
  }

  const float32 = new Float32Array(bytes.length / 2);
  const dataView = new DataView(bytes.buffer);
  for (let i = 0; i < float32.length; i++) {
    float32[i] = dataView.getInt16(i * 2, true) / 0x7fff;
  }

  const buffer = audioContext.createBuffer(1, float32.length, 16000);
  buffer.getChannelData(0).set(float32);

  const source = audioContext.createBufferSource();
  source.buffer = buffer;
  source.connect(audioContext.destination);
  source.start();
}

function handleToolCall(
  ws: WebSocket,
  toolCall: { tool_name: string; parameters: string; tool_call_id: string },
  onAnswer?: (fieldKey: string, value: string) => void
) {
  const params = JSON.parse(toolCall.parameters) as Record<string, string>;

  switch (toolCall.tool_name) {
    case "recordAnswer":
      if (params.field_key && params.field_value && onAnswer) {
        onAnswer(params.field_key, params.field_value);
      }
      ws.send(
        JSON.stringify({
          type: "client_tool_result",
          tool_call_id: toolCall.tool_call_id,
          result: "Answer recorded successfully",
        })
      );
      break;

    case "advanceToNextItem":
      ws.send(
        JSON.stringify({
          type: "client_tool_result",
          tool_call_id: toolCall.tool_call_id,
          result: "Moving to next item",
        })
      );
      break;

    case "requestCallback":
      ws.send(
        JSON.stringify({
          type: "client_tool_result",
          tool_call_id: toolCall.tool_call_id,
          result: "Callback request submitted. A team member will reach out shortly.",
        })
      );
      break;

    default:
      ws.send(
        JSON.stringify({
          type: "client_tool_result",
          tool_call_id: toolCall.tool_call_id,
          result: "Unknown tool",
        })
      );
  }
}

function getMetaContent(name: string): string | null {
  if (typeof document === "undefined") return null;
  const meta = document.querySelector(`meta[name="${name}"]`);
  return meta?.getAttribute("content") || null;
}

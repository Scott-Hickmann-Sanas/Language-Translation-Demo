import { ConnectionState, StreamMessage } from "./streamMessages";
import {
  StreamV3GlossaryEntry,
  StreamV3ServerMessage,
} from "./streamV3Messages";
import { Word } from "./words";

export * from "./delimiters";
export * from "./streamMessages";
export * from "./streamV3Messages";
export * from "./words";

// --- TranslationState callbacks (state-related, all optional) ---

export interface TranslationStateCallbacks {
  onUtterance?: (utterance: UtteranceDisplay, index: number) => void;
  onLanguages?: (languages: IdentifiedLanguageDisplay[]) => void;
  onConfigured?: (requestId: string | null) => void;
  onLanguageRoute?: (
    langIn: string,
    langOut: string,
    utteranceIdx: number,
  ) => void;
  onOutputSpeechEnded?: (utteranceIdx: number, outputTime: number) => void;
  onTranslationEnded?: (utteranceIdx: number) => void;
  onFlushed?: (requestId: string | null) => void;
  onConnectionStateChange?: (state: ConnectionState) => void;
  onError?: (error: string) => void;
}

// --- Client options ---

export interface SanasTranslationClientOptions {
  /** API key authentication. Use this OR accessToken, not both. */
  apiKey?: string;
  /** OAuth access token authentication. Use this OR apiKey, not both. */
  accessToken?: string;
  /** LT server endpoint URL. */
  endpoint: string;
  /** Fires with every StreamMessage for relay to other participants. */
  onMessage?: (message: StreamMessage) => void;
  /** Fires with raw output audio data (Int16 PCM) as received from the server. */
  onAudioData?: (samples: Int16Array, sampleRate: number) => void;
}

export type SampleRate = 8000 | 16000 | 24000;

export interface ConnectOptions {
  /** Transport implementation to use (WebRTC or WebSocket). */
  transport: Transport;
  /** Audio track to send to the server (from mic, file, etc.). */
  audioTrack: MediaStreamTrack;
  /** Whether input audio should be sent immediately. Defaults to audioTrack.enabled. */
  audioEnabled?: boolean;
  /** Conversation ID to join. Use null to generate one locally. */
  conversationId?: string | null;
  /** Session name for this participant/session. */
  sessionName?: string | null;
  /** Input audio sample rate in Hz. Defaults to 16000. */
  inputSampleRate?: SampleRate;
  /** Output audio sample rate in Hz. Defaults to 16000. */
  outputSampleRate?: SampleRate;
  /** Request realtime output playback from the v3 service. */
  realtimePlayback?: boolean;
}

export interface ConnectResult {
  /** The translated audio stream from the server. */
  audio: MediaStream;
}

export interface ResetOptions {
  /** One or more v3 language routes to configure. */
  languageRoutes: LanguageRoute[];
  /** Voice ID for the translated audio. */
  voiceId?: string | null;
  /** Optional glossary entries in the Stream v3 configure message format. */
  glossary?: StreamV3GlossaryEntry[] | null;
  /** Optional feature flags for the v3 stream service. */
  features?: string[];
  /** Optional caller-provided correlation ID. */
  requestId?: string | null;
}

export interface LanguageRoute {
  langIn: string;
  langOut: string;
}

// --- Transport abstraction ---

export interface TransportCallbacks {
  onMessage: (message: StreamV3ServerMessage) => void;
  onError: (error: string) => void;
  onConnectionStateChange: (state: ConnectionState) => void;
  onAudioData?: (samples: Int16Array, sampleRate: number) => void;
}

export interface Transport {
  connect(
    options: ConnectOptions,
    clientOptions: SanasTranslationClientOptions,
    callbacks: TransportCallbacks,
  ): Promise<ConnectResult>;
  /** Send language/config settings. Returns the v3 configure request ID. */
  configure(options: ResetOptions): string | null;
  /** Flush server-side audio/text. Returns the v3 flush request ID. */
  flush(): string | null;
  disconnect(): void;
  /** Wait for any pending audio playback to finish before tearing down. */
  drainAudio(): Promise<void>;
  setAudioEnabled(enabled: boolean): void;
  readonly sessionId: string | null;
}

// --- Display types ---

export interface UtteranceStreamDisplay {
  /** Text that the audio has already played through. */
  spokenText: string;
  /** Text that the audio hasn't reached yet. */
  unspokenText: string;
  /** Raw complete (finalized) words. */
  complete: Word[];
  /** Raw partial (in-progress) words. */
  partial: Word[];
}

export interface UtteranceDisplay {
  /** Transcription display data for this utterance. */
  transcription: UtteranceStreamDisplay;
  /** Translation display data for this utterance. */
  translation: UtteranceStreamDisplay;
}

export interface IdentifiedLanguageDisplay {
  /** Short language code (e.g. "en"). */
  shortCode: string;
  /** Localized display name. */
  name: string;
  /** Probability of the language being detected. */
  probability: number;
}

export interface TranslationClientState {
  /** Pre-computed utterance display objects, one per utterance. */
  utterances: UtteranceDisplay[];
  /** Identified languages from language detection. */
  identifiedLanguages: IdentifiedLanguageDisplay[];
}

export interface Language {
  /** Full language code with region (e.g. "en-US"). */
  longCode: string;
  /** Short language code (e.g. "en"). */
  shortCode: string;
  /** Localized display name. */
  name: string;
  /** Support tier. */
  support: "alpha" | "beta" | "stable";
}

export interface FetchLanguagesOptions {
  /** Language code for localized response names (e.g. "en-US"). Defaults to "en-US". */
  lang?: string;
}

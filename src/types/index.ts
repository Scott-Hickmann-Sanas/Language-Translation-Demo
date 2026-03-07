import { LTMessage } from "./ltMessages";
import { ConnectionState, StreamMessage } from "./streamMessages";
import { Word } from "./words";

export * from "./delimiters";
export * from "./ltMessages";
export * from "./streamMessages";
export * from "./words";
export * from "./wsMessages";

// --- TranslationState callbacks (state-related, all optional) ---

export interface TranslationStateCallbacks {
  onUtterance?: (utterance: UtteranceDisplay, index: number) => void;
  onLanguages?: (languages: IdentifiedLanguageDisplay[]) => void;
  onReady?: (id: string | null) => void;
  onSpeechLanguages?: (langIn: string, langOut: string) => void;
  onSpeechStop?: () => void;
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
}

export type SampleRate = 8000 | 16000 | 24000;

export interface ConnectOptions {
  /** Transport implementation to use (WebRTC or WebSocket). */
  transport: Transport;
  /** Audio track to send to the server (from mic, file, etc.). */
  audioTrack: MediaStreamTrack;
  /** Conversation ID to join. */
  conversationId?: string | null;
  /** Display name for this participant. */
  userName?: string | null;
  /** Input audio sample rate in Hz. Defaults to 16000. */
  inputSampleRate?: SampleRate;
  /** Output audio sample rate in Hz. Defaults to 16000. */
  outputSampleRate?: SampleRate;
}

export interface ConnectResult {
  /** The translated audio stream from the server. */
  audio: MediaStream;
}

export interface ResetOptions {
  /** Input language code (e.g. "en-US"). */
  langIn: string;
  /** Output language code (e.g. "es-ES"). */
  langOut: string;
  /** Voice ID for the translated audio. */
  voiceId?: string | null;
  /** Glossary terms to preserve during translation. */
  glossary?: string[] | null;
  /** Whether to clear conversation history. */
  clearHistory?: boolean;
  /** Whether to allow automatic language swapping. */
  canLangSwap?: boolean;
  /** Whether to enable language detection. */
  detectLanguages?: boolean;
}

// --- Transport abstraction ---

export interface TransportCallbacks {
  onMessage: (message: LTMessage) => void;
  onError: (error: string) => void;
  onConnectionStateChange: (state: ConnectionState) => void;
}

export interface Transport {
  connect(
    options: ConnectOptions,
    clientOptions: SanasTranslationClientOptions,
    callbacks: TransportCallbacks,
  ): Promise<ConnectResult>;
  /** Send language/config settings. Returns a reset ID (WebRTC) or null (WebSocket). */
  configure(options: ResetOptions): string | null;
  disconnect(): void;
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

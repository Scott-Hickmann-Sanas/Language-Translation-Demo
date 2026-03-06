import { TranslationState } from "./TranslationState";
import {
  ConnectionState,
  ConnectOptions,
  ConnectResult,
  FetchLanguagesOptions,
  IdentifiedLanguageDisplay,
  Language,
  LTMessage,
  ResetOptions,
  SanasTranslationClientOptions,
  TranslationClientState,
  Transport,
  UtteranceDisplay,
} from "./types";
import { WebRTCTransport } from "./WebRTCTransport";
import { WebSocketTransport } from "./WebSocketTransport";

type UtteranceCallback = (utterance: UtteranceDisplay, index: number) => void;
type LanguagesCallback = (languages: IdentifiedLanguageDisplay[]) => void;
type ConnectionStateCallback = (state: ConnectionState) => void;
type ErrorCallback = (error: string) => void;
type SpeechLanguagesCallback = (langIn: string, langOut: string) => void;
type SpeechStopCallback = () => void;

export class SanasTranslationClient {
  private options: SanasTranslationClientOptions;
  private translationState: TranslationState;

  private transport: Transport | null = null;
  private _connectionState: ConnectionState = "disconnected";
  private _error: string | null = null;
  private _isAudioEnabled = true;

  private audioContext: AudioContext | null = null;
  private audioStreamStartTime = 0;
  private scheduledDelimiterNodes: AudioBufferSourceNode[] = [];

  private utteranceCallbacks = new Set<UtteranceCallback>();
  private languagesCallbacks = new Set<LanguagesCallback>();
  private connectionStateCallbacks = new Set<ConnectionStateCallback>();
  private errorCallbacks = new Set<ErrorCallback>();
  private speechLanguagesCallbacks = new Set<SpeechLanguagesCallback>();
  private speechStopCallbacks = new Set<SpeechStopCallback>();

  // Pending reset promises keyed by reset ID
  private pendingResets = new Map<
    string,
    { resolve: () => void; reject: (err: Error) => void }
  >();

  constructor(options: SanasTranslationClientOptions) {
    this.options = options;
    this.translationState = new TranslationState({
      onUtteranceChanged: (utterance, index) => {
        for (const cb of this.utteranceCallbacks) {
          cb(utterance, index);
        }
      },
      onLanguagesChanged: (languages) => {
        for (const cb of this.languagesCallbacks) {
          cb(languages);
        }
      },
      onReady: (id) => {
        console.log("[LT] Ready received, resetting audioElapsed. id:", id);

        // Record the audio epoch for scheduling speech delimiters
        this.audioStreamStartTime = this.audioContext?.currentTime ?? 0;
        this.cancelScheduledDelimiters();

        if (id !== null && this.pendingResets.has(id)) {
          this.pendingResets.get(id)!.resolve();
          this.pendingResets.delete(id);
        }
      },
      onSpeechLanguages: (langIn, langOut) => {
        for (const cb of this.speechLanguagesCallbacks) {
          cb(langIn, langOut);
        }
      },
      onSpeechStop: () => {
        for (const cb of this.speechStopCallbacks) {
          cb();
        }
      },
    });
  }

  // --- Public getters ---

  get connectionState(): ConnectionState {
    return this._connectionState;
  }

  get sessionId(): string | null {
    return this.transport?.sessionId ?? null;
  }

  get error(): string | null {
    return this._error;
  }

  get state(): TranslationClientState {
    return this.translationState.getState();
  }

  get isAudioEnabled(): boolean {
    return this._isAudioEnabled;
  }

  set isAudioEnabled(enabled: boolean) {
    this._isAudioEnabled = enabled;
    this.transport?.setAudioEnabled(enabled);
  }

  // --- Lifecycle ---

  async connect(options?: ConnectOptions): Promise<ConnectResult> {
    if (this.transport) {
      throw new Error("Already connected. Call disconnect() first.");
    }

    this._error = null;
    this.setConnectionState("connecting");

    const transport = options?.websocket
      ? new WebSocketTransport()
      : new WebRTCTransport();
    this.transport = transport;

    // Create AudioContext during user gesture so it starts in "running" state
    const ctx = new AudioContext();
    this.audioContext = ctx;
    await ctx.resume();

    try {
      const result = await transport.connect(options ?? {}, this.options, {
        onMessage: (message: LTMessage) => {
          if (message.type === "speech_delimiter") {
            this.scheduleSpeechDelimiter(message);
          } else {
            this.translationState.handleMessage(message);
          }
        },
        onError: (error: string) => {
          this.setError(error);
        },
        onConnectionStateChange: (state: ConnectionState) => {
          this.setConnectionState(state);
        },
      });

      // For WebRTC, wire AudioContext clock to remote stream for delimiter sync
      if (!options?.websocket) {
        const source = ctx.createMediaStreamSource(result.audio);
        const silentGain = ctx.createGain();
        silentGain.gain.value = 0;
        source.connect(silentGain);
        silentGain.connect(ctx.destination);
      }

      transport.setAudioEnabled(this._isAudioEnabled);

      return result;
    } catch (err) {
      if (this.transport === transport) {
        this.transport = null;
      }
      this.cleanupAudioTracking();
      this.setConnectionState("disconnected");
      throw err;
    }
  }

  disconnect(): void {
    // Reject any pending resets
    for (const [, pending] of this.pendingResets) {
      pending.reject(new Error("Disconnected"));
    }
    this.pendingResets.clear();

    if (this.transport) {
      this.transport.disconnect();
      this.transport = null;
    }

    this.setConnectionState("disconnected");
    this._error = null;

    this.cleanupAudioTracking();
    this.translationState.destroy();
  }

  // --- REST API ---

  async fetchLanguages(options?: FetchLanguagesOptions): Promise<Language[]> {
    const headers: Record<string, string> = {};

    if (this.options.accessToken) {
      headers["Authorization"] = `Bearer ${this.options.accessToken}`;
    } else if (this.options.apiKey) {
      headers["X-API-Key"] = this.options.apiKey;
    } else {
      throw new Error("Missing credentials: provide apiKey or accessToken.");
    }

    if (options?.lang) {
      headers["x-lang"] = options.lang;
    }

    const response = await fetch(`${this.options.endpoint}/v2/languages/list`, {
      method: "POST",
      headers,
    });

    if (!response.ok) {
      if (response.status === 403) {
        throw new Error("Authentication failed.");
      }
      throw new Error(`Failed to fetch languages: ${response.status}`);
    }

    const body = await response.json();
    return (body.data.languages as Array<Record<string, string>>).map((l) => ({
      longCode: l.long_code,
      shortCode: l.short_code,
      name: l.name,
      support: l.support as Language["support"],
    }));
  }

  // --- Messaging ---

  async reset(options: ResetOptions): Promise<void> {
    if (!this.transport) {
      throw new Error("Not connected. Call connect() first.");
    }

    const resetId = this.transport.configure(options);

    if (resetId !== null) {
      // WebRTC: server will respond with ready containing this ID
      return new Promise<void>((resolve, reject) => {
        this.pendingResets.set(resetId, { resolve, reject });
      });
    }

    // WebSocket: server responds with ready (id: null) — use onReadyOnce
    return new Promise<void>((resolve) => {
      this.translationState.onReadyOnce(() => {
        resolve();
      });
    });
  }

  // --- Callbacks ---

  onUtterance(callback: UtteranceCallback): () => void {
    this.utteranceCallbacks.add(callback);
    return () => {
      this.utteranceCallbacks.delete(callback);
    };
  }

  onLanguages(callback: LanguagesCallback): () => void {
    this.languagesCallbacks.add(callback);
    return () => {
      this.languagesCallbacks.delete(callback);
    };
  }

  onSpeechLanguages(callback: SpeechLanguagesCallback): () => void {
    this.speechLanguagesCallbacks.add(callback);
    return () => {
      this.speechLanguagesCallbacks.delete(callback);
    };
  }

  onSpeechStop(callback: SpeechStopCallback): () => void {
    this.speechStopCallbacks.add(callback);
    return () => {
      this.speechStopCallbacks.delete(callback);
    };
  }

  onConnectionStateChange(callback: ConnectionStateCallback): () => void {
    this.connectionStateCallbacks.add(callback);
    return () => {
      this.connectionStateCallbacks.delete(callback);
    };
  }

  onError(callback: ErrorCallback): () => void {
    this.errorCallbacks.add(callback);
    return () => {
      this.errorCallbacks.delete(callback);
    };
  }

  // --- Internal ---

  private setConnectionState(state: ConnectionState): void {
    if (this._connectionState !== state) {
      this._connectionState = state;
      for (const cb of this.connectionStateCallbacks) {
        cb(state);
      }
    }
  }

  private setError(error: string): void {
    this._error = error;
    for (const cb of this.errorCallbacks) {
      cb(error);
    }
  }

  private scheduleSpeechDelimiter(message: LTMessage): void {
    if (!this.audioContext) {
      this.translationState.handleMessage(message);
      return;
    }

    if (message.type !== "speech_delimiter") return;

    const ctx = this.audioContext;
    const scheduledTime =
      this.audioStreamStartTime + message.speech_delimiter.time;

    const buffer = ctx.createBuffer(1, 1, ctx.sampleRate);
    const source = ctx.createBufferSource();
    source.buffer = buffer;
    source.connect(ctx.destination);

    source.onended = () => {
      const idx = this.scheduledDelimiterNodes.indexOf(source);
      if (idx !== -1) {
        this.scheduledDelimiterNodes.splice(idx, 1);
      }
      this.translationState.handleMessage(message);
    };

    source.start(scheduledTime);
    this.scheduledDelimiterNodes.push(source);
  }

  private cancelScheduledDelimiters(): void {
    for (const node of this.scheduledDelimiterNodes) {
      node.onended = null;
      try {
        node.stop();
      } catch {
        // Already stopped
      }
      node.disconnect();
    }
    this.scheduledDelimiterNodes = [];
  }

  private cleanupAudioTracking(): void {
    this.cancelScheduledDelimiters();
    if (this.audioContext) {
      this.audioContext.close();
    }
    this.audioContext = null;
    this.audioStreamStartTime = 0;
  }
}

import { TranslationState } from "./TranslationState";
import {
  ConnectOptions,
  ConnectResult,
  FetchLanguagesOptions,
  Language,
  LTMessage,
  ResetOptions,
  SanasTranslationClientOptions,
  StreamMessage,
  Transport,
} from "./types";

export class SanasTranslationClient {
  private options: SanasTranslationClientOptions;
  private translationState: TranslationState;

  private transport: Transport | null = null;
  private _isAudioEnabled = true;

  private audioContext: AudioContext | null = null;
  private audioStreamStartTime = 0;
  private scheduledDelimiterNodes: AudioBufferSourceNode[] = [];

  constructor(
    translationState: TranslationState,
    options: SanasTranslationClientOptions,
  ) {
    this.translationState = translationState;
    this.options = options;
  }

  // --- Lifecycle ---

  async connect(options: ConnectOptions): Promise<ConnectResult> {
    if (this.transport) {
      throw new Error("Already connected. Call disconnect() first.");
    }

    this.handleIncomingMessage({ type: "transport", state: "connecting" });

    const transport = options.transport;
    this.transport = transport;

    const ctx = new AudioContext();
    this.audioContext = ctx;
    await ctx.resume();

    try {
      const result = await transport.connect(options, this.options, {
        onMessage: (msg: LTMessage) =>
          this.handleIncomingMessage({ type: "lt", lt: msg }),
        onError: (error: string) =>
          this.handleIncomingMessage({ type: "error", message: error }),
        onConnectionStateChange: (state) =>
          this.handleIncomingMessage({ type: "transport", state }),
      });

      const source = ctx.createMediaStreamSource(result.audio);
      const silentGain = ctx.createGain();
      silentGain.gain.value = 0;
      source.connect(silentGain);
      silentGain.connect(ctx.destination);

      transport.setAudioEnabled(this._isAudioEnabled);

      return result;
    } catch (err) {
      if (this.transport === transport) {
        this.transport = null;
      }
      this.cleanupAudioTracking();
      this.handleIncomingMessage({ type: "transport", state: "disconnected" });
      throw err;
    }
  }

  disconnect(): void {
    this.translationState.destroy();

    if (this.transport) {
      this.transport.disconnect();
      this.transport = null;
    }

    this.cleanupAudioTracking();

    this.handleIncomingMessage({ type: "transport", state: "disconnected" });
  }

  // --- REST API ---

  static async fetchLanguages(
    credentials: { apiKey?: string; accessToken?: string; endpoint: string },
    options?: FetchLanguagesOptions,
  ): Promise<Language[]> {
    const headers: Record<string, string> = {};

    if (credentials.accessToken) {
      headers["Authorization"] = `Bearer ${credentials.accessToken}`;
    } else if (credentials.apiKey) {
      headers["X-API-Key"] = credentials.apiKey;
    } else {
      throw new Error("Missing credentials: provide apiKey or accessToken.");
    }

    if (options?.lang) {
      headers["x-lang"] = options.lang;
    }

    const response = await fetch(`${credentials.endpoint}/v2/languages/list`, {
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
    await this.translationState.waitForReady(resetId);
  }

  // --- Internal ---

  private handleIncomingMessage(message: StreamMessage): void {
    this.options.onMessage?.(message);
    if (message.type === "lt" && message.lt.type === "speech_delimiter") {
      this.scheduleSpeechDelimiter(message.lt);
    } else {
      this.translationState.handleMessage(message);
    }
  }

  private scheduleSpeechDelimiter(message: LTMessage): void {
    if (!this.audioContext) {
      this.translationState.handleMessage({ type: "lt", lt: message });
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
      this.translationState.handleMessage({ type: "lt", lt: message });
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

import { TranslationState } from "./TranslationState";
import {
  ConnectOptions,
  ConnectResult,
  FetchLanguagesOptions,
  Language,
  ResetOptions,
  SanasTranslationClientOptions,
  StreamMessage,
  StreamV3OutputTextBoundaryMessage,
  Transport,
} from "./types";

export class SanasTranslationClient {
  private options: SanasTranslationClientOptions;
  private translationState: TranslationState;

  private transport: Transport | null = null;
  private _isAudioEnabled = true;
  private hasAudioEnabledOverride = false;

  private audioContext: AudioContext | null = null;
  private outputTimelineAnchorTime: number | null = null;
  private pendingOutputTextBoundaries: StreamV3OutputTextBoundaryMessage[] = [];
  private scheduledDelimiterNodes: AudioBufferSourceNode[] = [];
  private pendingResetRequestIds = new Set<string>();

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
    const shouldApplyAudioEnabled =
      options.audioEnabled !== undefined ||
      this.hasAudioEnabledOverride ||
      !options.audioTrack.enabled;
    const audioEnabled =
      options.audioEnabled ??
      (this.hasAudioEnabledOverride
        ? this._isAudioEnabled
        : options.audioTrack.enabled);
    const connectOptions = shouldApplyAudioEnabled
      ? { ...options, audioEnabled }
      : options;
    this._isAudioEnabled = audioEnabled;
    if (shouldApplyAudioEnabled) {
      options.audioTrack.enabled = audioEnabled;
    }

    const ctx = new AudioContext();
    this.audioContext = ctx;
    await ctx.resume();

    try {
      const result = await transport.connect(connectOptions, this.options, {
        onMessage: (msg) => this.handleIncomingMessage(msg),
        onError: (error: string) =>
          this.handleIncomingMessage({
            type: "error",
            message: error,
            code: "CLIENT_ERROR",
          }),
        onConnectionStateChange: (state) =>
          this.handleIncomingMessage({ type: "transport", state }),
        onAudioData: this.options.onAudioData,
      });

      // Keep the AudioContext clock running (for output_text_boundary scheduling)
      // without consuming the audio stream, so callers can record/play it.
      const osc = ctx.createOscillator();
      const silentGain = ctx.createGain();
      silentGain.gain.value = 0;
      osc.connect(silentGain);
      silentGain.connect(ctx.destination);
      osc.start();

      if (shouldApplyAudioEnabled) {
        transport.setAudioEnabled(this._isAudioEnabled);
      }

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

  /**
   * Wait for all pending audio playback and scheduled speech delimiters to
   * complete. Call this before disconnect() on server-initiated disconnects
   * to avoid cutting off in-flight audio.
   */
  async drainAudio(): Promise<void> {
    const transportDrain = this.transport?.drainAudio() ?? Promise.resolve();

    const delimiterDrain =
      this.scheduledDelimiterNodes.length > 0
        ? new Promise<void>((resolve) => {
            const check = () => {
              if (this.scheduledDelimiterNodes.length === 0) {
                resolve();
              } else {
                setTimeout(check, 50);
              }
            };
            check();
          })
        : Promise.resolve();

    await Promise.all([transportDrain, delimiterDrain]);
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

    const requestId = this.transport.configure(options);
    if (requestId !== null) {
      this.pendingResetRequestIds.add(requestId);
      this.resetOutputTimeline();
      try {
        await this.translationState.waitForConfigured(requestId);
      } finally {
        this.pendingResetRequestIds.delete(requestId);
      }
    }
  }

  async flush(): Promise<void> {
    if (!this.transport) {
      throw new Error("Not connected. Call connect() first.");
    }

    const requestId = this.transport.flush();
    if (requestId !== null) {
      await this.translationState.waitForFlushed(requestId);
    }
  }

  setAudioEnabled(enabled: boolean): void {
    this._isAudioEnabled = enabled;
    this.hasAudioEnabledOverride = true;
    this.transport?.setAudioEnabled(enabled);
  }

  // --- Internal ---

  private handleIncomingMessage(message: StreamMessage): void {
    if (message.type === "configured" && message.request_id) {
      this.pendingResetRequestIds.delete(message.request_id);
    }

    if (
      this.pendingResetRequestIds.size > 0 &&
      this.isUtteranceScopedMessage(message)
    ) {
      return;
    }

    this.options.onMessage?.(message);

    switch (message.type) {
      case "configured":
        this.resetOutputTimeline();
        this.translationState.handleMessage(message);
        break;
      case "output_speech_started":
        this.anchorOutputTimeline(message.output_time);
        this.translationState.handleMessage(message);
        this.schedulePendingOutputTextBoundaries();
        break;
      case "output_text_boundary":
        this.scheduleOutputTextBoundary(message);
        break;
      default:
        this.translationState.handleMessage(message);
        break;
    }
  }

  private isUtteranceScopedMessage(message: StreamMessage): boolean {
    switch (message.type) {
      case "input_speech_started":
      case "language_route":
      case "transcription":
      case "transcription_ended":
      case "translation":
      case "translation_ended":
      case "input_speech_ended":
      case "output_speech_started":
      case "output_text_boundary":
      case "output_speech_ended":
      case "identified_languages":
        return true;
      default:
        return false;
    }
  }

  private scheduleOutputTextBoundary(
    message: StreamV3OutputTextBoundaryMessage,
  ): void {
    if (!this.audioContext) {
      this.translationState.handleMessage(message);
      return;
    }

    if (this.outputTimelineAnchorTime === null) {
      this.pendingOutputTextBoundaries.push(message);
      return;
    }

    const ctx = this.audioContext;
    const scheduledTime = this.outputTimelineAnchorTime + message.output_time;

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

    source.start(Math.max(ctx.currentTime, scheduledTime));
    this.scheduledDelimiterNodes.push(source);
  }

  private anchorOutputTimeline(outputTime: number): void {
    if (!this.audioContext) return;
    this.outputTimelineAnchorTime = this.audioContext.currentTime - outputTime;
  }

  private schedulePendingOutputTextBoundaries(): void {
    const pending = this.pendingOutputTextBoundaries;
    this.pendingOutputTextBoundaries = [];
    for (const message of pending) {
      this.scheduleOutputTextBoundary(message);
    }
  }

  private resetOutputTimeline(): void {
    this.outputTimelineAnchorTime = null;
    this.pendingOutputTextBoundaries = [];
    this.cancelScheduledDelimiters();
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
    this.outputTimelineAnchorTime = null;
    this.pendingOutputTextBoundaries = [];
  }
}

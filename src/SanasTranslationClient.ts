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
  UtteranceDisplay,
} from "./types";

type UtteranceCallback = (utterance: UtteranceDisplay, index: number) => void;
type LanguagesCallback = (languages: IdentifiedLanguageDisplay[]) => void;
type ConnectionStateCallback = (state: ConnectionState) => void;
type ErrorCallback = (error: string) => void;

function webrtcToConnectionState(
  state: RTCPeerConnectionState,
): ConnectionState {
  switch (state) {
    case "new":
    case "connecting":
      return "connecting";
    case "connected":
      return "connected";
    case "disconnected":
    case "closed":
    case "failed":
      return "disconnected";
  }
}

let resetIdCounter = 0;

const DEFAULT_INPUT_SAMPLE_RATE = 16000;
const DEFAULT_OUTPUT_SAMPLE_RATE = 16000;

export class SanasTranslationClient {
  private options: SanasTranslationClientOptions;
  private translationState: TranslationState;

  private peerConnection: RTCPeerConnection | null = null;
  private dataChannel: RTCDataChannel | null = null;
  private localStream: MediaStream | null = null;
  private audioTrack: MediaStreamTrack | null = null;
  private ownsAudioTrack = false;
  private messageQueue: string[] = [];
  private _sessionId: string | null = null;
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
    });
  }

  // --- Public getters ---

  get connectionState(): ConnectionState {
    return this._connectionState;
  }

  get sessionId(): string | null {
    return this._sessionId;
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
    if (this.audioTrack) {
      this.audioTrack.enabled = enabled;
    }
  }

  // --- Lifecycle ---

  async connect(options?: ConnectOptions): Promise<ConnectResult> {
    if (this.peerConnection) {
      throw new Error("Already connected. Call disconnect() first.");
    }

    this._error = null;
    this.setConnectionState("connecting");

    // Acquire audio track
    if (options?.audioTrack) {
      this.audioTrack = options.audioTrack;
      this.localStream = new MediaStream([options.audioTrack]);
      this.ownsAudioTrack = false;
    } else {
      try {
        this.localStream = await navigator.mediaDevices.getUserMedia({
          video: false,
          audio: options?.audioConstraints ?? {
            echoCancellation: true,
            noiseSuppression: false,
            sampleRate: options?.inputSampleRate ?? DEFAULT_INPUT_SAMPLE_RATE,
            autoGainControl: true,
          },
        });
        this.audioTrack = this.localStream.getAudioTracks()[0] ?? null;
        this.ownsAudioTrack = true;
      } catch {
        this.setConnectionState("disconnected");
        throw new Error(
          "Could not access microphone. Please check permissions.",
        );
      }
    }

    if (this.audioTrack) {
      this.audioTrack.enabled = this._isAudioEnabled;
    }

    // Create AudioContext during user gesture so it starts in "running" state
    // (Chrome suspends contexts created outside a gesture).
    // The AudioContext is used as a synchronized clock for scheduling speech
    // delimiters — audio playback still goes through the raw WebRTC stream.
    const ctx = new AudioContext();
    this.audioContext = ctx;
    await ctx.resume();

    // Create RTCPeerConnection
    const peer = new RTCPeerConnection();
    this.peerConnection = peer;

    // Create data channel
    const dc = peer.createDataChannel("messaging");
    this.dataChannel = dc;

    dc.onopen = () => {
      for (const msg of this.messageQueue) {
        dc.send(msg);
      }
      this.messageQueue = [];
    };

    dc.onclose = () => {
      // Data channel closed
    };

    dc.onerror = (event) => {
      console.error("Data channel error:", event);
    };

    dc.onmessage = (event: MessageEvent) => {
      try {
        const message = LTMessage.parse(JSON.parse(event.data));
        if (message.type === "speech_delimiter") {
          this.scheduleSpeechDelimiter(message);
        } else {
          this.translationState.handleMessage(message);
        }
      } catch (e) {
        console.error("Failed to parse message from data channel:", e);
      }
    };

    // Add local audio tracks
    if (this.localStream) {
      for (const track of this.localStream.getTracks()) {
        if (track.kind === "audio") {
          peer.addTrack(track, this.localStream);
        }
      }
    }

    // Wait for translated audio track and WebRTC connection
    return new Promise<ConnectResult>((resolve, reject) => {
      let translatedAudio: MediaStream | null = null;
      let connectFailed = false;

      const tryResolve = () => {
        if (translatedAudio && !connectFailed) {
          // Feed remote audio into the AudioContext through a silent gain so
          // its clock stays in sync with the stream, but actual playback goes
          // through the raw WebRTC stream set on an <audio> element by the caller.
          const source = ctx.createMediaStreamSource(translatedAudio);
          const silentGain = ctx.createGain();
          silentGain.gain.value = 0;
          source.connect(silentGain);
          silentGain.connect(ctx.destination);
          resolve({ audio: translatedAudio });
        }
      };

      // Listen for translated audio track from server
      peer.ontrack = (e) => {
        translatedAudio = e.streams[0];
        tryResolve();
      };

      // Connection state tracking
      peer.onconnectionstatechange = () => {
        this.setConnectionState(webrtcToConnectionState(peer.connectionState));

        if (peer.connectionState === "failed") {
          this.setError("Disconnected from server.");
          if (!connectFailed) {
            connectFailed = true;
            reject(new Error(this._error!));
          }
        }

        if (peer.connectionState === "closed") {
          peer.close();
          this.peerConnection = null;
        }
      };

      // Negotiate with server
      peer.onnegotiationneeded = () => {
        this.connectToServer(peer, options).catch((err) => {
          if (!connectFailed) {
            connectFailed = true;
            reject(err);
          }
        });
      };
    });
  }

  disconnect(): void {
    // Reject any pending resets
    for (const [, pending] of this.pendingResets) {
      pending.reject(new Error("Disconnected"));
    }
    this.pendingResets.clear();

    this._sessionId = null;

    if (this.peerConnection) {
      this.peerConnection.close();
      this.peerConnection = null;
    }

    // Only stop tracks if we captured them
    if (this.ownsAudioTrack && this.localStream) {
      for (const track of this.localStream.getTracks()) {
        track.stop();
      }
    }

    this.localStream = null;
    this.audioTrack = null;
    this.ownsAudioTrack = false;
    this.dataChannel = null;
    this.messageQueue = [];
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
    const id = `reset-${++resetIdCounter}`;

    const message = {
      type: "reset" as const,
      reset: {
        id,
        lang_in: options.langIn,
        lang_out: options.langOut,
        voice_id: options.voiceId,
        glossary: options.glossary,
        clear_history: options.clearHistory,
        can_lang_swap: options.canLangSwap,
        detect_languages: options.detectLanguages,
      },
    };

    this.sendMessage(message);

    return new Promise<void>((resolve, reject) => {
      this.pendingResets.set(id, { resolve, reject });
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

  private sendMessage(message: LTMessage): void {
    const serialized = JSON.stringify(message);
    if (this.dataChannel && this.dataChannel.readyState === "open") {
      this.dataChannel.send(serialized);
    } else {
      this.messageQueue.push(serialized);
    }
  }

  private async connectToServer(
    peer: RTCPeerConnection,
    options?: ConnectOptions,
  ): Promise<void> {
    const offer = await peer.createOffer({
      offerToReceiveAudio: true,
      offerToReceiveVideo: false,
    });
    await peer.setLocalDescription(offer);

    const headers: Record<string, string> = {
      "Content-Type": "application/json",
    };

    if (this.options.accessToken) {
      headers["Authorization"] = `Bearer ${this.options.accessToken}`;
    } else if (this.options.apiKey) {
      headers["X-API-Key"] = this.options.apiKey;
    } else {
      throw new Error("Missing credentials: provide apiKey or accessToken.");
    }

    const payload = {
      ...offer,
      conversation_id: options?.conversationId ?? null,
      name: options?.userName ?? null,
      input_sample_rate: options?.inputSampleRate ?? DEFAULT_INPUT_SAMPLE_RATE,
      output_sample_rate:
        options?.outputSampleRate ?? DEFAULT_OUTPUT_SAMPLE_RATE,
    };

    const response = await fetch(`${this.options.endpoint}/session`, {
      method: "POST",
      body: JSON.stringify(payload),
      headers,
    });

    if (!response.ok) {
      const errorText = await response.text();
      console.error("LT session request failed:", response.status, errorText);

      if (response.status === 401) {
        this.setError("Authentication failed. Please sign in again.");
      } else if (response.status === 403) {
        this.setError(
          "Access denied. You don't have permission to use translation services.",
        );
      } else {
        this.setError(
          "Unable to connect to translation server. Please try again later.",
        );
      }

      throw new Error(this._error!);
    }

    const answer = await response.json();
    this._sessionId =
      typeof answer.session_id === "string" ? answer.session_id : null;
    await peer.setRemoteDescription(answer);
  }

  private scheduleSpeechDelimiter(message: LTMessage): void {
    if (!this.audioContext) {
      // No audio context — apply immediately
      this.translationState.handleMessage(message);
      return;
    }

    if (message.type !== "speech_delimiter") return;

    const ctx = this.audioContext;
    const scheduledTime =
      this.audioStreamStartTime + message.speech_delimiter.time;

    // Create a 1-sample silent buffer source to schedule the callback
    const buffer = ctx.createBuffer(1, 1, ctx.sampleRate);
    const source = ctx.createBufferSource();
    source.buffer = buffer;
    source.connect(ctx.destination);

    source.onended = () => {
      // Remove from tracking array
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

import { float32ToInt16 } from "./audio";
import {
  ConnectOptions,
  ConnectResult,
  ResetOptions,
  SanasTranslationClientOptions,
  StreamV3ClientMessage,
  StreamV3ServerMessage,
  Transport,
  TransportCallbacks,
} from "./types";

const DEFAULT_INPUT_SAMPLE_RATE = 16000;
const DEFAULT_OUTPUT_SAMPLE_RATE = 16000;

const PCM_PROCESSOR_CODE = `
class PcmProcessor extends AudioWorkletProcessor {
  process(inputs) {
    const input = inputs[0][0];
    if (input) {
      this.port.postMessage(input);
    }
    return true;
  }
}
registerProcessor('pcm-processor', PcmProcessor);
`;

function int16ToFloat32(int16: Int16Array): Float32Array {
  const float32 = new Float32Array(int16.length);
  for (let i = 0; i < int16.length; i++) {
    float32[i] = int16[i] / (int16[i] < 0 ? 0x8000 : 0x7fff);
  }
  return float32;
}

function createRequestId(prefix: string): string {
  if (globalThis.crypto?.randomUUID) {
    return globalThis.crypto.randomUUID();
  }
  return `${prefix}-${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

export class WebSocketTransport implements Transport {
  private ws: WebSocket | null = null;
  private audioContext: AudioContext | null = null;
  private workletNode: AudioWorkletNode | null = null;
  private localStream: MediaStream | null = null;
  private audioTrack: MediaStreamTrack | null = null;
  private sourceNode: MediaStreamAudioSourceNode | null = null;
  private destinationNode: MediaStreamAudioDestinationNode | null = null;
  private _sessionId: string | null = null;
  private callbacks: TransportCallbacks | null = null;
  private _isAudioEnabled = true;
  private inputSampleRate: number = DEFAULT_INPUT_SAMPLE_RATE;
  private outputSampleRate: number = DEFAULT_OUTPUT_SAMPLE_RATE;
  private conversationId: string | null = null;

  private nextPlaybackTime = 0;

  get sessionId(): string | null {
    return this._sessionId;
  }

  async connect(
    options: ConnectOptions,
    clientOptions: SanasTranslationClientOptions,
    callbacks: TransportCallbacks,
  ): Promise<ConnectResult> {
    this.callbacks = callbacks;
    this.inputSampleRate = options.inputSampleRate ?? DEFAULT_INPUT_SAMPLE_RATE;
    this.outputSampleRate =
      options.outputSampleRate ?? DEFAULT_OUTPUT_SAMPLE_RATE;
    this.conversationId =
      options.conversationId ?? createRequestId("conversation");

    this.audioTrack = options.audioTrack;
    this.localStream = new MediaStream([options.audioTrack]);

    // Set up AudioContext
    const ctx = new AudioContext({ sampleRate: this.inputSampleRate });
    this.audioContext = ctx;
    await ctx.resume();

    // Create destination for output audio playback
    this.destinationNode = ctx.createMediaStreamDestination();
    this.nextPlaybackTime = 0;

    // Set up AudioWorklet for mic capture
    const blob = new Blob([PCM_PROCESSOR_CODE], {
      type: "application/javascript",
    });
    const workletUrl = URL.createObjectURL(blob);
    await ctx.audioWorklet.addModule(workletUrl);
    URL.revokeObjectURL(workletUrl);

    const workletNode = new AudioWorkletNode(ctx, "pcm-processor");
    this.workletNode = workletNode;

    workletNode.port.onmessage = (event: MessageEvent) => {
      if (!this._isAudioEnabled || !this.ws) return;
      if (this.ws.readyState !== WebSocket.OPEN) return;

      const float32: Float32Array = event.data;
      const int16 = float32ToInt16(float32);
      this.ws.send(int16.buffer as ArrayBuffer);
    };

    // Connect mic → worklet
    if (this.localStream) {
      this.sourceNode = ctx.createMediaStreamSource(this.localStream);
      this.sourceNode.connect(workletNode);
      workletNode.connect(ctx.destination);
    }

    // Open WebSocket
    const wsUrl = this.buildWsUrl(clientOptions);
    const ws = new WebSocket(wsUrl);
    ws.binaryType = "arraybuffer";
    this.ws = ws;

    return new Promise<ConnectResult>((resolve, reject) => {
      ws.onopen = () => {
        this.sendInit(options);
        callbacks.onConnectionStateChange("connected");
        resolve({ audio: this.destinationNode!.stream });
      };

      ws.onerror = () => {
        callbacks.onError(
          "Unable to connect to translation server. Please try again later.",
        );
        reject(
          new Error(
            "Unable to connect to translation server. Please try again later.",
          ),
        );
      };

      ws.onclose = (event) => {
        if (event.code === 1008) {
          callbacks.onError("Authentication failed. Please sign in again.");
        }
        callbacks.onConnectionStateChange("disconnected");
      };

      ws.onmessage = (event: MessageEvent) => {
        if (typeof event.data === "string") {
          try {
            const message = StreamV3ServerMessage.parse(JSON.parse(event.data));
            this.handleServerMessage(message);
          } catch (e) {
            console.error("Failed to parse WebSocket message:", e);
          }
          return;
        }
        void this.handleAudioFrame(event.data);
      };
    });
  }

  configure(options: ResetOptions): string | null {
    if (!this.ws || this.ws.readyState !== WebSocket.OPEN) return null;

    const requestId = options.requestId ?? createRequestId("configure");
    const config: StreamV3ClientMessage = {
      type: "configure",
      language_routes: options.languageRoutes.map((route) => ({
        lang_in: route.langIn,
        lang_out: route.langOut,
      })),
      features: options.features,
      voice_id: options.voiceId,
      glossary: options.glossary ?? undefined,
      request_id: requestId,
    };

    this.ws.send(JSON.stringify(config));
    return requestId;
  }

  flush(): string | null {
    if (!this.ws || this.ws.readyState !== WebSocket.OPEN) return null;

    const requestId = createRequestId("flush");
    this.ws.send(JSON.stringify({ type: "flush", request_id: requestId }));
    return requestId;
  }

  disconnect(): void {
    if (this.ws) {
      if (this.ws.readyState === WebSocket.OPEN) {
        this.ws.send(JSON.stringify({ type: "stop" }));
        this.ws.close();
      }
      this.ws = null;
    }

    if (this.workletNode) {
      this.workletNode.port.onmessage = null;
      this.workletNode.disconnect();
      this.workletNode = null;
    }

    if (this.sourceNode) {
      this.sourceNode.disconnect();
      this.sourceNode = null;
    }

    this.localStream = null;
    this.audioTrack = null;
    this.destinationNode = null;

    if (this.audioContext) {
      this.audioContext.close();
      this.audioContext = null;
    }

    this._sessionId = null;
    this.callbacks = null;
    this.conversationId = null;
    this.nextPlaybackTime = 0;
  }

  drainAudio(): Promise<void> {
    const ctx = this.audioContext;
    if (!ctx || ctx.state === "closed") return Promise.resolve();

    const remaining = this.nextPlaybackTime - ctx.currentTime;
    if (remaining <= 0) return Promise.resolve();

    return new Promise((resolve) => {
      setTimeout(resolve, remaining * 1000);
    });
  }

  setAudioEnabled(enabled: boolean): void {
    this._isAudioEnabled = enabled;
    if (this.audioTrack) {
      this.audioTrack.enabled = enabled;
    }
  }

  private buildWsUrl(clientOptions: SanasTranslationClientOptions): string {
    const httpUrl = clientOptions.endpoint.replace(/\/$/, "");
    const wsBase = httpUrl
      .replace(/^https:\/\//, "wss://")
      .replace(/^http:\/\//, "ws://");

    const url = new URL(`${wsBase}/v3/stream`);

    if (clientOptions.accessToken) {
      url.searchParams.set("token", clientOptions.accessToken);
    } else if (clientOptions.apiKey) {
      url.searchParams.set("api_key", clientOptions.apiKey);
    }

    return url.toString();
  }

  private sendInit(options: ConnectOptions): void {
    if (
      !this.ws ||
      this.ws.readyState !== WebSocket.OPEN ||
      !this.conversationId
    ) {
      return;
    }

    const init: StreamV3ClientMessage = {
      type: "init",
      conversation_id: this.conversationId,
      session_name: options.sessionName ?? "",
      input_sample_rate: this.inputSampleRate,
      output_sample_rate: this.outputSampleRate,
      realtime_playback: options.realtimePlayback ?? false,
    };
    this.ws.send(JSON.stringify(init));
  }

  private handleServerMessage(message: StreamV3ServerMessage): void {
    switch (message.type) {
      case "configured":
        this.nextPlaybackTime = this.audioContext?.currentTime ?? 0;
        this.callbacks?.onMessage({
          type: "configured",
          request_id: message.request_id,
        });
        break;

      case "error":
        this.callbacks?.onError(message.message);
        this.callbacks?.onMessage(message);
        break;

      default:
        this.callbacks?.onMessage(message);
        break;
    }
  }

  private async handleAudioFrame(data: unknown): Promise<void> {
    if (Object.prototype.toString.call(data) === "[object ArrayBuffer]") {
      this.playAudioChunk(data as ArrayBuffer);
      return;
    }
    if (ArrayBuffer.isView(data)) {
      this.playAudioChunk(data.buffer as ArrayBuffer);
      return;
    }
    if (data instanceof Blob) {
      this.playAudioChunk(await data.arrayBuffer());
    }
  }

  private playAudioChunk(arrayBuffer: ArrayBuffer): void {
    if (!this.audioContext || !this.destinationNode) return;

    const ctx = this.audioContext;
    const int16 = new Int16Array(arrayBuffer);
    this.callbacks?.onAudioData?.(int16, this.outputSampleRate);
    const float32 = int16ToFloat32(int16);

    const audioBuffer = ctx.createBuffer(
      1,
      float32.length,
      this.outputSampleRate,
    );
    audioBuffer.getChannelData(0).set(float32);

    const source = ctx.createBufferSource();
    source.buffer = audioBuffer;
    source.connect(this.destinationNode);

    const now = ctx.currentTime;
    const startTime = Math.max(now, this.nextPlaybackTime);
    source.start(startTime);
    this.nextPlaybackTime = startTime + audioBuffer.duration;
  }
}

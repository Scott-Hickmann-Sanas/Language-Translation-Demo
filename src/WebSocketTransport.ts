import {
  ConnectOptions,
  ConnectResult,
  ResetOptions,
  SanasTranslationClientOptions,
  Transport,
  TransportCallbacks,
  WSMessage,
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

function float32ToInt16(float32: Float32Array): Int16Array {
  const int16 = new Int16Array(float32.length);
  for (let i = 0; i < float32.length; i++) {
    const clamped = Math.max(-1, Math.min(1, float32[i]));
    int16[i] = clamped < 0 ? clamped * 0x8000 : clamped * 0x7fff;
  }
  return int16;
}

function int16ToFloat32(int16: Int16Array): Float32Array {
  const float32 = new Float32Array(int16.length);
  for (let i = 0; i < int16.length; i++) {
    float32[i] = int16[i] / (int16[i] < 0 ? 0x8000 : 0x7fff);
  }
  return float32;
}

function base64Encode(buffer: ArrayBuffer): string {
  const bytes = new Uint8Array(buffer);
  let binary = "";
  for (let i = 0; i < bytes.length; i++) {
    binary += String.fromCharCode(bytes[i]);
  }
  return btoa(binary);
}

function base64Decode(base64: string): ArrayBuffer {
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) {
    bytes[i] = binary.charCodeAt(i);
  }
  return bytes.buffer;
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
      const base64 = base64Encode(int16.buffer as ArrayBuffer);
      this.ws.send(JSON.stringify({ type: "audio", data: base64 }));
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
    this.ws = ws;

    return new Promise<ConnectResult>((resolve, reject) => {
      ws.onopen = () => {
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
        try {
          const message = WSMessage.parse(JSON.parse(event.data));
          this.handleServerMessage(message);
        } catch (e) {
          console.error("Failed to parse WebSocket message:", e);
        }
      };
    });
  }

  configure(options: ResetOptions): null {
    if (!this.ws || this.ws.readyState !== WebSocket.OPEN) return null;

    const config = {
      type: "config",
      lang_in: options.langIn,
      lang_out: options.langOut,
      input_sample_rate: this.inputSampleRate,
      output_sample_rate: this.outputSampleRate,
      glossary: options.glossary ?? null,
      can_lang_swap: options.canLangSwap ?? false,
    };

    this.ws.send(JSON.stringify(config));
    return null;
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
    this.nextPlaybackTime = 0;
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

    const url = new URL(`${wsBase}/v2/consecutive`);

    if (clientOptions.accessToken) {
      url.searchParams.set("token", clientOptions.accessToken);
    } else if (clientOptions.apiKey) {
      url.searchParams.set("api_key", clientOptions.apiKey);
    }

    return url.toString();
  }

  private handleServerMessage(message: WSMessage): void {
    switch (message.type) {
      case "ready":
        this._sessionId = message.session_id ?? null;
        this.nextPlaybackTime = this.audioContext?.currentTime ?? 0;
        this.callbacks?.onMessage({
          type: "ready",
          ready: { id: null },
        });
        break;

      case "transcription":
        this.callbacks?.onMessage({
          type: "transcription",
          transcription: {
            complete: message.complete,
            partial: message.partial,
            utterance_idx: 0,
          },
        });
        break;

      case "translation":
        this.callbacks?.onMessage({
          type: "translation",
          translation: {
            complete: message.complete,
            partial: message.partial,
            utterance_idx: 0,
          },
        });
        break;

      case "speech_delimiter":
        this.callbacks?.onMessage({
          type: "speech_delimiter",
          speech_delimiter: {
            time: message.time,
            transcription: message.transcription,
            translation: message.translation,
          },
        });
        break;

      case "languages":
        this.callbacks?.onMessage({
          type: "speech_languages",
          speech_languages: {
            lang_in: message.lang_in,
            lang_out: message.lang_out,
          },
        });
        break;

      case "audio":
        this.playAudioChunk(message.data);
        break;

      case "speech_stop":
        this.callbacks?.onMessage({
          type: "speech_stop",
          speech_stop: {},
        });
        break;

      case "error":
        this.callbacks?.onError(message.message);
        break;
    }
  }

  private playAudioChunk(base64Data: string): void {
    if (!this.audioContext || !this.destinationNode) return;

    const ctx = this.audioContext;
    const arrayBuffer = base64Decode(base64Data);
    const int16 = new Int16Array(arrayBuffer);
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

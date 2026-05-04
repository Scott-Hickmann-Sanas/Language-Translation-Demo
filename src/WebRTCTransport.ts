import { float32ToInt16 } from "./audio";
import { generateConversationId } from "./generateId";
import {
  ConnectionState,
  ConnectOptions,
  ConnectResult,
  ResetOptions,
  SanasTranslationClientOptions,
  StreamV3ClientMessage,
  StreamV3ServerMessage,
  Transport,
  TransportCallbacks,
} from "./types";

function webrtcToConnectionState(
  // eslint-disable-next-line no-undef
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

const DEFAULT_INPUT_SAMPLE_RATE = 16000;
const DEFAULT_OUTPUT_SAMPLE_RATE = 16000;

function createRequestId(prefix: string): string {
  if (globalThis.crypto?.randomUUID) {
    return globalThis.crypto.randomUUID();
  }
  return `${prefix}-${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

type WebRtcSignalMessage =
  | {
      type: "answer";
      sdp: string;
      session_id?: string;
    }
  | {
      type: "candidate";
      candidate: RTCIceCandidateInit;
    }
  | {
      type: "end-of-candidates";
    }
  | {
      type: "error";
      message: string;
    };

export class WebRTCTransport implements Transport {
  private peerConnection: RTCPeerConnection | null = null;
  private dataChannel: RTCDataChannel | null = null;
  private localStream: MediaStream | null = null;
  private audioTrack: MediaStreamTrack | null = null;
  private messageQueue: string[] = [];
  private callbacks: TransportCallbacks | null = null;
  private connectOptions: ConnectOptions | null = null;
  private captureContext: AudioContext | null = null;
  private captureProcessor: ScriptProcessorNode | null = null;
  private conversationId: string | null = null;
  private signalingSocket: WebSocket | null = null;
  private negotiationStarted = false;

  get sessionId(): string | null {
    if (this.conversationId === null) return null;
    const sessionName = this.connectOptions?.sessionName;
    return sessionName
      ? `${this.conversationId}-${sessionName}`
      : this.conversationId;
  }

  async connect(
    options: ConnectOptions,
    clientOptions: SanasTranslationClientOptions,
    callbacks: TransportCallbacks,
  ): Promise<ConnectResult> {
    this.callbacks = callbacks;
    this.connectOptions = options;
    this.conversationId = options.conversationId ?? generateConversationId();

    this.audioTrack = options.audioTrack;
    this.localStream = new MediaStream([options.audioTrack]);

    // Create RTCPeerConnection
    const peer = new RTCPeerConnection({ bundlePolicy: "max-bundle" });
    this.peerConnection = peer;

    // Create data channel
    const dc = peer.createDataChannel("messaging");
    this.dataChannel = dc;

    dc.onopen = () => {
      this.sendInit();
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
        const message = StreamV3ServerMessage.parse(JSON.parse(event.data));
        callbacks.onMessage(message);
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
          resolve({ audio: translatedAudio });
        }
      };

      peer.ontrack = (e) => {
        translatedAudio = e.streams[0];

        if (callbacks.onAudioData) {
          const outputSR =
            options.outputSampleRate ?? DEFAULT_OUTPUT_SAMPLE_RATE;
          const capCtx = new AudioContext({ sampleRate: outputSR });
          this.captureContext = capCtx;
          const src = capCtx.createMediaStreamSource(translatedAudio);
          const proc = capCtx.createScriptProcessor(4096, 1, 1);
          this.captureProcessor = proc;
          proc.onaudioprocess = (ev) => {
            const float32 = ev.inputBuffer.getChannelData(0);
            callbacks.onAudioData!(float32ToInt16(float32), outputSR);
          };
          src.connect(proc);
          proc.connect(capCtx.destination);
        }

        tryResolve();
      };

      peer.onconnectionstatechange = () => {
        callbacks.onConnectionStateChange(
          webrtcToConnectionState(peer.connectionState),
        );

        if (peer.connectionState === "failed") {
          callbacks.onError("Disconnected from server.");
          if (!connectFailed) {
            connectFailed = true;
            reject(new Error("Disconnected from server."));
          }
        }

        if (peer.connectionState === "closed") {
          peer.close();
          this.peerConnection = null;
        }
      };

      peer.onnegotiationneeded = () => {
        this.connectToServer(peer, clientOptions).catch((err) => {
          if (!connectFailed) {
            connectFailed = true;
            reject(err);
          }
        });
      };
    });
  }

  configure(options: ResetOptions): string {
    const id = options.requestId ?? createRequestId("configure");
    const message: StreamV3ClientMessage = {
      type: "configure",
      language_routes: options.languageRoutes.map((route) => ({
        lang_in: route.langIn,
        lang_out: route.langOut,
      })),
      features: options.features,
      voice_id: options.voiceId,
      glossary: options.glossary ?? undefined,
      request_id: id,
    };
    this.sendMessage(message);
    return id;
  }

  flush(): string {
    const id = createRequestId("flush");
    this.sendMessage({ type: "flush", request_id: id });
    return id;
  }

  disconnect(): void {
    this.negotiationStarted = false;

    if (this.signalingSocket) {
      this.signalingSocket.onclose = null;
      this.signalingSocket.onerror = null;
      this.signalingSocket.close();
      this.signalingSocket = null;
    }

    if (this.captureProcessor) {
      this.captureProcessor.disconnect();
      this.captureProcessor = null;
    }
    if (this.captureContext) {
      this.captureContext.close();
      this.captureContext = null;
    }

    if (this.peerConnection) {
      this.peerConnection.close();
      this.peerConnection = null;
    }

    this.localStream = null;
    this.audioTrack = null;
    this.dataChannel = null;
    this.messageQueue = [];
    this.callbacks = null;
    this.connectOptions = null;
    this.conversationId = null;
  }

  drainAudio(): Promise<void> {
    return Promise.resolve();
  }

  setAudioEnabled(enabled: boolean): void {
    if (this.audioTrack) {
      this.audioTrack.enabled = enabled;
    }
  }

  private sendInit(): void {
    const options = this.connectOptions;
    if (!options || this.conversationId === null) return;

    this.sendMessage({
      type: "init",
      conversation_id: this.conversationId,
      session_name: options.sessionName ?? "",
      input_sample_rate: options.inputSampleRate ?? DEFAULT_INPUT_SAMPLE_RATE,
      output_sample_rate:
        options.outputSampleRate ?? DEFAULT_OUTPUT_SAMPLE_RATE,
      realtime_playback: options.realtimePlayback ?? true,
    });
  }

  private sendMessage(message: StreamV3ClientMessage): void {
    const serialized = JSON.stringify(message);
    if (this.dataChannel && this.dataChannel.readyState === "open") {
      this.dataChannel.send(serialized);
    } else {
      this.messageQueue.push(serialized);
    }
  }

  private async connectToServer(
    peer: RTCPeerConnection,
    clientOptions: SanasTranslationClientOptions,
  ): Promise<void> {
    if (this.negotiationStarted) {
      return;
    }
    this.negotiationStarted = true;

    const ws = new WebSocket(this.buildWsUrl(clientOptions));
    this.signalingSocket = ws;

    return new Promise<void>((resolve, reject) => {
      let settled = false;

      const fail = (message: string, err?: unknown) => {
        this.callbacks?.onError(message);
        if (settled) return;
        settled = true;
        this.negotiationStarted = false;
        reject(err instanceof Error ? err : new Error(message));
      };

      peer.onicecandidate = (event) => {
        if (this.signalingSocket !== ws || ws.readyState !== WebSocket.OPEN) {
          return;
        }

        if (event.candidate) {
          ws.send(
            JSON.stringify({
              type: "candidate",
              candidate: event.candidate.toJSON(),
            }),
          );
        } else {
          ws.send(JSON.stringify({ type: "end-of-candidates" }));
        }
      };

      ws.onopen = () => {
        void (async () => {
          try {
            const offer = await peer.createOffer({
              offerToReceiveAudio: true,
              offerToReceiveVideo: false,
            });
            await peer.setLocalDescription(offer);
            ws.send(
              JSON.stringify({
                type: "offer",
                sdp: peer.localDescription?.sdp ?? offer.sdp,
              }),
            );
          } catch (e) {
            fail("Unable to create WebRTC offer.", e);
          }
        })();
      };

      ws.onmessage = (event) => {
        void (async () => {
          let message: WebRtcSignalMessage;
          try {
            message = JSON.parse(String(event.data)) as WebRtcSignalMessage;
          } catch (e) {
            fail("Invalid signaling message from server.", e);
            return;
          }

          try {
            switch (message.type) {
              case "answer":
                await peer.setRemoteDescription({
                  type: "answer",
                  sdp: message.sdp,
                });
                if (!settled) {
                  settled = true;
                  resolve();
                }
                break;
              case "candidate":
                await peer.addIceCandidate(message.candidate);
                break;
              case "end-of-candidates":
                await peer.addIceCandidate();
                break;
              case "error":
                fail(message.message);
                break;
            }
          } catch (e) {
            fail("Failed to handle WebRTC signaling message.", e);
          }
        })();
      };

      ws.onerror = (event) => {
        fail("Unable to connect to translation server.", event);
      };

      ws.onclose = () => {
        if (!settled) {
          fail("WebRTC signaling socket closed before negotiation completed.");
        }
      };
    });
  }

  private buildWsUrl(clientOptions: SanasTranslationClientOptions): string {
    const httpUrl = clientOptions.endpoint.replace(/\/$/, "");
    const wsBase = httpUrl
      .replace(/^https:\/\//, "wss://")
      .replace(/^http:\/\//, "ws://");

    const url = new URL(`${wsBase}/v3/webrtc`);

    if (clientOptions.accessToken) {
      url.searchParams.set("token", clientOptions.accessToken);
    } else if (clientOptions.apiKey) {
      url.searchParams.set("api_key", clientOptions.apiKey);
    } else {
      throw new Error("Missing credentials: provide apiKey or accessToken.");
    }

    return url.toString();
  }
}

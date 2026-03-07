import {
  ConnectionState,
  ConnectOptions,
  ConnectResult,
  LTMessage,
  ResetOptions,
  SanasTranslationClientOptions,
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

let resetIdCounter = 0;

const DEFAULT_INPUT_SAMPLE_RATE = 16000;
const DEFAULT_OUTPUT_SAMPLE_RATE = 16000;

export class WebRTCTransport implements Transport {
  private peerConnection: RTCPeerConnection | null = null;
  private dataChannel: RTCDataChannel | null = null;
  private localStream: MediaStream | null = null;
  private audioTrack: MediaStreamTrack | null = null;
  private messageQueue: string[] = [];
  private _sessionId: string | null = null;
  private callbacks: TransportCallbacks | null = null;
  private connectOptions: ConnectOptions | null = null;

  get sessionId(): string | null {
    return this._sessionId;
  }

  async connect(
    options: ConnectOptions,
    clientOptions: SanasTranslationClientOptions,
    callbacks: TransportCallbacks,
  ): Promise<ConnectResult> {
    this.callbacks = callbacks;
    this.connectOptions = options;

    this.audioTrack = options.audioTrack;
    this.localStream = new MediaStream([options.audioTrack]);

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
    return id;
  }

  disconnect(): void {
    this._sessionId = null;

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
  }

  setAudioEnabled(enabled: boolean): void {
    if (this.audioTrack) {
      this.audioTrack.enabled = enabled;
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
    clientOptions: SanasTranslationClientOptions,
  ): Promise<void> {
    const offer = await peer.createOffer({
      offerToReceiveAudio: true,
      offerToReceiveVideo: false,
    });
    await peer.setLocalDescription(offer);

    const headers: Record<string, string> = {
      "Content-Type": "application/json",
    };

    if (clientOptions.accessToken) {
      headers["Authorization"] = `Bearer ${clientOptions.accessToken}`;
    } else if (clientOptions.apiKey) {
      headers["X-API-Key"] = clientOptions.apiKey;
    } else {
      throw new Error("Missing credentials: provide apiKey or accessToken.");
    }

    const options = this.connectOptions;
    const payload = {
      ...offer,
      conversation_id: options?.conversationId ?? null,
      name: options?.userName ?? null,
      input_sample_rate: options?.inputSampleRate ?? DEFAULT_INPUT_SAMPLE_RATE,
      output_sample_rate:
        options?.outputSampleRate ?? DEFAULT_OUTPUT_SAMPLE_RATE,
    };

    const response = await fetch(`${clientOptions.endpoint}/session`, {
      method: "POST",
      body: JSON.stringify(payload),
      headers,
    });

    if (!response.ok) {
      const errorText = await response.text();
      console.error("LT session request failed:", response.status, errorText);

      let errorMsg: string;
      if (response.status === 401) {
        errorMsg = "Authentication failed. Please sign in again.";
      } else if (response.status === 403) {
        errorMsg =
          "Access denied. You don't have permission to use translation services.";
      } else {
        errorMsg =
          "Unable to connect to translation server. Please try again later.";
      }

      this.callbacks?.onError(errorMsg);
      throw new Error(errorMsg);
    }

    const answer = await response.json();
    this._sessionId =
      typeof answer.session_id === "string" ? answer.session_id : null;
    await peer.setRemoteDescription(answer);
  }
}

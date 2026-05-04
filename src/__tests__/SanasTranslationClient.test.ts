import { SanasTranslationClient } from "../SanasTranslationClient";
import { TranslationState } from "../TranslationState";
import {
  ConnectOptions,
  ConnectResult,
  ResetOptions,
  SanasTranslationClientOptions,
  StreamMessage,
  TranslationStateCallbacks,
  Transport,
  TransportCallbacks,
} from "../types";
import { WebRTCTransport } from "../WebRTCTransport";
import { WebSocketTransport } from "../WebSocketTransport";

class MockMediaStreamTrack {
  kind = "audio";
  enabled = true;
  stop = jest.fn();
}

class MockMediaStream {
  private tracks: MockMediaStreamTrack[];

  constructor(tracks: MockMediaStreamTrack[] = [new MockMediaStreamTrack()]) {
    this.tracks = tracks;
  }

  getTracks(): MockMediaStreamTrack[] {
    return this.tracks;
  }
}

class MockAudioBuffer {
  private channel = new Float32Array(4096);

  getChannelData(): Float32Array {
    return this.channel;
  }
}

class MockAudioBufferSourceNode {
  buffer: unknown = null;
  onended: (() => void) | null = null;
  startTime: number | undefined;
  connect = jest.fn();
  disconnect = jest.fn();
  start = jest.fn((when?: number) => {
    this.startTime = when;
  });
  stop = jest.fn();
}

class MockAudioContext {
  sampleRate = 48000;
  currentTime = 0;
  state = "running";
  destination = {};
  audioWorklet = { addModule: jest.fn(() => Promise.resolve()) };
  createBuffer = jest.fn(() => new MockAudioBuffer());
  createBufferSource = jest.fn(() => {
    const node = new MockAudioBufferSourceNode();
    createdBufferSourceNodes.push(node);
    return node;
  });
  createGain = jest.fn(() => ({
    gain: { value: 1 },
    connect: jest.fn(),
    disconnect: jest.fn(),
  }));
  createOscillator = jest.fn(() => ({
    connect: jest.fn(),
    disconnect: jest.fn(),
    start: jest.fn(),
    stop: jest.fn(),
  }));
  createMediaStreamSource = jest.fn(() => ({
    connect: jest.fn(),
    disconnect: jest.fn(),
  }));
  createMediaStreamDestination = jest.fn(() => ({
    stream: new MockMediaStream() as unknown as MediaStream,
  }));
  createScriptProcessor = jest.fn(() => ({
    onaudioprocess: null,
    connect: jest.fn(),
    disconnect: jest.fn(),
  }));
  resume = jest.fn(() => Promise.resolve());
  close = jest.fn(() => Promise.resolve());
}

class MockAudioWorkletNode {
  port: { onmessage: ((event: MessageEvent) => void) | null } = {
    onmessage: null,
  };
  connect = jest.fn();
  disconnect = jest.fn();

  constructor() {
    latestWorkletNode = this;
  }
}

class MockDataChannel {
  readyState: RTCDataChannelState = "connecting";
  sent: string[] = [];
  onopen: ((event: Event) => void) | null = null;
  onclose: ((event: Event) => void) | null = null;
  onerror: ((event: Event) => void) | null = null;
  onmessage: ((event: MessageEvent) => void) | null = null;

  send(data: string): void {
    this.sent.push(data);
  }
}

class MockPeerConnection {
  connectionState: RTCPeerConnectionState = "new";
  iceGatheringState: RTCIceGatheringState = "complete";
  localDescription: RTCSessionDescriptionInit | null = null;
  dataChannel = new MockDataChannel();
  ontrack: ((event: RTCTrackEvent) => void) | null = null;
  onconnectionstatechange: ((event: Event) => void) | null = null;
  onicecandidate: ((event: RTCPeerConnectionIceEvent) => void) | null = null;
  onicegatheringstatechange: ((event: Event) => void) | null = null;
  onnegotiationneeded: ((event: Event) => void) | null = null;
  createDataChannel = jest.fn(() => this.dataChannel);
  addTrack = jest.fn();
  createOffer = jest.fn(() =>
    Promise.resolve({ type: "offer" as RTCSdpType, sdp: "offer-sdp" }),
  );
  setLocalDescription = jest.fn((description: RTCSessionDescriptionInit) => {
    this.localDescription = description;
    return Promise.resolve();
  });
  setRemoteDescription = jest.fn(() => Promise.resolve());
  addIceCandidate = jest.fn(() => Promise.resolve());
  close = jest.fn();

  constructor() {
    latestPeerConnection = this;
  }
}

class MockWebSocket {
  static CONNECTING = 0;
  static OPEN = 1;
  static CLOSED = 3;

  readyState = MockWebSocket.CONNECTING;
  binaryType: BinaryType = "blob";
  sent: unknown[] = [];
  onopen: ((event: Event) => void) | null = null;
  onmessage: ((event: MessageEvent) => void) | null = null;
  onerror: ((event: Event) => void) | null = null;
  onclose: ((event: CloseEvent) => void) | null = null;

  constructor(public url: string) {
    latestWebSocket = this;
  }

  send(data: unknown): void {
    this.sent.push(data);
  }

  close(): void {
    this.readyState = MockWebSocket.CLOSED;
  }
}

class MockTransport implements Transport {
  callbacks: TransportCallbacks | null = null;
  sessionId: string | null = "sess-123";
  configureRequestId = "cfg-1";
  flushRequestId = "flush-1";

  connect = jest.fn(
    async (
      _options: ConnectOptions,
      _clientOptions: SanasTranslationClientOptions,
      callbacks: TransportCallbacks,
    ): Promise<ConnectResult> => {
      this.callbacks = callbacks;
      callbacks.onConnectionStateChange("connected");
      return { audio: new MockMediaStream() as unknown as MediaStream };
    },
  );

  configure = jest.fn((_options: ResetOptions): string | null => {
    return this.configureRequestId;
  });

  flush = jest.fn((): string | null => {
    return this.flushRequestId;
  });

  disconnect = jest.fn();
  drainAudio = jest.fn(() => Promise.resolve());
  setAudioEnabled = jest.fn();
}

let latestPeerConnection: MockPeerConnection | null = null;
let latestWebSocket: MockWebSocket | null = null;
let latestWorkletNode: MockAudioWorkletNode | null = null;
let createdBufferSourceNodes: MockAudioBufferSourceNode[] = [];

const mockFetch = jest.fn();
const mockAudioTrack =
  new MockMediaStreamTrack() as unknown as MediaStreamTrack;

function installBrowserMocks(): void {
  const globals = globalThis as unknown as Record<string, unknown>;
  globals.AudioContext = MockAudioContext;
  globals.MediaStream = MockMediaStream;
  globals.RTCPeerConnection = MockPeerConnection;
  globals.WebSocket = MockWebSocket;
  globals.AudioWorkletNode = MockAudioWorkletNode;
  globals.fetch = mockFetch;
  URL.createObjectURL = jest.fn(() => "blob:mock");
  URL.revokeObjectURL = jest.fn();
}

function makeCallbacks(
  overrides: Partial<TranslationStateCallbacks> = {},
): TranslationStateCallbacks {
  return {
    onUtterance: jest.fn(),
    onLanguages: jest.fn(),
    onConfigured: jest.fn(),
    onLanguageRoute: jest.fn(),
    onOutputSpeechEnded: jest.fn(),
    onTranslationEnded: jest.fn(),
    onFlushed: jest.fn(),
    onError: jest.fn(),
    onConnectionStateChange: jest.fn(),
    ...overrides,
  };
}

function createClient(
  overrides: Partial<{
    callbacks: TranslationStateCallbacks;
    onMessage: (message: StreamMessage) => void;
  }> = {},
): {
  client: SanasTranslationClient;
  callbacks: TranslationStateCallbacks;
  state: TranslationState;
} {
  const callbacks = overrides.callbacks ?? makeCallbacks();
  const state = new TranslationState(callbacks);
  const client = new SanasTranslationClient(state, {
    apiKey: "test-key",
    endpoint: "https://lt.test.com",
    onMessage: overrides.onMessage,
  });
  return { client, callbacks, state };
}

async function connectClient(
  client: SanasTranslationClient,
  transport = new MockTransport(),
): Promise<MockTransport> {
  await client.connect({ transport, audioTrack: mockAudioTrack });
  return transport;
}

async function tick(): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, 0));
}

describe("SanasTranslationClient", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    installBrowserMocks();
    latestPeerConnection = null;
    latestWebSocket = null;
    latestWorkletNode = null;
    createdBufferSourceNodes = [];
  });

  it("routes connection state and direct v3 messages", async () => {
    const onMessage = jest.fn();
    const { client, callbacks, state } = createClient({ onMessage });
    const transport = await connectClient(client);

    transport.callbacks?.onMessage({
      type: "transcription",
      utterance_idx: 0,
      complete: [{ word: "hello", start: 0, end: 1 }],
      partial: [],
    });

    expect(callbacks.onConnectionStateChange).toHaveBeenCalledWith(
      "connecting",
    );
    expect(callbacks.onConnectionStateChange).toHaveBeenCalledWith("connected");
    expect(onMessage).toHaveBeenCalledWith({
      type: "transcription",
      utterance_idx: 0,
      complete: [{ word: "hello", start: 0, end: 1 }],
      partial: [],
    });
    expect(state.getUtteranceDisplay(0).transcription.complete).toEqual([
      { word: "hello", start: 0, end: 1 },
    ]);
  });

  it("reset sends v3 configure options and waits for configured", async () => {
    const { client, callbacks } = createClient();
    const transport = await connectClient(client);
    const resetPromise = client.reset({
      languageRoutes: [{ langIn: "en-US", langOut: "es-ES" }],
      voiceId: "voice-1",
      glossary: [{ terms: { "*": "Sanas" } }],
      features: ["language_identification"],
    });

    expect(transport.configure).toHaveBeenCalledWith({
      languageRoutes: [{ langIn: "en-US", langOut: "es-ES" }],
      voiceId: "voice-1",
      glossary: [{ terms: { "*": "Sanas" } }],
      features: ["language_identification"],
    });

    transport.callbacks?.onMessage({
      type: "configured",
      request_id: "cfg-1",
    });

    await expect(resetPromise).resolves.toBeUndefined();
    expect(callbacks.onConfigured).toHaveBeenCalledWith("cfg-1");
  });

  it("suppresses utterance messages while reset is waiting for configured", async () => {
    const onMessage = jest.fn();
    const { client, callbacks, state } = createClient({ onMessage });
    const transport = await connectClient(client);

    transport.callbacks?.onMessage({
      type: "transcription",
      utterance_idx: 0,
      complete: [{ word: "before", start: 0, end: 1 }],
      partial: [],
    });
    expect(state.getState().utterances).toHaveLength(1);

    jest.clearAllMocks();

    const resetPromise = client.reset({
      languageRoutes: [{ langIn: "en-US", langOut: "es-ES" }],
    });

    transport.callbacks?.onMessage({
      type: "transcription",
      utterance_idx: 0,
      complete: [{ word: "stale", start: 1, end: 2 }],
      partial: [],
    });

    expect(onMessage).not.toHaveBeenCalled();
    expect(callbacks.onUtterance).not.toHaveBeenCalled();
    expect(state.getUtteranceDisplay(0).transcription.complete).toEqual([
      { word: "before", start: 0, end: 1 },
    ]);

    transport.callbacks?.onMessage({
      type: "configured",
      request_id: "cfg-1",
    });
    await expect(resetPromise).resolves.toBeUndefined();

    transport.callbacks?.onMessage({
      type: "transcription",
      utterance_idx: 1,
      complete: [{ word: "after", start: 2, end: 3 }],
      partial: [],
    });

    expect(state.getState().utterances).toHaveLength(2);
    expect(state.getUtteranceDisplay(1).transcription.complete).toEqual([
      { word: "after", start: 2, end: 3 },
    ]);
  });

  it("flush sends v3 flush and waits for flushed", async () => {
    const { client, callbacks } = createClient();
    const transport = await connectClient(client);
    const flushPromise = client.flush();

    expect(transport.flush).toHaveBeenCalledTimes(1);
    transport.callbacks?.onMessage({ type: "flushed", request_id: "flush-1" });

    await expect(flushPromise).resolves.toBeUndefined();
    expect(callbacks.onFlushed).toHaveBeenCalledWith("flush-1");
  });

  it("schedules output_text_boundary from the output_speech_started timeline", async () => {
    const { client, callbacks } = createClient();
    const transport = await connectClient(client);

    transport.callbacks?.onMessage({
      type: "transcription",
      utterance_idx: 0,
      complete: [{ word: "hello", start: 0, end: 1 }],
      partial: [],
    });

    expect(callbacks.onUtterance).toHaveBeenCalledTimes(1);

    transport.callbacks?.onMessage({
      type: "output_text_boundary",
      utterance_idx: 0,
      output_time: 1.25,
      transcription: { word_idx: 0, char_idx: 2 },
    });

    expect(callbacks.onUtterance).toHaveBeenCalledTimes(1);
    expect(createdBufferSourceNodes).toHaveLength(0);

    transport.callbacks?.onMessage({
      type: "output_speech_started",
      utterance_idx: 0,
      output_time: 1,
    });

    expect(createdBufferSourceNodes).toHaveLength(1);
    expect(createdBufferSourceNodes[0].start).toHaveBeenCalledWith(0.25);
    expect(callbacks.onUtterance).toHaveBeenCalledTimes(1);

    createdBufferSourceNodes[0].onended?.();

    expect(callbacks.onUtterance).toHaveBeenLastCalledWith(
      expect.objectContaining({
        transcription: expect.objectContaining({ spokenText: "he" }),
      }),
      0,
    );
  });
});

describe("WebRTCTransport", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    installBrowserMocks();
    latestPeerConnection = null;
    latestWebSocket = null;
  });

  it("uses websocket signaling and sends v3 data-channel messages", async () => {
    const callbacks: TransportCallbacks = {
      onMessage: jest.fn(),
      onError: jest.fn(),
      onConnectionStateChange: jest.fn(),
    };
    const transport = new WebRTCTransport();
    const connectPromise = transport.connect(
      {
        transport,
        audioTrack: mockAudioTrack,
        conversationId: "conversation-1",
        sessionName: "browser",
      },
      { apiKey: "api-key", endpoint: "https://lt.test.com/" },
      callbacks,
    );

    await tick();
    latestPeerConnection?.onnegotiationneeded?.(new Event("negotiationneeded"));
    await tick();

    const peer = latestPeerConnection!;
    const ws = latestWebSocket!;
    expect(ws.url).toBe("wss://lt.test.com/v3/webrtc?api_key=api-key");

    ws.readyState = MockWebSocket.OPEN;
    ws.onopen?.(new Event("open"));
    await tick();

    expect(JSON.parse(ws.sent[0] as string)).toEqual({
      type: "offer",
      sdp: "offer-sdp",
    });

    peer.onicecandidate?.({
      candidate: {
        toJSON: () => ({
          candidate: "candidate:1",
          sdpMid: "0",
          sdpMLineIndex: 0,
        }),
      },
    } as unknown as RTCPeerConnectionIceEvent);
    peer.onicecandidate?.({
      candidate: null,
    } as unknown as RTCPeerConnectionIceEvent);

    expect(JSON.parse(ws.sent[1] as string)).toEqual({
      type: "candidate",
      candidate: {
        candidate: "candidate:1",
        sdpMid: "0",
        sdpMLineIndex: 0,
      },
    });
    expect(JSON.parse(ws.sent[2] as string)).toEqual({
      type: "end-of-candidates",
    });

    ws.onmessage?.({
      data: JSON.stringify({
        type: "answer",
        sdp: "answer-sdp",
        session_id: "webrtc-session",
      }),
    } as MessageEvent);
    await tick();
    expect(peer.setRemoteDescription).toHaveBeenCalledWith({
      type: "answer",
      sdp: "answer-sdp",
    });
    expect(transport.sessionId).toBe("webrtc-session");

    ws.onmessage?.({
      data: JSON.stringify({
        type: "candidate",
        candidate: {
          candidate: "candidate:server",
          sdpMid: "0",
          sdpMLineIndex: 0,
        },
      }),
    } as MessageEvent);
    await tick();
    expect(peer.addIceCandidate).toHaveBeenCalledWith({
      candidate: "candidate:server",
      sdpMid: "0",
      sdpMLineIndex: 0,
    });

    peer.dataChannel.readyState = "open";
    peer.dataChannel.onopen?.(new Event("open"));
    peer.ontrack?.({
      streams: [new MockMediaStream() as unknown as MediaStream],
    } as unknown as RTCTrackEvent);

    await expect(connectPromise).resolves.toEqual({
      audio: expect.any(MockMediaStream),
    });

    expect(JSON.parse(peer.dataChannel.sent[0])).toEqual({
      type: "init",
      conversation_id: "conversation-1",
      session_name: "browser",
      input_sample_rate: 16000,
      output_sample_rate: 16000,
      realtime_playback: true,
    });

    expect(
      transport.configure({
        requestId: "cfg-1",
        languageRoutes: [{ langIn: "en-US", langOut: "es-ES" }],
        glossary: [{ terms: { "*": "Sanas" } }],
        features: ["language_identification"],
      }),
    ).toBe("cfg-1");
    expect(JSON.parse(peer.dataChannel.sent[1])).toEqual({
      type: "configure",
      request_id: "cfg-1",
      language_routes: [{ lang_in: "en-US", lang_out: "es-ES" }],
      glossary: [{ terms: { "*": "Sanas" } }],
      features: ["language_identification"],
    });

    peer.dataChannel.onmessage?.({
      data: JSON.stringify({ type: "configured", request_id: "cfg-1" }),
    } as MessageEvent);
    expect(callbacks.onMessage).toHaveBeenCalledWith({
      type: "configured",
      request_id: "cfg-1",
    });
  });

  it("sends an empty conversation id without generating one", async () => {
    const callbacks: TransportCallbacks = {
      onMessage: jest.fn(),
      onError: jest.fn(),
      onConnectionStateChange: jest.fn(),
    };
    const transport = new WebRTCTransport();
    const connectPromise = transport.connect(
      {
        transport,
        audioTrack: mockAudioTrack,
        conversationId: "",
      },
      { apiKey: "api-key", endpoint: "https://lt.test.com/" },
      callbacks,
    );

    await tick();
    latestPeerConnection?.onnegotiationneeded?.(new Event("negotiationneeded"));
    await tick();

    const peer = latestPeerConnection!;
    const ws = latestWebSocket!;
    ws.readyState = MockWebSocket.OPEN;
    ws.onopen?.(new Event("open"));
    await tick();

    peer.dataChannel.readyState = "open";
    peer.dataChannel.onopen?.(new Event("open"));
    peer.ontrack?.({
      streams: [new MockMediaStream() as unknown as MediaStream],
    } as unknown as RTCTrackEvent);

    await expect(connectPromise).resolves.toEqual({
      audio: expect.any(MockMediaStream),
    });
    expect(JSON.parse(peer.dataChannel.sent[0])).toEqual({
      type: "init",
      conversation_id: "",
      session_name: "",
      input_sample_rate: 16000,
      output_sample_rate: 16000,
      realtime_playback: true,
    });
  });
});

describe("WebSocketTransport", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    installBrowserMocks();
    latestWebSocket = null;
    latestWorkletNode = null;
  });

  it("uses /v3/stream init/configure/flush and binary audio frames", async () => {
    const callbacks: TransportCallbacks = {
      onMessage: jest.fn(),
      onError: jest.fn(),
      onConnectionStateChange: jest.fn(),
      onAudioData: jest.fn(),
    };
    const transport = new WebSocketTransport();
    const connectPromise = transport.connect(
      {
        transport,
        audioTrack: mockAudioTrack,
        conversationId: "conversation-1",
        sessionName: "browser",
      },
      { apiKey: "api-key", endpoint: "https://lt.test.com" },
      callbacks,
    );

    await tick();
    const ws = latestWebSocket!;
    ws.readyState = MockWebSocket.OPEN;
    ws.onopen?.(new Event("open"));

    await expect(connectPromise).resolves.toEqual({
      audio: expect.any(MockMediaStream),
    });
    expect(ws.url).toBe("wss://lt.test.com/v3/stream?api_key=api-key");
    expect(JSON.parse(ws.sent[0] as string)).toEqual({
      type: "init",
      conversation_id: "conversation-1",
      session_name: "browser",
      input_sample_rate: 16000,
      output_sample_rate: 16000,
      realtime_playback: false,
    });

    expect(
      transport.configure({
        requestId: "cfg-1",
        languageRoutes: [{ langIn: "en-US", langOut: "es-ES" }],
      }),
    ).toBe("cfg-1");
    expect(JSON.parse(ws.sent[1] as string)).toEqual({
      type: "configure",
      request_id: "cfg-1",
      language_routes: [{ lang_in: "en-US", lang_out: "es-ES" }],
    });

    expect(transport.flush()).toEqual(expect.any(String));
    expect(JSON.parse(ws.sent[2] as string).type).toBe("flush");

    latestWorkletNode?.port.onmessage?.({
      data: new Float32Array([1, -1]),
    } as MessageEvent);
    expect(Object.prototype.toString.call(ws.sent[3])).toBe(
      "[object ArrayBuffer]",
    );

    ws.onmessage?.({
      data: JSON.stringify({ type: "configured", request_id: "cfg-1" }),
    } as MessageEvent);
    expect(callbacks.onMessage).toHaveBeenCalledWith({
      type: "configured",
      request_id: "cfg-1",
    });

    ws.onmessage?.({ data: new Int16Array([1, 2]).buffer } as MessageEvent);
    expect(callbacks.onAudioData).toHaveBeenCalledWith(
      new Int16Array([1, 2]),
      16000,
    );
  });

  it("sends an empty conversation id without generating one", async () => {
    const callbacks: TransportCallbacks = {
      onMessage: jest.fn(),
      onError: jest.fn(),
      onConnectionStateChange: jest.fn(),
    };
    const transport = new WebSocketTransport();
    const connectPromise = transport.connect(
      {
        transport,
        audioTrack: mockAudioTrack,
        conversationId: "",
      },
      { apiKey: "api-key", endpoint: "https://lt.test.com" },
      callbacks,
    );

    await tick();
    const ws = latestWebSocket!;
    ws.readyState = MockWebSocket.OPEN;
    ws.onopen?.(new Event("open"));

    await expect(connectPromise).resolves.toEqual({
      audio: expect.any(MockMediaStream),
    });
    expect(JSON.parse(ws.sent[0] as string)).toEqual({
      type: "init",
      conversation_id: "",
      session_name: "",
      input_sample_rate: 16000,
      output_sample_rate: 16000,
      realtime_playback: false,
    });
  });
});

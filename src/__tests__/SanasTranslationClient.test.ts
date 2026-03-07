import { SanasTranslationClient } from "../SanasTranslationClient";
import { TranslationState } from "../TranslationState";
import {
  ConnectOptions,
  ConnectResult,
  ResetOptions,
  SanasTranslationClientOptions,
  StreamMessage,
  Transport,
  TranslationStateCallbacks,
  TransportCallbacks,
} from "../types";

// --- Mock browser APIs ---

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

  getTracks() {
    return this.tracks;
  }

  getAudioTracks() {
    return this.tracks.filter((t) => t.kind === "audio");
  }
}

// --- Mock Web Audio API ---

class MockGainNode {
  gain = { value: 1 };
  connect = jest.fn();
  disconnect = jest.fn();
}

class MockAudioSourceNode {
  connect = jest.fn();
  disconnect = jest.fn();
}

class MockAudioBufferSourceNode {
  buffer: unknown = null;
  onended: (() => void) | null = null;
  connect = jest.fn();
  disconnect = jest.fn();
  start = jest.fn(() => {
    queueMicrotask(() => this.onended?.());
  });
  stop = jest.fn();
}

class MockOscillatorNode {
  connect = jest.fn();
  disconnect = jest.fn();
  start = jest.fn();
  stop = jest.fn();
}

class MockAudioDestinationNode {}

let createdBufferSourceNodes: MockAudioBufferSourceNode[] = [];

class MockAudioContext {
  sampleRate = 48000;
  currentTime = 0;
  state = "running";
  destination = new MockAudioDestinationNode();
  createMediaStreamSource = jest.fn(() => new MockAudioSourceNode());
  createBuffer = jest.fn(() => ({}));
  createBufferSource = jest.fn(() => {
    const node = new MockAudioBufferSourceNode();
    createdBufferSourceNodes.push(node);
    return node;
  });
  createGain = jest.fn(() => new MockGainNode());
  createOscillator = jest.fn(() => new MockOscillatorNode());
  resume = jest.fn(() => Promise.resolve());
  close = jest.fn(() => Promise.resolve());
}

// Install mocks globally
(globalThis as unknown as Record<string, unknown>).AudioContext =
  MockAudioContext;
(globalThis as unknown as Record<string, unknown>).MediaStream =
  MockMediaStream;

const mockFetch = jest.fn();
(globalThis as unknown as Record<string, unknown>).fetch = mockFetch;

// --- Mock Transport ---

class MockTransport implements Transport {
  callbacks: TransportCallbacks | null = null;
  sessionId: string | null = "sess-123";

  connect = jest.fn(
    async (
      _options: ConnectOptions,
      _clientOptions: SanasTranslationClientOptions,
      callbacks: TransportCallbacks,
    ): Promise<ConnectResult> => {
      this.callbacks = callbacks;
      callbacks.onConnectionStateChange("connected");
      return {
        audio: new MockMediaStream() as unknown as MediaStream,
      };
    },
  );

  configure = jest.fn((_options: ResetOptions): string | null => {
    return "reset-id-1";
  });

  disconnect = jest.fn();
  drainAudio = jest.fn(() => Promise.resolve());
  setAudioEnabled = jest.fn();
}

// --- Helpers ---

const mockAudioTrack = new MockMediaStreamTrack() as unknown as MediaStreamTrack;

function makeCallbacks(
  overrides: Partial<TranslationStateCallbacks> = {},
): TranslationStateCallbacks {
  return {
    onUtterance: jest.fn(),
    onLanguages: jest.fn(),
    onReady: jest.fn(),
    onSpeechLanguages: jest.fn(),
    onSpeechStop: jest.fn(),
    onError: jest.fn(),
    onConnectionStateChange: jest.fn(),
    ...overrides,
  };
}

function createClient(
  overrides: Partial<{
    apiKey: string;
    accessToken: string;
    endpoint: string;
    callbacks: TranslationStateCallbacks;
    onMessage: (message: StreamMessage) => void;
  }> = {},
) {
  const callbacks = overrides.callbacks ?? makeCallbacks();
  const translationState = new TranslationState(callbacks);
  const client = new SanasTranslationClient(translationState, {
    apiKey: overrides.apiKey ?? "test-key",
    accessToken: overrides.accessToken,
    endpoint: overrides.endpoint ?? "https://lt.test.com",
    onMessage: overrides.onMessage,
  });
  return { client, callbacks, translationState };
}

async function flush() {
  for (let i = 0; i < 5; i++) {
    await new Promise((resolve) => setTimeout(resolve, 0));
  }
}

async function connectClient(
  client: SanasTranslationClient,
  transport?: MockTransport,
) {
  const t = transport ?? new MockTransport();
  const result = await client.connect({
    transport: t,
    audioTrack: mockAudioTrack,
  });
  return { result, transport: t };
}

// --- Tests ---

describe("SanasTranslationClient", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    createdBufferSourceNodes = [];
  });

  describe("connect", () => {
    it("throws if already connected", async () => {
      const { client } = createClient();
      await connectClient(client);

      await expect(
        client.connect({
          transport: new MockTransport(),
          audioTrack: mockAudioTrack,
        }),
      ).rejects.toThrow("Already connected. Call disconnect() first.");
    });

    it("notifies connecting then connected state via callbacks", async () => {
      const { client, callbacks } = createClient();
      await connectClient(client);

      const calls = (callbacks.onConnectionStateChange as jest.Mock).mock.calls;
      expect(calls[0][0]).toBe("connecting");
      expect(calls[1][0]).toBe("connected");

      client.disconnect();
    });

    it("returns audio stream on successful connect", async () => {
      const { client } = createClient();
      const { result } = await connectClient(client);

      expect(result.audio).toBeDefined();

      client.disconnect();
    });

    it("calls transport.connect with correct arguments", async () => {
      const { client } = createClient();
      const transport = new MockTransport();

      await client.connect({ transport, audioTrack: mockAudioTrack });

      expect(transport.connect).toHaveBeenCalledWith(
        expect.objectContaining({ transport, audioTrack: mockAudioTrack }),
        expect.objectContaining({
          apiKey: "test-key",
          endpoint: "https://lt.test.com",
        }),
        expect.objectContaining({
          onMessage: expect.any(Function),
          onError: expect.any(Function),
          onConnectionStateChange: expect.any(Function),
        }),
      );

      client.disconnect();
    });

    it("calls transport.setAudioEnabled after successful connect", async () => {
      const { client } = createClient();
      const transport = new MockTransport();

      await client.connect({ transport, audioTrack: mockAudioTrack });

      expect(transport.setAudioEnabled).toHaveBeenCalledWith(true);

      client.disconnect();
    });

    it("cleans up and sets disconnected on connect failure", async () => {
      const { client, callbacks } = createClient();
      const transport = new MockTransport();
      transport.connect = jest.fn().mockRejectedValue(
        new Error("Connection failed"),
      ) as MockTransport["connect"];

      await expect(
        client.connect({ transport, audioTrack: mockAudioTrack }),
      ).rejects.toThrow("Connection failed");

      expect(callbacks.onConnectionStateChange).toHaveBeenCalledWith(
        "disconnected",
      );
    });

    it("allows reconnect after connect failure", async () => {
      const { client } = createClient();

      const failTransport = new MockTransport();
      failTransport.connect = jest.fn().mockRejectedValue(
        new Error("Connection failed"),
      ) as MockTransport["connect"];

      await client
        .connect({ transport: failTransport, audioTrack: mockAudioTrack })
        .catch(() => {});

      const { result } = await connectClient(client);
      expect(result.audio).toBeDefined();

      client.disconnect();
    });
  });

  describe("disconnect", () => {
    it("disconnects transport and notifies disconnected state", async () => {
      const { client, callbacks } = createClient();
      const { transport } = await connectClient(client);

      (callbacks.onConnectionStateChange as jest.Mock).mockClear();

      client.disconnect();

      expect(transport.disconnect).toHaveBeenCalled();
      expect(callbacks.onConnectionStateChange).toHaveBeenCalledWith(
        "disconnected",
      );
    });

    it("closes audio context", async () => {
      const { client } = createClient();
      await connectClient(client);

      const ctx = (client as unknown as Record<string, unknown>)[
        "audioContext"
      ] as MockAudioContext;

      client.disconnect();

      expect(ctx.close).toHaveBeenCalled();
    });

    it("rejects pending resets", async () => {
      const { client } = createClient();
      await connectClient(client);

      const resetPromise = client.reset({
        langIn: "en-US",
        langOut: "es-ES",
      });

      client.disconnect();

      await expect(resetPromise).rejects.toThrow("Disconnected");
    });
  });

  describe("reset", () => {
    it("throws when not connected", async () => {
      const { client } = createClient();

      await expect(
        client.reset({ langIn: "en-US", langOut: "es-ES" }),
      ).rejects.toThrow("Not connected. Call connect() first.");
    });

    it("calls transport.configure and resolves on ready", async () => {
      const { client } = createClient();
      const { transport } = await connectClient(client);

      const resetPromise = client.reset({
        langIn: "en-US",
        langOut: "es-ES",
        voiceId: "voice-1",
        glossary: ["Sanas"],
      });

      expect(transport.configure).toHaveBeenCalledWith({
        langIn: "en-US",
        langOut: "es-ES",
        voiceId: "voice-1",
        glossary: ["Sanas"],
      });

      transport.callbacks!.onMessage({
        type: "ready",
        ready: { id: "reset-id-1" },
      });

      await expect(resetPromise).resolves.toBeUndefined();

      client.disconnect();
    });
  });

  describe("message routing", () => {
    it("routes transcription messages to callbacks", async () => {
      const { client, callbacks } = createClient();
      const { transport } = await connectClient(client);

      transport.callbacks!.onMessage({
        type: "transcription",
        transcription: {
          complete: [{ word: "hello", start: 0, end: 1 }],
          partial: [],
          utterance_idx: 0,
        },
      });

      expect(callbacks.onUtterance).toHaveBeenCalledTimes(1);
      const [utteranceDisplay, index] = (callbacks.onUtterance as jest.Mock)
        .mock.calls[0];
      expect(index).toBe(0);
      expect(utteranceDisplay.transcription.complete).toEqual([
        { word: "hello", start: 0, end: 1 },
      ]);

      client.disconnect();
    });

    it("routes translation messages to callbacks", async () => {
      const { client, callbacks } = createClient();
      const { transport } = await connectClient(client);

      transport.callbacks!.onMessage({
        type: "transcription",
        transcription: {
          complete: [{ word: "hello", start: 0, end: 1 }],
          partial: [],
          utterance_idx: 0,
        },
      });

      transport.callbacks!.onMessage({
        type: "translation",
        translation: {
          complete: [{ word: "hola", start: 0, end: 1 }],
          partial: [],
          utterance_idx: 0,
        },
      });

      expect(callbacks.onUtterance).toHaveBeenCalledTimes(2);
      const lastCall = (callbacks.onUtterance as jest.Mock).mock.calls[1];
      expect(lastCall[0].translation.complete).toEqual([
        { word: "hola", start: 0, end: 1 },
      ]);

      client.disconnect();
    });

    it("routes language identification messages to callbacks", async () => {
      const { client, callbacks } = createClient();
      const { transport } = await connectClient(client);

      transport.callbacks!.onMessage({
        type: "languages",
        languages: {
          languages: [
            { short_code: "en", name: "English", probability: 0.9 },
          ],
        },
      });

      expect(callbacks.onLanguages).toHaveBeenCalledWith([
        { shortCode: "en", name: "English", probability: 0.9 },
      ]);

      client.disconnect();
    });

    it("routes error messages to callbacks", async () => {
      const { client, callbacks } = createClient();
      const { transport } = await connectClient(client);

      transport.callbacks!.onError("something went wrong");

      expect(callbacks.onError).toHaveBeenCalledWith("something went wrong");

      client.disconnect();
    });

    it("routes connection state changes to callbacks", async () => {
      const { client, callbacks } = createClient();
      const { transport } = await connectClient(client);

      (callbacks.onConnectionStateChange as jest.Mock).mockClear();

      transport.callbacks!.onConnectionStateChange("disconnected");

      expect(callbacks.onConnectionStateChange).toHaveBeenCalledWith(
        "disconnected",
      );

      client.disconnect();
    });

    it("routes speech_languages messages to callbacks", async () => {
      const { client, callbacks } = createClient();
      const { transport } = await connectClient(client);

      transport.callbacks!.onMessage({
        type: "speech_languages",
        speech_languages: {
          lang_in: "en-US",
          lang_out: "es-ES",
        },
      });

      expect(callbacks.onSpeechLanguages).toHaveBeenCalledWith(
        "en-US",
        "es-ES",
      );

      client.disconnect();
    });

    it("routes speech_stop messages to callbacks", async () => {
      const { client, callbacks } = createClient();
      const { transport } = await connectClient(client);

      transport.callbacks!.onMessage({
        type: "speech_stop",
        speech_stop: {},
      });

      expect(callbacks.onSpeechStop).toHaveBeenCalledTimes(1);

      client.disconnect();
    });

    it("routes ready messages to callbacks", async () => {
      const { client, callbacks } = createClient();
      const { transport } = await connectClient(client);

      transport.callbacks!.onMessage({
        type: "ready",
        ready: { id: "r1" },
      });

      expect(callbacks.onReady).toHaveBeenCalledWith("r1");

      client.disconnect();
    });
  });

  describe("onMessage (StreamMessage relay)", () => {
    it("fires onMessage for lt messages", async () => {
      const onMessage = jest.fn();
      const { client } = createClient({ onMessage });
      const { transport } = await connectClient(client);

      transport.callbacks!.onMessage({
        type: "transcription",
        transcription: {
          complete: [{ word: "hello", start: 0, end: 1 }],
          partial: [],
          utterance_idx: 0,
        },
      });

      expect(onMessage).toHaveBeenCalledWith(
        expect.objectContaining({
          type: "lt",
          lt: expect.objectContaining({ type: "transcription" }),
        }),
      );

      client.disconnect();
    });

    it("fires onMessage for transport state changes", async () => {
      const onMessage = jest.fn();
      const { client } = createClient({ onMessage });

      await connectClient(client);

      expect(onMessage).toHaveBeenCalledWith({
        type: "transport",
        state: "connecting",
      });
      expect(onMessage).toHaveBeenCalledWith({
        type: "transport",
        state: "connected",
      });

      client.disconnect();
    });

    it("fires onMessage for error messages", async () => {
      const onMessage = jest.fn();
      const { client } = createClient({ onMessage });
      const { transport } = await connectClient(client);

      transport.callbacks!.onError("test error");

      expect(onMessage).toHaveBeenCalledWith({
        type: "error",
        message: "test error",
      });

      client.disconnect();
    });
  });

  describe("fetchLanguages (static)", () => {
    it("fetches and maps languages from the server", async () => {
      mockFetch.mockResolvedValue({
        ok: true,
        json: async () => ({
          success: true,
          data: {
            languages: [
              {
                long_code: "en-US",
                short_code: "en",
                name: "English",
                support: "stable",
              },
              {
                long_code: "es-ES",
                short_code: "es",
                name: "Spanish",
                support: "stable",
              },
            ],
          },
        }),
      });

      const languages = await SanasTranslationClient.fetchLanguages({
        apiKey: "test-key",
        endpoint: "https://lt.test.com",
      });

      expect(languages).toEqual([
        {
          longCode: "en-US",
          shortCode: "en",
          name: "English",
          support: "stable",
        },
        {
          longCode: "es-ES",
          shortCode: "es",
          name: "Spanish",
          support: "stable",
        },
      ]);
    });

    it("sends X-API-Key header when apiKey is set", async () => {
      mockFetch.mockResolvedValue({
        ok: true,
        json: async () => ({ success: true, data: { languages: [] } }),
      });

      await SanasTranslationClient.fetchLanguages({
        apiKey: "my-key",
        endpoint: "https://lt.test.com",
      });

      expect(mockFetch).toHaveBeenCalledWith(
        "https://lt.test.com/v2/languages/list",
        expect.objectContaining({
          method: "POST",
          headers: expect.objectContaining({
            "X-API-Key": "my-key",
          }),
        }),
      );
    });

    it("sends Authorization header when accessToken is set", async () => {
      mockFetch.mockResolvedValue({
        ok: true,
        json: async () => ({ success: true, data: { languages: [] } }),
      });

      await SanasTranslationClient.fetchLanguages({
        accessToken: "my-token",
        endpoint: "https://lt.test.com",
      });

      expect(mockFetch).toHaveBeenCalledWith(
        expect.any(String),
        expect.objectContaining({
          headers: expect.objectContaining({
            Authorization: "Bearer my-token",
          }),
        }),
      );
    });

    it("throws when no credentials provided", async () => {
      await expect(
        SanasTranslationClient.fetchLanguages({
          endpoint: "https://lt.test.com",
        }),
      ).rejects.toThrow("Missing credentials");
    });

    it("sends x-lang header when lang option is provided", async () => {
      mockFetch.mockResolvedValue({
        ok: true,
        json: async () => ({ success: true, data: { languages: [] } }),
      });

      await SanasTranslationClient.fetchLanguages(
        { apiKey: "test-key", endpoint: "https://lt.test.com" },
        { lang: "es-ES" },
      );

      expect(mockFetch).toHaveBeenCalledWith(
        expect.any(String),
        expect.objectContaining({
          headers: expect.objectContaining({
            "x-lang": "es-ES",
          }),
        }),
      );
    });

    it("throws on 403 (authentication failure)", async () => {
      mockFetch.mockResolvedValue({
        ok: false,
        status: 403,
        text: async () => "Forbidden",
      });

      await expect(
        SanasTranslationClient.fetchLanguages({
          apiKey: "test-key",
          endpoint: "https://lt.test.com",
        }),
      ).rejects.toThrow("Authentication failed.");
    });

    it("throws on other HTTP errors", async () => {
      mockFetch.mockResolvedValue({
        ok: false,
        status: 500,
        text: async () => "Internal Server Error",
      });

      await expect(
        SanasTranslationClient.fetchLanguages({
          apiKey: "test-key",
          endpoint: "https://lt.test.com",
        }),
      ).rejects.toThrow("Failed to fetch languages: 500");
    });
  });

  describe("speech delimiter scheduling", () => {
    it("schedules a speech delimiter via AudioBufferSourceNode", async () => {
      const { client, callbacks } = createClient();
      const { transport } = await connectClient(client);

      transport.callbacks!.onMessage({
        type: "transcription",
        transcription: {
          complete: [{ word: "hello", start: 0, end: 1 }],
          partial: [],
          utterance_idx: 0,
        },
      });

      transport.callbacks!.onMessage({
        type: "speech_delimiter",
        speech_delimiter: {
          time: 0.5,
          transcription: { utterance_idx: 0, word_idx: 1, char_idx: 0 },
          translation: { utterance_idx: 0, word_idx: 0, char_idx: 0 },
        },
      });

      expect(createdBufferSourceNodes).toHaveLength(1);
      const node = createdBufferSourceNodes[0];
      expect(node.start).toHaveBeenCalledWith(0.5);
      expect(node.connect).toHaveBeenCalled();

      await flush();

      expect(callbacks.onUtterance).toHaveBeenCalled();
      const lastCall = (callbacks.onUtterance as jest.Mock).mock.calls.at(-1);
      expect(lastCall[0].transcription.spokenText).toBe("hello");

      client.disconnect();
    });

    it("delivers speech delimiter to translation state when AudioBuffer ends", async () => {
      const { client, callbacks } = createClient();
      const { transport } = await connectClient(client);

      transport.callbacks!.onMessage({
        type: "transcription",
        transcription: {
          complete: [{ word: "hello", start: 0, end: 1 }],
          partial: [],
          utterance_idx: 0,
        },
      });

      (callbacks.onUtterance as jest.Mock).mockClear();

      transport.callbacks!.onMessage({
        type: "speech_delimiter",
        speech_delimiter: {
          time: 0.5,
          transcription: { utterance_idx: 0, word_idx: 1, char_idx: 0 },
          translation: { utterance_idx: 0, word_idx: 0, char_idx: 0 },
        },
      });

      expect(callbacks.onUtterance).not.toHaveBeenCalled();

      await flush();

      expect(callbacks.onUtterance).toHaveBeenCalled();

      client.disconnect();
    });

    it("cancels pending delimiters on disconnect", async () => {
      const { client } = createClient();
      const { transport } = await connectClient(client);

      const originalStart = MockAudioBufferSourceNode.prototype.start;
      MockAudioBufferSourceNode.prototype.start = jest.fn();

      transport.callbacks!.onMessage({
        type: "speech_delimiter",
        speech_delimiter: {
          time: 10.0,
          transcription: { utterance_idx: 0, word_idx: 1, char_idx: 0 },
          translation: { utterance_idx: 0, word_idx: 0, char_idx: 0 },
        },
      });

      const node = createdBufferSourceNodes[0];
      expect(node).toBeDefined();

      client.disconnect();

      expect(node.onended).toBeNull();
      expect(node.disconnect).toHaveBeenCalled();

      MockAudioBufferSourceNode.prototype.start = originalStart;
    });

    it("falls back to immediate delivery when no audio context", async () => {
      const { client, callbacks } = createClient();
      const { transport } = await connectClient(client);

      (client as unknown as Record<string, unknown>)["audioContext"] = null;

      transport.callbacks!.onMessage({
        type: "transcription",
        transcription: {
          complete: [{ word: "hello", start: 0, end: 1 }],
          partial: [],
          utterance_idx: 0,
        },
      });

      (callbacks.onUtterance as jest.Mock).mockClear();

      transport.callbacks!.onMessage({
        type: "speech_delimiter",
        speech_delimiter: {
          time: 0.5,
          transcription: { utterance_idx: 0, word_idx: 1, char_idx: 0 },
          translation: { utterance_idx: 0, word_idx: 0, char_idx: 0 },
        },
      });

      expect(createdBufferSourceNodes).toHaveLength(0);
      expect(callbacks.onUtterance).toHaveBeenCalled();

      client.disconnect();
    });
  });
});

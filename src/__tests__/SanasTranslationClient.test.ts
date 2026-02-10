import { SanasTranslationClient } from "../SanasTranslationClient";

// --- Mock WebRTC and browser APIs ---

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

class MockRTCDataChannel {
  readyState: RTCDataChannelState = "connecting";
  onopen: (() => void) | null = null;
  onclose: (() => void) | null = null;
  onerror: ((event: unknown) => void) | null = null;
  onmessage: ((event: MessageEvent) => void) | null = null;
  send = jest.fn();

  simulateOpen() {
    this.readyState = "open";
    this.onopen?.();
  }

  simulateMessage(data: string) {
    this.onmessage?.(new MessageEvent("message", { data }));
  }
}

let mockDataChannel: MockRTCDataChannel;

class MockRTCPeerConnection {
  connectionState: RTCPeerConnectionState = "new";
  ontrack: ((e: { streams: MockMediaStream[] }) => void) | null = null;
  onconnectionstatechange: (() => void) | null = null;
  onnegotiationneeded: (() => void) | null = null;
  oniceconnectionstatechange: (() => void) | null = null;

  private negotiationScheduled = false;

  // Like real WebRTC: addTrack schedules onnegotiationneeded
  addTrack = jest.fn(() => {
    if (!this.negotiationScheduled) {
      this.negotiationScheduled = true;
      // Use queueMicrotask to fire after the current synchronous block
      // (the onnegotiationneeded handler is set after addTrack in connect())
      queueMicrotask(() => this.onnegotiationneeded?.());
    }
  });

  close = jest.fn();

  createDataChannel(_label: string): MockRTCDataChannel {
    mockDataChannel = new MockRTCDataChannel();
    return mockDataChannel;
  }

  async createOffer() {
    return { type: "offer", sdp: "mock-sdp" };
  }

  async setLocalDescription(_desc: unknown) {
    // no-op — negotiation is triggered by addTrack, not here
  }

  async setRemoteDescription(_desc: unknown) {
    this.connectionState = "connected";
    this.onconnectionstatechange?.();
  }

  simulateTrack() {
    const stream = new MockMediaStream();
    this.ontrack?.({ streams: [stream] });
    return stream;
  }

  simulateConnectionState(state: RTCPeerConnectionState) {
    this.connectionState = state;
    this.onconnectionstatechange?.();
  }
}

// --- Mock Web Audio API ---

class MockGainNode {
  gain = { value: 1 };
  connect = jest.fn();
  disconnect = jest.fn();
}

class MockScriptProcessorNode {
  onaudioprocess: ((event: unknown) => void) | null = null;
  bufferSize = 4096;
  connect = jest.fn();
  disconnect = jest.fn();
}

class MockAudioSourceNode {
  connect = jest.fn();
  disconnect = jest.fn();
}

class MockAudioContext {
  sampleRate = 48000;
  state = "running";
  createMediaStreamSource = jest.fn(() => new MockAudioSourceNode());
  createScriptProcessor = jest.fn(() => new MockScriptProcessorNode());
  createGain = jest.fn(() => new MockGainNode());
  resume = jest.fn(() => Promise.resolve());
  close = jest.fn(() => Promise.resolve());
}

// Install mocks globally
(globalThis as unknown as Record<string, unknown>).AudioContext =
  MockAudioContext;
(globalThis as unknown as Record<string, unknown>).RTCPeerConnection =
  MockRTCPeerConnection;
(globalThis as unknown as Record<string, unknown>).MediaStream =
  MockMediaStream;
(globalThis as unknown as Record<string, unknown>).MediaStreamTrack =
  MockMediaStreamTrack;

const mockGetUserMedia = jest.fn();
Object.defineProperty(globalThis, "navigator", {
  value: {
    mediaDevices: {
      getUserMedia: mockGetUserMedia,
    },
  },
  writable: true,
});

// Mock fetch
const mockFetch = jest.fn();
(globalThis as unknown as Record<string, unknown>).fetch = mockFetch;

// --- Helpers ---

function createClient(
  overrides: Partial<{
    apiKey: string;
    accessToken: string;
    endpoint: string;
  }> = {},
) {
  return new SanasTranslationClient({
    apiKey: "test-key",
    endpoint: "https://lt.test.com",
    ...overrides,
  });
}

function setupSuccessfulConnect() {
  const stream = new MockMediaStream();
  mockGetUserMedia.mockResolvedValue(stream);

  mockFetch.mockResolvedValue({
    ok: true,
    json: async () => ({
      type: "answer",
      sdp: "mock-answer-sdp",
      session_id: "sess-123",
    }),
  });
}

function getPeer(client: SanasTranslationClient): MockRTCPeerConnection {
  return (client as unknown as Record<string, unknown>)[
    "peerConnection"
  ] as MockRTCPeerConnection;
}

/**
 * Flush all pending microtasks and macrotasks (setTimeout 0).
 * Uses real setTimeout since we don't use fake timers in these tests.
 */
async function flush() {
  for (let i = 0; i < 5; i++) {
    // Each iteration drains all microtasks, then waits for the next macrotask tick
    await new Promise((resolve) => setTimeout(resolve, 0));
  }
}

/**
 * Performs a full connect flow: triggers negotiation, waits for server exchange,
 * and simulates receiving the translated audio track.
 */
async function connectClient(client: SanasTranslationClient) {
  setupSuccessfulConnect();

  const connectPromise = client.connect();

  // Wait for negotiation + fetch + setRemoteDescription chain to complete
  await flush();

  // Simulate server sending translated audio track (resolves connect)
  getPeer(client).simulateTrack();

  // Open the data channel for subsequent messaging (reset, etc.)
  mockDataChannel.simulateOpen();

  return connectPromise;
}

// --- Tests ---

describe("SanasTranslationClient", () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  describe("constructor", () => {
    it("creates a client with initial disconnected state", () => {
      const client = createClient();
      expect(client.connectionState).toBe("disconnected");
      expect(client.sessionId).toBeNull();
      expect(client.error).toBeNull();
      expect(client.state.utterances).toEqual([]);
      expect(client.isAudioEnabled).toBe(true);
    });
  });

  describe("connect", () => {
    it("throws if already connected", async () => {
      const client = createClient();
      const result = await connectClient(client);
      expect(result.audio).toBeDefined();

      await expect(client.connect()).rejects.toThrow(
        "Already connected. Call disconnect() first.",
      );
    });

    it("sets connection state to connecting", () => {
      const client = createClient();
      setupSuccessfulConnect();

      // Don't await — just check the intermediate state
      client.connect();
      expect(client.connectionState).toBe("connecting");

      // Clean up
      client.disconnect();
    });

    it("captures microphone when no audioTrack provided", async () => {
      const client = createClient();
      await connectClient(client);

      expect(mockGetUserMedia).toHaveBeenCalledWith(
        expect.objectContaining({
          video: false,
          audio: expect.any(Object),
        }),
      );

      client.disconnect();
    });

    it("uses provided audioTrack instead of capturing mic", async () => {
      const client = createClient();
      setupSuccessfulConnect();

      const track = new MockMediaStreamTrack();
      const connectPromise = client.connect({
        audioTrack: track as unknown as MediaStreamTrack,
      });

      await flush();

      // Should NOT have called getUserMedia
      expect(mockGetUserMedia).not.toHaveBeenCalled();

      // Resolve connect (just needs audio track, no ready message)
      getPeer(client).simulateTrack();
      await connectPromise;

      client.disconnect();
    });

    it("throws on mic access failure", async () => {
      const client = createClient();
      mockGetUserMedia.mockRejectedValue(new Error("Permission denied"));

      await expect(client.connect()).rejects.toThrow(
        "Could not access microphone",
      );
      expect(client.connectionState).toBe("disconnected");
    });

    it("throws on auth failure (401)", async () => {
      const client = createClient();
      mockGetUserMedia.mockResolvedValue(new MockMediaStream());
      mockFetch.mockResolvedValue({
        ok: false,
        status: 401,
        text: async () => "Unauthorized",
      });

      await expect(client.connect()).rejects.toThrow("Authentication failed");
      expect(client.error).toBe("Authentication failed. Please sign in again.");
    });

    it("throws on forbidden (403)", async () => {
      const client = createClient();
      mockGetUserMedia.mockResolvedValue(new MockMediaStream());
      mockFetch.mockResolvedValue({
        ok: false,
        status: 403,
        text: async () => "Forbidden",
      });

      await expect(client.connect()).rejects.toThrow("Access denied");
    });

    it("sends Authorization header when accessToken is set", async () => {
      const client = createClient({
        apiKey: undefined,
        accessToken: "my-token",
      });

      await connectClient(client);

      expect(mockFetch).toHaveBeenCalledWith(
        expect.any(String),
        expect.objectContaining({
          headers: expect.objectContaining({
            Authorization: "Bearer my-token",
          }),
        }),
      );

      client.disconnect();
    });

    it("sends X-API-Key header when apiKey is set", async () => {
      const client = createClient({ apiKey: "my-key" });
      await connectClient(client);

      expect(mockFetch).toHaveBeenCalledWith(
        expect.any(String),
        expect.objectContaining({
          headers: expect.objectContaining({
            "X-API-Key": "my-key",
          }),
        }),
      );

      client.disconnect();
    });

    it("throws when no credentials provided", async () => {
      const client = createClient({
        apiKey: undefined,
        accessToken: undefined,
      });
      mockGetUserMedia.mockResolvedValue(new MockMediaStream());

      await expect(client.connect()).rejects.toThrow("Missing credentials");

      client.disconnect();
    });

    it("resolves with audio stream after ready message", async () => {
      const client = createClient();
      const result = await connectClient(client);

      expect(result.audio).toBeDefined();
      expect(client.connectionState).toBe("connected");
      expect(client.sessionId).toBe("sess-123");

      client.disconnect();
    });
  });

  describe("disconnect", () => {
    it("resets all state", async () => {
      const client = createClient();
      await connectClient(client);

      client.disconnect();

      expect(client.connectionState).toBe("disconnected");
      expect(client.sessionId).toBeNull();
      expect(client.error).toBeNull();
    });

    it("stops owned audio tracks", async () => {
      const client = createClient();
      const stream = new MockMediaStream();
      mockGetUserMedia.mockResolvedValue(stream);
      mockFetch.mockResolvedValue({
        ok: true,
        json: async () => ({
          type: "answer",
          sdp: "mock-answer-sdp",
          session_id: "sess-123",
        }),
      });

      const connectPromise = client.connect();
      await flush();

      getPeer(client).simulateTrack();

      await connectPromise;

      client.disconnect();

      for (const track of stream.getTracks()) {
        expect(track.stop).toHaveBeenCalled();
      }
    });

    it("rejects pending resets", async () => {
      const client = createClient();
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
    it("sends reset message and resolves on ready response", async () => {
      const client = createClient();
      await connectClient(client);

      const resetPromise = client.reset({
        langIn: "en-US",
        langOut: "es-ES",
        voiceId: "voice-1",
        glossary: ["Sanas"],
      });

      // The reset message should have been sent via the data channel
      expect(mockDataChannel.send).toHaveBeenCalled();
      const sentData = JSON.parse(mockDataChannel.send.mock.calls.at(-1)[0]);
      expect(sentData.type).toBe("reset");
      expect(sentData.reset.lang_in).toBe("en-US");
      expect(sentData.reset.lang_out).toBe("es-ES");
      expect(sentData.reset.voice_id).toBe("voice-1");
      expect(sentData.reset.glossary).toEqual(["Sanas"]);

      // Simulate server confirming with a ready message containing the reset ID
      const resetId = sentData.reset.id;
      mockDataChannel.simulateMessage(
        JSON.stringify({ type: "ready", ready: { id: resetId } }),
      );

      await expect(resetPromise).resolves.toBeUndefined();

      client.disconnect();
    });
  });

  describe("isAudioEnabled", () => {
    it("mutes and unmutes the audio track", async () => {
      const client = createClient();
      const stream = new MockMediaStream();
      const track = stream.getAudioTracks()[0];
      mockGetUserMedia.mockResolvedValue(stream);
      mockFetch.mockResolvedValue({
        ok: true,
        json: async () => ({
          type: "answer",
          sdp: "mock-answer-sdp",
          session_id: "sess-123",
        }),
      });

      const connectPromise = client.connect();
      await flush();

      getPeer(client).simulateTrack();
      await connectPromise;

      client.isAudioEnabled = false;
      expect(track.enabled).toBe(false);

      client.isAudioEnabled = true;
      expect(track.enabled).toBe(true);

      client.disconnect();
    });
  });

  describe("onUtterance", () => {
    it("registers callback and returns unsubscribe", async () => {
      const client = createClient();
      await connectClient(client);

      const callback = jest.fn();
      const unsub = client.onUtterance(callback);

      // Send a transcription via data channel
      mockDataChannel.simulateMessage(
        JSON.stringify({
          type: "transcription",
          transcription: {
            complete: [{ word: "hello", start: 0, end: 1 }],
            partial: [],
            utterance_idx: 0,
          },
        }),
      );

      expect(callback).toHaveBeenCalledTimes(1);

      unsub();

      mockDataChannel.simulateMessage(
        JSON.stringify({
          type: "transcription",
          transcription: {
            complete: [{ word: "world", start: 0, end: 1 }],
            partial: [],
            utterance_idx: 0,
          },
        }),
      );

      expect(callback).toHaveBeenCalledTimes(1);

      client.disconnect();
    });
  });

  describe("onLanguages", () => {
    it("registers callback and notifies on language identification", async () => {
      const client = createClient();
      await connectClient(client);

      const callback = jest.fn();
      client.onLanguages(callback);

      mockDataChannel.simulateMessage(
        JSON.stringify({
          type: "languages",
          languages: {
            languages: [
              { short_code: "en", name: "English", probability: 0.9 },
            ],
          },
        }),
      );

      expect(callback).toHaveBeenCalledWith([
        { shortCode: "en", name: "English", probability: 0.9 },
      ]);

      client.disconnect();
    });
  });

  describe("onConnectionStateChange", () => {
    it("notifies on connection state change", async () => {
      const client = createClient();
      const callback = jest.fn();
      client.onConnectionStateChange(callback);

      setupSuccessfulConnect();
      const connectPromise = client.connect();

      // "connecting" should have been notified
      expect(callback).toHaveBeenCalledWith("connecting");

      await flush();

      // After server answer, peer connection goes to "connected"
      expect(callback).toHaveBeenCalledWith("connected");

      // Resolve connect (just needs audio track)
      getPeer(client).simulateTrack();
      await connectPromise;

      callback.mockClear();

      client.disconnect();
      expect(callback).toHaveBeenCalledWith("disconnected");
    });

    it("returns unsubscribe function", () => {
      const client = createClient();
      const callback = jest.fn();
      const unsub = client.onConnectionStateChange(callback);

      unsub();
      setupSuccessfulConnect();
      client.connect();
      expect(callback).not.toHaveBeenCalled();
      client.disconnect();
    });
  });

  describe("onError", () => {
    it("notifies on error", async () => {
      const client = createClient();
      const callback = jest.fn();
      client.onError(callback);

      mockGetUserMedia.mockResolvedValue(new MockMediaStream());
      mockFetch.mockResolvedValue({
        ok: false,
        status: 401,
        text: async () => "Unauthorized",
      });

      await client.connect().catch(() => {});
      expect(callback).toHaveBeenCalledWith(
        "Authentication failed. Please sign in again.",
      );
    });

    it("returns unsubscribe function", () => {
      const client = createClient();
      const callback = jest.fn();
      const unsub = client.onError(callback);
      unsub();

      expect(callback).not.toHaveBeenCalled();
    });
  });

  describe("fetchLanguages", () => {
    it("fetches and maps languages from the server", async () => {
      const client = createClient();
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

      const languages = await client.fetchLanguages();

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
      const client = createClient({ apiKey: "my-key" });
      mockFetch.mockResolvedValue({
        ok: true,
        json: async () => ({ success: true, data: { languages: [] } }),
      });

      await client.fetchLanguages();

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
      const client = createClient({
        apiKey: undefined,
        accessToken: "my-token",
      });
      mockFetch.mockResolvedValue({
        ok: true,
        json: async () => ({ success: true, data: { languages: [] } }),
      });

      await client.fetchLanguages();

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
      const client = createClient({
        apiKey: undefined,
        accessToken: undefined,
      });

      await expect(client.fetchLanguages()).rejects.toThrow(
        "Missing credentials",
      );
    });

    it("sends x-lang header when lang option is provided", async () => {
      const client = createClient();
      mockFetch.mockResolvedValue({
        ok: true,
        json: async () => ({ success: true, data: { languages: [] } }),
      });

      await client.fetchLanguages({ lang: "es-ES" });

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
      const client = createClient();
      mockFetch.mockResolvedValue({
        ok: false,
        status: 403,
        text: async () => "Forbidden",
      });

      await expect(client.fetchLanguages()).rejects.toThrow(
        "Authentication failed.",
      );
    });

    it("throws on other HTTP errors", async () => {
      const client = createClient();
      mockFetch.mockResolvedValue({
        ok: false,
        status: 500,
        text: async () => "Internal Server Error",
      });

      await expect(client.fetchLanguages()).rejects.toThrow(
        "Failed to fetch languages: 500",
      );
    });
  });

  describe("message queue", () => {
    it("queues messages before data channel opens and flushes on open", async () => {
      const client = createClient();
      setupSuccessfulConnect();

      const connectPromise = client.connect();

      // Reset before channel is open — message should be queued
      const resetPromise = client.reset({ langIn: "en-US", langOut: "es-ES" });

      await flush();

      // Data channel not open yet — send should not have been called for reset
      const resetCalls = mockDataChannel.send.mock.calls.filter(
        (call: string[]) => {
          try {
            return JSON.parse(call[0]).type === "reset";
          } catch {
            return false;
          }
        },
      );
      expect(resetCalls).toHaveLength(0);

      // Open the data channel — queued messages should flush
      mockDataChannel.simulateOpen();

      const resetCallsAfter = mockDataChannel.send.mock.calls.filter(
        (call: string[]) => {
          try {
            return JSON.parse(call[0]).type === "reset";
          } catch {
            return false;
          }
        },
      );
      expect(resetCallsAfter).toHaveLength(1);

      // Resolve connect (needs audio track)
      getPeer(client).simulateTrack();
      await connectPromise;

      // Resolve reset (needs ready message with matching ID)
      const resetId = JSON.parse(resetCallsAfter[0][0]).reset.id;
      mockDataChannel.simulateMessage(
        JSON.stringify({ type: "ready", ready: { id: resetId } }),
      );
      await resetPromise;

      client.disconnect();
    });
  });
});

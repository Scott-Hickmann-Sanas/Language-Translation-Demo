# Sanas Language Translation JS Client

A browser-based TypeScript client for real-time audio language translation, supporting both WebRTC and WebSocket transports.

## Installation

```bash
npm install @sanas-ai/language-translation
```

## Quick Start

```typescript
import {
  SanasTranslationClient,
  TranslationState,
  WebRTCTransport,
  getMicrophoneTrack,
} from "@sanas-ai/language-translation";

// 1. Create a TranslationState to receive callbacks
const state = new TranslationState({
  onUtterance: (utterance, index) => {
    console.log("Transcription:", utterance.transcription.spokenText);
    console.log("Translation:", utterance.translation.spokenText);
  },
  onConnectionStateChange: (connectionState) => {
    console.log("Connection:", connectionState);
  },
  onError: (error) => {
    console.error("Error:", error);
  },
});

// 2. Create the client
const client = new SanasTranslationClient(state, {
  apiKey: "your-api-key",
  endpoint: "https://api.sanaslt.com",
});

// 3. Acquire a mic track and connect
const track = await getMicrophoneTrack();
const transport = new WebRTCTransport();
const { audio } = await client.connect({ transport, audioTrack: track });

// 4. Play translated audio
const audioElement = document.createElement("audio");
audioElement.srcObject = audio;
audioElement.autoplay = true;

// 5. Configure translation
await client.reset({ langIn: "en-US", langOut: "es-ES" });

// 6. When done
client.disconnect();
track.stop();
```

## Architecture

The library is split into three main pieces:

- **`TranslationState`** — Standalone state container that processes `StreamMessage`s and fires callbacks. Consumers create one instance per participant (local + remote) to display both sides of a call.
- **`SanasTranslationClient`** — Manages the connection lifecycle, wraps transport events into `StreamMessage`s, and routes them to a `TranslationState`. Exposes an `onMessage` hook for relaying messages to other participants.
- **Transports** (`WebRTCTransport`, `WebSocketTransport`) — Handle the network protocol. The consumer provides an audio track; the transport sends it to the server and delivers translated audio back.

### Two-Party Call Pattern

```typescript
// Device A
const myState = new TranslationState({
  onUtterance: (utt, idx) => renderLocal(utt, idx),
});
const theirState = new TranslationState({
  onUtterance: (utt, idx) => renderRemote(utt, idx),
});

const client = new SanasTranslationClient(myState, {
  apiKey: "...",
  endpoint: "...",
  onMessage: (msg) => relay.send(JSON.stringify(msg)), // send to Device B
});

relay.onMessage((data) => theirState.handleMessage(JSON.parse(data))); // receive from Device B
```

## API

### `TranslationState`

```typescript
const state = new TranslationState(callbacks?);
```

Manages transcription, translation, connection state, and language detection state. All callbacks are optional.

#### Callbacks

| Callback                 | Signature                                                | Description                                 |
| ------------------------ | -------------------------------------------------------- | ------------------------------------------- |
| `onUtterance`            | `(utterance: UtteranceDisplay, index: number) => void`   | Utterance created or updated                |
| `onLanguages`            | `(languages: IdentifiedLanguageDisplay[]) => void`       | Detected languages updated                  |
| `onReady`                | `(id: string \| null) => void`                           | Server confirmed ready after reset          |
| `onSpeechLanguages`      | `(langIn: string, langOut: string) => void`              | Active speech language pair changed          |
| `onSpeechStop`           | `() => void`                                             | Speech stopped                              |
| `onConnectionStateChange`| `(state: ConnectionState) => void`                       | Connection state changed                    |
| `onError`                | `(error: string) => void`                                | Error occurred                              |

#### Methods

| Method                        | Returns                  | Description                                    |
| ----------------------------- | ------------------------ | ---------------------------------------------- |
| `handleMessage(msg)`          | `void`                   | Process a `StreamMessage` (from client or relay)|
| `waitForReady(resetId)`       | `Promise<void>`          | Resolves when a matching ready message arrives  |
| `destroy()`                   | `void`                   | Rejects all pending ready promises              |
| `getState()`                  | `TranslationClientState` | Full snapshot of utterances and languages        |
| `getUtteranceDisplay(index)`  | `UtteranceDisplay`       | Display data for a single utterance             |

#### Properties

| Property              | Type                         | Description                  |
| --------------------- | ---------------------------- | ---------------------------- |
| `connectionState`     | `ConnectionState`            | Current connection state     |
| `identifiedLanguages` | `IdentifiedLanguageDisplay[]`| Last detected languages      |

### `SanasTranslationClient`

```typescript
const client = new SanasTranslationClient(translationState, options);
```

| Option        | Type                              | Description                                           |
| ------------- | --------------------------------- | ----------------------------------------------------- |
| `apiKey`      | `string?`                         | API key (use this or `accessToken`)                   |
| `accessToken` | `string?`                         | OAuth token (use this or `apiKey`)                    |
| `endpoint`    | `string`                          | Server URL (e.g. `https://api.sanaslt.com`)           |
| `onMessage`   | `(message: StreamMessage) => void`| Fires for every message — use this for relay          |
| `onAudioData` | `(samples: Int16Array, sampleRate: number) => void` | Fires with raw output audio (Int16 PCM) as received from the server. Works with both WebRTC and WebSocket transports. |

#### `client.connect(options): Promise<ConnectResult>`

Connects to the translation server through the given transport.

| Option            | Type                | Required | Description                                    |
| ----------------- | ------------------- | -------- | ---------------------------------------------- |
| `transport`       | `Transport`         | Yes      | `WebRTCTransport` or `WebSocketTransport`      |
| `audioTrack`      | `MediaStreamTrack`  | Yes      | Audio track to send (from mic, file, etc.)     |
| `conversationId`  | `string?`           |          | Conversation ID to join                        |
| `userName`        | `string?`           |          | Display name for this participant              |
| `inputSampleRate` | `SampleRate?`       |          | Input sample rate in Hz (default: 16000)       |
| `outputSampleRate`| `SampleRate?`       |          | Output sample rate in Hz (default: 16000)      |

Returns `{ audio: MediaStream }` — the translated audio stream.

#### `client.drainAudio(): Promise<void>`

Waits for all pending audio playback and scheduled speech delimiters to complete. Call this before `disconnect()` on server-initiated disconnects to avoid cutting off in-flight audio.

```typescript
// On server disconnect, drain before cleanup
state.onConnectionStateChange = async (connectionState) => {
  if (connectionState === "disconnected") {
    await client.drainAudio();
    client.disconnect();
  }
};
```

#### `client.disconnect()`

Closes the connection, destroys the translation state's pending promises, and cleans up audio resources. The consumer is responsible for stopping the audio track.

#### `client.reset(options): Promise<void>`

Configures the translation session. Resolves when the server confirms it is ready.

| Option            | Type       | Description                              |
| ----------------- | ---------- | ---------------------------------------- |
| `langIn`          | `string`   | Source language code (e.g. `"en-US"`)    |
| `langOut`         | `string`   | Target language code (e.g. `"es-ES"`)    |
| `voiceId`         | `string?`  | Voice ID for translated audio            |
| `glossary`        | `string[]?`| Terms to preserve during translation     |
| `clearHistory`    | `boolean?` | Clear conversation history               |
| `canLangSwap`     | `boolean?` | Allow automatic language swapping        |
| `detectLanguages` | `boolean?` | Enable language detection                |

#### `SanasTranslationClient.fetchLanguages(credentials, options?): Promise<Language[]>`

Static method. Fetches available languages without needing a connection.

```typescript
const languages = await SanasTranslationClient.fetchLanguages({
  apiKey: "your-api-key",
  endpoint: "https://api.sanaslt.com",
});
```

### `StreamMessage`

A Zod-validated discriminated union representing all messages in the client stream. Three sub-types:

| Type        | Shape                                    | Description                    |
| ----------- | ---------------------------------------- | ------------------------------ |
| `lt`        | `{ type: "lt", lt: LTMessage }`          | Server LT message (transcription, translation, ready, etc.) |
| `transport` | `{ type: "transport", state: ConnectionState }` | Connection state change |
| `error`     | `{ type: "error", message: string }`     | Error message                  |

### `float32ToInt16(float32: Float32Array): Int16Array`

Converts Float32 PCM samples (range -1..1) to Int16 PCM. Useful when working with raw audio data from `onAudioData` or Web Audio API pipelines.

### `getMicrophoneTrack(options?): Promise<MediaStreamTrack>`

Helper to acquire a microphone audio track. The caller owns the returned track and must call `track.stop()` when done.

```typescript
const track = await getMicrophoneTrack({ sampleRate: 16000 });
```

| Option        | Type                    | Description                              |
| ------------- | ----------------------- | ---------------------------------------- |
| `sampleRate`  | `number?`               | Desired sample rate (default: 16000)     |
| `constraints` | `MediaTrackConstraints?`| Custom constraints (overrides defaults)  |

### Transports

Both transports implement the `Transport` interface. Choose one when connecting:

```typescript
import { WebRTCTransport, WebSocketTransport } from "@sanas-ai/language-translation";

const transport = new WebRTCTransport();   // or new WebSocketTransport()
await client.connect({ transport, audioTrack: track });

// Mute/unmute
transport.setAudioEnabled(false);

// Session ID (available after connect)
console.log(transport.sessionId);

// Wait for pending audio before cleanup (useful on server disconnect)
await transport.drainAudio();
```

## Test Client

A browser-based test client is included in `examples/index.html` for interactively testing the library against a live server.

To run it:

```bash
npm run build
npx serve .
```

Then open [http://localhost:3000/examples/](http://localhost:3000/examples/) in your browser. Enter your API key, configure source/target languages, and click **Connect** to start a live translation session. The example demonstrates the two-state pattern with separate local and remote utterance displays, audio file input (upload a WAV/MP3 instead of using the microphone), and output recording to WAV via the `onAudioData` callback.

## Development

```bash
npm install       # Install dependencies
npm run build     # Type-check and build to dist/
npm test          # Run tests
```

# Sanas Language Translation JS Client

A browser-based TypeScript client for real-time audio language translation using WebRTC.

## Installation

```bash
npm install @sanas-ai/language-translation
```

## Quick Start

```typescript
import { SanasTranslationClient } from "@sanas-ai/language-translation";

const client = new SanasTranslationClient({
  apiKey: "your-api-key",
  endpoint: "https://api.sanaslt.com",
});

// Listen for events
client.onUtterance((utterance, index) => {
  console.log("Transcription:", utterance.transcription.spokenText);
  console.log("Translation:", utterance.translation.spokenText);
});

client.onError((error) => {
  console.error("Error:", error);
});

// Connect (requests microphone access)
const { audio } = await client.connect();

// Play translated audio
const audioElement = document.createElement("audio");
audioElement.srcObject = audio;
audioElement.autoplay = true;

// Configure translation
await client.reset({
  langIn: "en-US",
  langOut: "es-ES",
});

// When done
client.disconnect();
```

## API

### `new SanasTranslationClient(options)`

Creates a new client instance.

| Option        | Type     | Description                                        |
| ------------- | -------- | -------------------------------------------------- |
| `apiKey`      | `string` | API key for authentication (use this or `accessToken`) |
| `accessToken` | `string` | OAuth token for authentication (use this or `apiKey`)  |
| `endpoint`    | `string` | Server URL (e.g. `https://api.sanaslt.com`)            |

### `client.fetchLanguages(options?): Promise<Language[]>`

Fetches the list of available languages from the server. Can be called without connecting.

| Option | Type     | Description                                                     |
| ------ | -------- | --------------------------------------------------------------- |
| `lang` | `string` | Language code for localized names (e.g. `"es-ES"`). Defaults to `"en-US"`. |

Returns an array of `Language` objects:

| Field       | Type     | Description                              |
| ----------- | -------- | ---------------------------------------- |
| `longCode`  | `string` | Full code with region (e.g. `"en-US"`)   |
| `shortCode` | `string` | Short code (e.g. `"en"`)                 |
| `name`      | `string` | Localized display name                   |
| `support`   | `string` | Support tier: `"alpha"`, `"beta"`, or `"stable"` |

### `client.connect(options?): Promise<ConnectResult>`

Establishes a WebRTC connection to the translation server. Requests microphone access unless a custom audio track is provided. Returns the translated audio stream.

| Option             | Type                    | Description                          |
| ------------------ | ----------------------- | ------------------------------------ |
| `conversationId`   | `string`                | Conversation ID to join              |
| `userName`         | `string`                | Display name for this participant    |
| `audioTrack`       | `MediaStreamTrack`      | Custom audio track (skips mic access)|
| `audioConstraints` | `MediaTrackConstraints` | Microphone constraints               |

Returns `{ audio: MediaStream }` — the translated audio stream to play back.

### `client.disconnect()`

Closes the connection and releases all resources (peer connection, microphone, data channel).

### `client.reset(options): Promise<void>`

Configures the translation session. Resolves when the server confirms it is ready.

| Option            | Type       | Description                              |
| ----------------- | ---------- | ---------------------------------------- |
| `langIn`          | `string`   | Source language code (e.g. `"en-US"`)    |
| `langOut`         | `string`   | Target language code (e.g. `"es-ES"`)    |
| `voiceId`         | `string`   | Voice ID for translated audio            |
| `glossary`        | `string[]` | Terms to preserve during translation     |
| `clearHistory`    | `boolean`  | Clear conversation history               |
| `canLangSwap`     | `boolean`  | Allow automatic language swapping        |
| `detectLanguages` | `boolean`  | Enable language detection                |

### Properties

| Property          | Type                     | Description                            |
| ----------------- | ------------------------ | -------------------------------------- |
| `connectionState` | `ConnectionState`        | `"disconnected"`, `"connecting"`, or `"connected"` |
| `sessionId`       | `string \| null`         | Server session ID                      |
| `error`           | `string \| null`         | Current error message                  |
| `state`           | `TranslationClientState` | Full transcription/translation state   |
| `isAudioEnabled`  | `boolean`                | Get/set microphone mute state          |

### Event Callbacks

All callbacks return an unsubscribe function.

```typescript
// Fired when an utterance is created or updated
const unsub = client.onUtterance((utterance, index) => {
  // utterance.transcription.spokenText — transcribed text already spoken
  // utterance.transcription.unspokenText — transcribed text not yet spoken
  // utterance.translation.spokenText — translated text already spoken
  // utterance.translation.unspokenText — translated text not yet spoken
});
unsub(); // stop listening

// Fired when languages are detected
client.onLanguages((languages) => {
  // languages: Array<{ shortCode: string, name: string, probability: number }>
});

// Fired when connection state changes
client.onConnectionStateChange((state) => {
  // state: "disconnected" | "connecting" | "connected"
});

// Fired on errors
client.onError((error) => {
  // error: string
});
```

## Test Client

A browser-based test client is included in `examples/index.html` for interactively testing the library against a live server.

To run it:

```bash
npx serve .
```

Then open [http://localhost:3000/examples/](http://localhost:3000/examples/) in your browser. Enter your API key, click **Fetch Languages** to see available languages, configure source/target languages, and click **Connect** to start a live translation session.

## Development

```bash
npm install       # Install dependencies
npm run build     # Type-check and build to dist/
npm test          # Run tests
```

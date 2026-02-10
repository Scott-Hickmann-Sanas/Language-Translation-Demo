import {
  TranslationState,
  TranslationStateCallbacks,
} from "../TranslationState";
import { IdentifiedLanguage, LTMessage, Word } from "../types";

function makeWord(text: string, start = 0, end = 1): Word {
  return { word: text, start, end };
}

function makeCallbacks(
  overrides: Partial<TranslationStateCallbacks> = {},
): TranslationStateCallbacks {
  return {
    onUtteranceChanged: jest.fn(),
    onLanguagesChanged: jest.fn(),
    onReady: jest.fn(),
    ...overrides,
  };
}

describe("TranslationState", () => {
  describe("handleMessage — transcription", () => {
    it("creates a new utterance on first transcription", () => {
      const callbacks = makeCallbacks();
      const state = new TranslationState(callbacks);

      const message: LTMessage = {
        type: "transcription",
        transcription: {
          complete: [makeWord("hello")],
          partial: [makeWord("wor")],
          utterance_idx: 0,
        },
      };

      state.handleMessage(message);

      const result = state.getState();
      expect(result.utterances).toHaveLength(1);
      expect(result.utterances[0].transcription.complete).toEqual([
        makeWord("hello"),
      ]);
      expect(result.utterances[0].transcription.partial).toEqual([
        makeWord("wor"),
      ]);
      expect(callbacks.onUtteranceChanged).toHaveBeenCalledTimes(1);
    });

    it("merges words into the same utterance index", () => {
      const callbacks = makeCallbacks();
      const state = new TranslationState(callbacks);

      state.handleMessage({
        type: "transcription",
        transcription: {
          complete: [makeWord("hello")],
          partial: [],
          utterance_idx: 0,
        },
      });

      state.handleMessage({
        type: "transcription",
        transcription: {
          complete: [makeWord("world")],
          partial: [],
          utterance_idx: 0,
        },
      });

      const result = state.getState();
      expect(result.utterances).toHaveLength(1);
      expect(result.utterances[0].transcription.complete).toEqual([
        makeWord("hello"),
        makeWord("world"),
      ]);
    });

    it("creates separate utterances for different indices", () => {
      const callbacks = makeCallbacks();
      const state = new TranslationState(callbacks);

      state.handleMessage({
        type: "transcription",
        transcription: {
          complete: [makeWord("first")],
          partial: [],
          utterance_idx: 0,
        },
      });

      state.handleMessage({
        type: "transcription",
        transcription: {
          complete: [makeWord("second")],
          partial: [],
          utterance_idx: 1,
        },
      });

      const result = state.getState();
      expect(result.utterances).toHaveLength(2);
    });
  });

  describe("handleMessage — translation", () => {
    it("stores translation and pairs with transcription in display", () => {
      const callbacks = makeCallbacks();
      const state = new TranslationState(callbacks);

      state.handleMessage({
        type: "transcription",
        transcription: {
          complete: [makeWord("hello")],
          partial: [],
          utterance_idx: 0,
        },
      });

      state.handleMessage({
        type: "translation",
        translation: {
          complete: [makeWord("hola")],
          partial: [],
          utterance_idx: 0,
        },
      });

      const result = state.getState();
      expect(result.utterances[0].translation.complete).toEqual([
        makeWord("hola"),
      ]);
    });

    it("ignores translation messages with empty complete array", () => {
      const callbacks = makeCallbacks();
      const state = new TranslationState(callbacks);

      state.handleMessage({
        type: "transcription",
        transcription: {
          complete: [makeWord("hello")],
          partial: [],
          utterance_idx: 0,
        },
      });

      // translation callback count before
      const callCount = (callbacks.onUtteranceChanged as jest.Mock).mock.calls
        .length;

      state.handleMessage({
        type: "translation",
        translation: {
          complete: [],
          partial: [makeWord("ho")],
          utterance_idx: 0,
        },
      });

      // Should not have been called again
      expect(callbacks.onUtteranceChanged).toHaveBeenCalledTimes(callCount);
    });
  });

  describe("handleMessage — ready", () => {
    it("calls onReady callback with the id", () => {
      const callbacks = makeCallbacks();
      const state = new TranslationState(callbacks);

      state.handleMessage({
        type: "ready",
        ready: { id: "test-id" },
      });

      expect(callbacks.onReady).toHaveBeenCalledWith("test-id");
    });

    it("preserves utterances on ready message", () => {
      const callbacks = makeCallbacks();
      const state = new TranslationState(callbacks);

      // Add some data first
      state.handleMessage({
        type: "transcription",
        transcription: {
          complete: [makeWord("hello")],
          partial: [],
          utterance_idx: 0,
        },
      });

      expect(state.getState().utterances).toHaveLength(1);

      state.handleMessage({
        type: "ready",
        ready: { id: "r1" },
      });

      // Backend does not reset utterance indices on ready, so state is preserved
      expect(state.getState().utterances).toHaveLength(1);
    });
  });

  describe("onReadyOnce", () => {
    it("fires one-time callback on ready and clears it", () => {
      const callbacks = makeCallbacks();
      const state = new TranslationState(callbacks);
      const onceCb = jest.fn();

      state.onReadyOnce(onceCb);

      state.handleMessage({ type: "ready", ready: { id: "r1" } });
      expect(onceCb).toHaveBeenCalledWith("r1");
      expect(onceCb).toHaveBeenCalledTimes(1);

      // Second ready should not fire it again
      state.handleMessage({ type: "ready", ready: { id: "r2" } });
      expect(onceCb).toHaveBeenCalledTimes(1);
    });
  });

  describe("handleMessage — languages", () => {
    it("stores identified languages and notifies", () => {
      const callbacks = makeCallbacks();
      const state = new TranslationState(callbacks);

      const langs: IdentifiedLanguage[] = [
        { short_code: "en", name: "English", probability: 0.95 },
        { short_code: "es", name: "Spanish", probability: 0.05 },
      ];

      state.handleMessage({
        type: "languages",
        languages: { languages: langs },
      });

      const expected = [
        { shortCode: "en", name: "English", probability: 0.95 },
        { shortCode: "es", name: "Spanish", probability: 0.05 },
      ];

      expect(state.identifiedLanguages).toEqual(expected);
      expect(state.getState().identifiedLanguages).toEqual(expected);
      expect(callbacks.onLanguagesChanged).toHaveBeenCalledWith(expected);
    });
  });

  describe("handleMessage — speech_delimiter", () => {
    it("stores pending delimiter and applies on updateAudioProgress", () => {
      const callbacks = makeCallbacks();
      const state = new TranslationState(callbacks);

      // Add a transcription
      state.handleMessage({
        type: "transcription",
        transcription: {
          complete: [makeWord("hello"), makeWord("world")],
          partial: [],
          utterance_idx: 0,
        },
      });

      (callbacks.onUtteranceChanged as jest.Mock).mockClear();

      // Send speech delimiter at time=0.5s
      state.handleMessage({
        type: "speech_delimiter",
        speech_delimiter: {
          time: 0.5,
          transcription: { utterance_idx: 0, word_idx: 1, char_idx: 0 },
          translation: { utterance_idx: 0, word_idx: 0, char_idx: 0 },
        },
      });
    });

    it("applies multiple delimiters in chronological order", () => {
      const callbacks = makeCallbacks();
      const state = new TranslationState(callbacks);

      state.handleMessage({
        type: "transcription",
        transcription: {
          complete: [makeWord("hello"), makeWord("world"), makeWord("!")],
          partial: [],
          utterance_idx: 0,
        },
      });

      (callbacks.onUtteranceChanged as jest.Mock).mockClear();

      // Queue two delimiters
      state.handleMessage({
        type: "speech_delimiter",
        speech_delimiter: {
          time: 0.5,
          transcription: { utterance_idx: 0, word_idx: 1, char_idx: 0 },
          translation: { utterance_idx: 0, word_idx: 0, char_idx: 0 },
        },
      });
      state.handleMessage({
        type: "speech_delimiter",
        speech_delimiter: {
          time: 1.0,
          transcription: { utterance_idx: 0, word_idx: 2, char_idx: 0 },
          translation: { utterance_idx: 0, word_idx: 0, char_idx: 0 },
        },
      });
    });
  });

  describe("resetReady", () => {
    it("preserves utterances and delimiters across ready", () => {
      const callbacks = makeCallbacks();
      const state = new TranslationState(callbacks);

      state.handleMessage({
        type: "transcription",
        transcription: {
          complete: [makeWord("hello")],
          partial: [],
          utterance_idx: 0,
        },
      });

      // Apply a delimiter
      state.handleMessage({
        type: "speech_delimiter",
        speech_delimiter: {
          time: 10,
          transcription: { utterance_idx: 0, word_idx: 1, char_idx: 0 },
          translation: { utterance_idx: 0, word_idx: 0, char_idx: 0 },
        },
      });

      // Send a ready message — backend does not reset utterance indices
      state.handleMessage({
        type: "ready",
        ready: { id: "r1" },
      });

      // Utterances and speech boundary are preserved
      expect(state.getState().utterances).toHaveLength(1);
      expect(state.getState().utterances[0].transcription.spokenText).toBe(
        "hello",
      );
    });

    it("preserves identified languages when ready=true", () => {
      const callbacks = makeCallbacks();
      const state = new TranslationState(callbacks);

      state.handleMessage({
        type: "languages",
        languages: {
          languages: [{ short_code: "en", name: "English", probability: 0.9 }],
        },
      });

      expect(state.identifiedLanguages).toHaveLength(1);
    });
  });

  describe("getState", () => {
    it("returns empty state initially", () => {
      const state = new TranslationState(makeCallbacks());
      const result = state.getState();

      expect(result.utterances).toEqual([]);
      expect(result.identifiedLanguages).toEqual([]);
    });

    it("returns all utterance displays", () => {
      const state = new TranslationState(makeCallbacks());

      state.handleMessage({
        type: "transcription",
        transcription: {
          complete: [makeWord("a")],
          partial: [],
          utterance_idx: 0,
        },
      });
      state.handleMessage({
        type: "transcription",
        transcription: {
          complete: [makeWord("b")],
          partial: [],
          utterance_idx: 1,
        },
      });

      const result = state.getState();
      expect(result.utterances).toHaveLength(2);
      expect(result.utterances[0].transcription.unspokenText).toBe("a");
      expect(result.utterances[1].transcription.unspokenText).toBe("b");
    });
  });

  describe("getUtteranceDisplay", () => {
    it("returns empty display for missing index", () => {
      const state = new TranslationState(makeCallbacks());
      const display = state.getUtteranceDisplay(0);

      expect(display.transcription.spokenText).toBe("");
      expect(display.transcription.unspokenText).toBe("");
      expect(display.translation.spokenText).toBe("");
      expect(display.translation.unspokenText).toBe("");
    });
  });

  describe("invisible utterances (non-contiguous utterance indices)", () => {
    it("handles utterance index gaps in transcriptions", () => {
      const state = new TranslationState(makeCallbacks());

      // Utterance 0 arrives, then utterance 2 (skipping invisible utterance 1)
      state.handleMessage({
        type: "transcription",
        transcription: {
          complete: [makeWord("hello")],
          partial: [],
          utterance_idx: 0,
        },
      });
      state.handleMessage({
        type: "transcription",
        transcription: {
          complete: [makeWord("world")],
          partial: [],
          utterance_idx: 2,
        },
      });

      const result = state.getState();
      expect(result.utterances).toHaveLength(2);
      expect(result.utterances[0].transcription.complete).toEqual([
        makeWord("hello"),
      ]);
      expect(result.utterances[1].transcription.complete).toEqual([
        makeWord("world"),
      ]);
    });

    it("pairs translations correctly when utterance indices have gaps", () => {
      const state = new TranslationState(makeCallbacks());

      // Transcription for utterance 0 and 2 (gap at 1)
      state.handleMessage({
        type: "transcription",
        transcription: {
          complete: [makeWord("hello")],
          partial: [],
          utterance_idx: 0,
        },
      });
      state.handleMessage({
        type: "transcription",
        transcription: {
          complete: [makeWord("world")],
          partial: [],
          utterance_idx: 2,
        },
      });

      // Translations for utterance 0 and 2
      state.handleMessage({
        type: "translation",
        translation: {
          complete: [makeWord("hola")],
          partial: [],
          utterance_idx: 0,
        },
      });
      state.handleMessage({
        type: "translation",
        translation: {
          complete: [makeWord("mundo")],
          partial: [],
          utterance_idx: 2,
        },
      });

      const result = state.getState();
      expect(result.utterances).toHaveLength(2);
      expect(result.utterances[0].translation.complete).toEqual([
        makeWord("hola"),
      ]);
      expect(result.utterances[1].translation.complete).toEqual([
        makeWord("mundo"),
      ]);
    });

    it("computes speech boundary correctly with non-contiguous indices", () => {
      const callbacks = makeCallbacks();
      const state = new TranslationState(callbacks);

      // Utterance 0 and utterance 3 (gap at 1, 2)
      state.handleMessage({
        type: "transcription",
        transcription: {
          complete: [makeWord("hello")],
          partial: [],
          utterance_idx: 0,
        },
      });
      state.handleMessage({
        type: "transcription",
        transcription: {
          complete: [makeWord("world")],
          partial: [],
          utterance_idx: 3,
        },
      });

      // Speech delimiter pointing into utterance 3
      state.handleMessage({
        type: "speech_delimiter",
        speech_delimiter: {
          time: 1.0,
          transcription: { utterance_idx: 3, word_idx: 0, char_idx: 3 },
          translation: { utterance_idx: 3, word_idx: 0, char_idx: 3 },
        },
      });

      // Utterance 0 (server idx 0) should be entirely spoken
      // since boundary is at utterance 3 which is past utterance 0
      const display0 = state.getUtteranceDisplay(0);
      expect(display0.transcription.spokenText).toBe("hello");
      expect(display0.transcription.unspokenText).toBe("");

      // Utterance at array index 1 (server idx 3) should be split at char 3
      const display1 = state.getUtteranceDisplay(1);
      expect(display1.transcription.spokenText).toBe("wor");
      expect(display1.transcription.unspokenText).toBe("ld");
    });

    it("notifies correct utterances on speech_delimiter with gaps", () => {
      const callbacks = makeCallbacks();
      const state = new TranslationState(callbacks);

      // Utterances 0, 2, 5 (gaps at 1, 3, 4)
      state.handleMessage({
        type: "transcription",
        transcription: {
          complete: [makeWord("a")],
          partial: [],
          utterance_idx: 0,
        },
      });
      state.handleMessage({
        type: "transcription",
        transcription: {
          complete: [makeWord("b")],
          partial: [],
          utterance_idx: 2,
        },
      });
      state.handleMessage({
        type: "transcription",
        transcription: {
          complete: [makeWord("c")],
          partial: [],
          utterance_idx: 5,
        },
      });

      (callbacks.onUtteranceChanged as jest.Mock).mockClear();

      // Speech delimiter spanning from utterance 0 to utterance 2
      state.handleMessage({
        type: "speech_delimiter",
        speech_delimiter: {
          time: 1.0,
          transcription: { utterance_idx: 2, word_idx: 0, char_idx: 0 },
          translation: { utterance_idx: 0, word_idx: 0, char_idx: 0 },
        },
      });

      // Should notify utterances with server idx 0 and 2 (array idx 0 and 1)
      // but NOT utterance with server idx 5 (array idx 2)
      const calls = (callbacks.onUtteranceChanged as jest.Mock).mock.calls;
      const notifiedArrayIndices = calls.map(
        (call: [unknown, number]) => call[1],
      );
      expect(notifiedArrayIndices).toContain(0);
      expect(notifiedArrayIndices).toContain(1);
      expect(notifiedArrayIndices).not.toContain(2);
    });

    it("merges words into correct utterance with non-contiguous indices", () => {
      const state = new TranslationState(makeCallbacks());

      state.handleMessage({
        type: "transcription",
        transcription: {
          complete: [makeWord("hello")],
          partial: [],
          utterance_idx: 0,
        },
      });
      state.handleMessage({
        type: "transcription",
        transcription: {
          complete: [makeWord("world")],
          partial: [],
          utterance_idx: 3,
        },
      });

      // Second message for utterance 3 should merge
      state.handleMessage({
        type: "transcription",
        transcription: {
          complete: [makeWord("!")],
          partial: [],
          utterance_idx: 3,
        },
      });

      const result = state.getState();
      expect(result.utterances).toHaveLength(2);
      expect(result.utterances[1].transcription.complete).toEqual([
        makeWord("world"),
        makeWord("!"),
      ]);
    });
  });
});

import {
  TranslationState,
  TranslationStateCallbacks,
} from "../TranslationState";
import {
  IdentifiedLanguage,
  LTMessage,
  UtteranceDisplay,
  Word,
} from "../types";

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
  beforeEach(() => {
    jest.useFakeTimers();
  });

  afterEach(() => {
    jest.useRealTimers();
  });

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

    it("resets state on ready message", () => {
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

      expect(state.getState().utterances).toHaveLength(0);
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

      expect(state.identifiedLanguages).toEqual(langs);
      expect(state.getState().identifiedLanguages).toEqual(langs);
      expect(callbacks.onLanguagesChanged).toHaveBeenCalledWith(langs);
    });
  });

  describe("handleMessage — speech_delimiter", () => {
    it("schedules boundary update and notifies affected utterances", () => {
      const callbacks = makeCallbacks();
      const state = new TranslationState(callbacks);

      // Reset to set the resetTime
      state.resetReady(true);

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

      // Send speech delimiter at time=0 (should fire immediately since resetTime is ~now)
      state.handleMessage({
        type: "speech_delimiter",
        speech_delimiter: {
          time: 0,
          transcription: { utterance_idx: 0, word_idx: 1, char_idx: 0 },
          translation: { utterance_idx: 0, word_idx: 0, char_idx: 0 },
        },
      });

      // Timer should be pending
      jest.runAllTimers();

      expect(callbacks.onUtteranceChanged).toHaveBeenCalled();
      const display: UtteranceDisplay = (
        callbacks.onUtteranceChanged as jest.Mock
      ).mock.calls[0][0];
      // "hello" should be spoken, "world" unspoken (boundary at word_idx=1)
      expect(display.transcription.spokenText).toBe("hello");
      expect(display.transcription.unspokenText).toBe("world");
    });
  });

  describe("resetReady", () => {
    it("clears all state and pending timeouts", () => {
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

      // Schedule a delimiter
      state.handleMessage({
        type: "speech_delimiter",
        speech_delimiter: {
          time: 10,
          transcription: { utterance_idx: 0, word_idx: 1, char_idx: 0 },
          translation: { utterance_idx: 0, word_idx: 0, char_idx: 0 },
        },
      });

      state.resetReady(false);

      expect(state.getState().utterances).toHaveLength(0);
      expect(state.identifiedLanguages).toEqual([]);

      // Running timers should not cause errors (timeouts were cleared)
      jest.runAllTimers();
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

      state.resetReady(true);

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

  describe("destroy", () => {
    it("clears pending timeouts and onReadyOnce callbacks", () => {
      const callbacks = makeCallbacks();
      const state = new TranslationState(callbacks);
      const onceCb = jest.fn();

      state.onReadyOnce(onceCb);

      state.handleMessage({
        type: "speech_delimiter",
        speech_delimiter: {
          time: 100,
          transcription: { utterance_idx: 0, word_idx: 0, char_idx: 0 },
          translation: { utterance_idx: 0, word_idx: 0, char_idx: 0 },
        },
      });

      state.destroy();

      // onReadyOnce should not fire
      state.handleMessage({ type: "ready", ready: { id: "r1" } });
      expect(onceCb).not.toHaveBeenCalled();

      // Timers should not cause issues
      jest.runAllTimers();
    });
  });
});

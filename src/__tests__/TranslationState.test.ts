import { TranslationState } from "../TranslationState";
import {
  IdentifiedLanguage,
  LTMessage,
  StreamMessage,
  TranslationStateCallbacks,
  Word,
} from "../types";

function makeWord(text: string, start = 0, end = 1): Word {
  return { word: text, start, end };
}

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

function lt(msg: LTMessage): StreamMessage {
  return { type: "lt", lt: msg };
}

async function flush() {
  for (let i = 0; i < 5; i++) {
    await new Promise((resolve) => setTimeout(resolve, 0));
  }
}

describe("TranslationState", () => {
  describe("handleMessage — transcription (via StreamMessage)", () => {
    it("creates a new utterance on first transcription", () => {
      const callbacks = makeCallbacks();
      const state = new TranslationState(callbacks);

      state.handleMessage(
        lt({
          type: "transcription",
          transcription: {
            complete: [makeWord("hello")],
            partial: [makeWord("wor")],
            utterance_idx: 0,
          },
        }),
      );

      const result = state.getState();
      expect(result.utterances).toHaveLength(1);
      expect(result.utterances[0].transcription.complete).toEqual([
        makeWord("hello"),
      ]);
      expect(result.utterances[0].transcription.partial).toEqual([
        makeWord("wor"),
      ]);
      expect(callbacks.onUtterance).toHaveBeenCalledTimes(1);
    });

    it("merges words into the same utterance index", () => {
      const callbacks = makeCallbacks();
      const state = new TranslationState(callbacks);

      state.handleMessage(
        lt({
          type: "transcription",
          transcription: {
            complete: [makeWord("hello")],
            partial: [],
            utterance_idx: 0,
          },
        }),
      );

      state.handleMessage(
        lt({
          type: "transcription",
          transcription: {
            complete: [makeWord("world")],
            partial: [],
            utterance_idx: 0,
          },
        }),
      );

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

      state.handleMessage(
        lt({
          type: "transcription",
          transcription: {
            complete: [makeWord("first")],
            partial: [],
            utterance_idx: 0,
          },
        }),
      );

      state.handleMessage(
        lt({
          type: "transcription",
          transcription: {
            complete: [makeWord("second")],
            partial: [],
            utterance_idx: 1,
          },
        }),
      );

      const result = state.getState();
      expect(result.utterances).toHaveLength(2);
    });
  });

  describe("handleMessage — translation (via StreamMessage)", () => {
    it("stores translation and pairs with transcription in display", () => {
      const callbacks = makeCallbacks();
      const state = new TranslationState(callbacks);

      state.handleMessage(
        lt({
          type: "transcription",
          transcription: {
            complete: [makeWord("hello")],
            partial: [],
            utterance_idx: 0,
          },
        }),
      );

      state.handleMessage(
        lt({
          type: "translation",
          translation: {
            complete: [makeWord("hola")],
            partial: [],
            utterance_idx: 0,
          },
        }),
      );

      const result = state.getState();
      expect(result.utterances[0].translation.complete).toEqual([
        makeWord("hola"),
      ]);
    });

    it("ignores translation messages with empty complete array", () => {
      const callbacks = makeCallbacks();
      const state = new TranslationState(callbacks);

      state.handleMessage(
        lt({
          type: "transcription",
          transcription: {
            complete: [makeWord("hello")],
            partial: [],
            utterance_idx: 0,
          },
        }),
      );

      const callCount = (callbacks.onUtterance as jest.Mock).mock.calls.length;

      state.handleMessage(
        lt({
          type: "translation",
          translation: {
            complete: [],
            partial: [makeWord("ho")],
            utterance_idx: 0,
          },
        }),
      );

      expect(callbacks.onUtterance).toHaveBeenCalledTimes(callCount);
    });
  });

  describe("handleMessage — ready (via StreamMessage)", () => {
    it("calls onReady callback with the id", () => {
      const callbacks = makeCallbacks();
      const state = new TranslationState(callbacks);

      state.handleMessage(lt({ type: "ready", ready: { id: "test-id" } }));

      expect(callbacks.onReady).toHaveBeenCalledWith("test-id");
    });

    it("preserves utterances on ready message", () => {
      const callbacks = makeCallbacks();
      const state = new TranslationState(callbacks);

      state.handleMessage(
        lt({
          type: "transcription",
          transcription: {
            complete: [makeWord("hello")],
            partial: [],
            utterance_idx: 0,
          },
        }),
      );

      expect(state.getState().utterances).toHaveLength(1);

      state.handleMessage(lt({ type: "ready", ready: { id: "r1" } }));

      expect(state.getState().utterances).toHaveLength(1);
    });
  });

  describe("waitForReady", () => {
    it("resolves when matching ready message arrives", async () => {
      const callbacks = makeCallbacks();
      const state = new TranslationState(callbacks);

      const promise = state.waitForReady("r1");

      state.handleMessage(lt({ type: "ready", ready: { id: "r1" } }));

      await expect(promise).resolves.toBeUndefined();
    });

    it("does not resolve for non-matching ready id", async () => {
      const callbacks = makeCallbacks();
      const state = new TranslationState(callbacks);

      const promise = state.waitForReady("r1");
      let resolved = false;
      promise.then(() => {
        resolved = true;
      });

      state.handleMessage(lt({ type: "ready", ready: { id: "r2" } }));
      await flush();

      expect(resolved).toBe(false);
    });

    it("is rejected on destroy", async () => {
      const callbacks = makeCallbacks();
      const state = new TranslationState(callbacks);

      const promise = state.waitForReady("r1");

      state.destroy();

      await expect(promise).rejects.toThrow("Disconnected");
    });
  });

  describe("handleMessage — languages (via StreamMessage)", () => {
    it("stores identified languages and notifies", () => {
      const callbacks = makeCallbacks();
      const state = new TranslationState(callbacks);

      const langs: IdentifiedLanguage[] = [
        { short_code: "en", name: "English", probability: 0.95 },
        { short_code: "es", name: "Spanish", probability: 0.05 },
      ];

      state.handleMessage(
        lt({ type: "languages", languages: { languages: langs } }),
      );

      const expected = [
        { shortCode: "en", name: "English", probability: 0.95 },
        { shortCode: "es", name: "Spanish", probability: 0.05 },
      ];

      expect(state.identifiedLanguages).toEqual(expected);
      expect(state.getState().identifiedLanguages).toEqual(expected);
      expect(callbacks.onLanguages).toHaveBeenCalledWith(expected);
    });
  });

  describe("handleMessage — speech_delimiter (via StreamMessage)", () => {
    it("updates speech boundary and notifies affected utterances", () => {
      const callbacks = makeCallbacks();
      const state = new TranslationState(callbacks);

      state.handleMessage(
        lt({
          type: "transcription",
          transcription: {
            complete: [makeWord("hello"), makeWord("world")],
            partial: [],
            utterance_idx: 0,
          },
        }),
      );

      (callbacks.onUtterance as jest.Mock).mockClear();

      state.handleMessage(
        lt({
          type: "speech_delimiter",
          speech_delimiter: {
            time: 0.5,
            transcription: { utterance_idx: 0, word_idx: 1, char_idx: 0 },
            translation: { utterance_idx: 0, word_idx: 0, char_idx: 0 },
          },
        }),
      );

      expect(callbacks.onUtterance).toHaveBeenCalled();
      const display = state.getUtteranceDisplay(0);
      expect(display.transcription.spokenText).toBe("hello");
    });

    it("applies multiple delimiters in chronological order", () => {
      const callbacks = makeCallbacks();
      const state = new TranslationState(callbacks);

      state.handleMessage(
        lt({
          type: "transcription",
          transcription: {
            complete: [makeWord("hello"), makeWord("world"), makeWord("!")],
            partial: [],
            utterance_idx: 0,
          },
        }),
      );

      (callbacks.onUtterance as jest.Mock).mockClear();

      state.handleMessage(
        lt({
          type: "speech_delimiter",
          speech_delimiter: {
            time: 0.5,
            transcription: { utterance_idx: 0, word_idx: 1, char_idx: 0 },
            translation: { utterance_idx: 0, word_idx: 0, char_idx: 0 },
          },
        }),
      );
      state.handleMessage(
        lt({
          type: "speech_delimiter",
          speech_delimiter: {
            time: 1.0,
            transcription: { utterance_idx: 0, word_idx: 2, char_idx: 0 },
            translation: { utterance_idx: 0, word_idx: 0, char_idx: 0 },
          },
        }),
      );

      const display = state.getUtteranceDisplay(0);
      expect(display.transcription.spokenText).toBe("helloworld");
      expect(display.transcription.unspokenText).toBe("!");
    });
  });

  describe("handleMessage — transport (connection state)", () => {
    it("calls onConnectionStateChange callback", () => {
      const callbacks = makeCallbacks();
      const state = new TranslationState(callbacks);

      state.handleMessage({ type: "transport", state: "connecting" });

      expect(callbacks.onConnectionStateChange).toHaveBeenCalledWith(
        "connecting",
      );
    });

    it("does not notify when state is unchanged", () => {
      const callbacks = makeCallbacks();
      const state = new TranslationState(callbacks);

      state.handleMessage({ type: "transport", state: "connecting" });
      state.handleMessage({ type: "transport", state: "connecting" });

      expect(callbacks.onConnectionStateChange).toHaveBeenCalledTimes(1);
    });

    it("exposes connectionState getter", () => {
      const state = new TranslationState(makeCallbacks());

      expect(state.connectionState).toBe("disconnected");

      state.handleMessage({ type: "transport", state: "connected" });

      expect(state.connectionState).toBe("connected");
    });
  });

  describe("handleMessage — error", () => {
    it("calls onError callback", () => {
      const callbacks = makeCallbacks();
      const state = new TranslationState(callbacks);

      state.handleMessage({ type: "error", message: "something went wrong" });

      expect(callbacks.onError).toHaveBeenCalledWith("something went wrong");
    });
  });

  describe("missing callbacks don't throw", () => {
    it("handles all message types with empty callbacks", () => {
      const state = new TranslationState();

      expect(() => {
        state.handleMessage(
          lt({
            type: "transcription",
            transcription: {
              complete: [makeWord("hello")],
              partial: [],
              utterance_idx: 0,
            },
          }),
        );
        state.handleMessage(
          lt({
            type: "translation",
            translation: {
              complete: [makeWord("hola")],
              partial: [],
              utterance_idx: 0,
            },
          }),
        );
        state.handleMessage(lt({ type: "ready", ready: { id: "r1" } }));
        state.handleMessage(
          lt({
            type: "languages",
            languages: {
              languages: [
                { short_code: "en", name: "English", probability: 0.9 },
              ],
            },
          }),
        );
        state.handleMessage(
          lt({
            type: "speech_languages",
            speech_languages: { lang_in: "en-US", lang_out: "es-ES" },
          }),
        );
        state.handleMessage(lt({ type: "speech_stop", speech_stop: {} }));
        state.handleMessage(
          lt({
            type: "speech_delimiter",
            speech_delimiter: {
              time: 0.5,
              transcription: { utterance_idx: 0, word_idx: 1, char_idx: 0 },
              translation: { utterance_idx: 0, word_idx: 0, char_idx: 0 },
            },
          }),
        );
        state.handleMessage({ type: "transport", state: "connected" });
        state.handleMessage({ type: "error", message: "test error" });
      }).not.toThrow();
    });
  });

  describe("resetReady", () => {
    it("preserves utterances and delimiters across ready", () => {
      const callbacks = makeCallbacks();
      const state = new TranslationState(callbacks);

      state.handleMessage(
        lt({
          type: "transcription",
          transcription: {
            complete: [makeWord("hello")],
            partial: [],
            utterance_idx: 0,
          },
        }),
      );

      state.handleMessage(
        lt({
          type: "speech_delimiter",
          speech_delimiter: {
            time: 10,
            transcription: { utterance_idx: 0, word_idx: 1, char_idx: 0 },
            translation: { utterance_idx: 0, word_idx: 0, char_idx: 0 },
          },
        }),
      );

      state.handleMessage(lt({ type: "ready", ready: { id: "r1" } }));

      expect(state.getState().utterances).toHaveLength(1);
      expect(state.getState().utterances[0].transcription.spokenText).toBe(
        "hello",
      );
    });

    it("preserves identified languages when ready=true", () => {
      const callbacks = makeCallbacks();
      const state = new TranslationState(callbacks);

      state.handleMessage(
        lt({
          type: "languages",
          languages: {
            languages: [
              { short_code: "en", name: "English", probability: 0.9 },
            ],
          },
        }),
      );

      expect(state.identifiedLanguages).toHaveLength(1);
    });
  });

  describe("handleMessage — speech_languages (via StreamMessage)", () => {
    it("calls onSpeechLanguages callback with lang_in and lang_out", () => {
      const callbacks = makeCallbacks();
      const state = new TranslationState(callbacks);

      state.handleMessage(
        lt({
          type: "speech_languages",
          speech_languages: {
            lang_in: "en-US",
            lang_out: "es-ES",
          },
        }),
      );

      expect(callbacks.onSpeechLanguages).toHaveBeenCalledWith(
        "en-US",
        "es-ES",
      );
      expect(callbacks.onSpeechLanguages).toHaveBeenCalledTimes(1);
    });

    it("calls onSpeechLanguages each time a message arrives", () => {
      const callbacks = makeCallbacks();
      const state = new TranslationState(callbacks);

      state.handleMessage(
        lt({
          type: "speech_languages",
          speech_languages: { lang_in: "en-US", lang_out: "es-ES" },
        }),
      );
      state.handleMessage(
        lt({
          type: "speech_languages",
          speech_languages: { lang_in: "fr-FR", lang_out: "de-DE" },
        }),
      );

      expect(callbacks.onSpeechLanguages).toHaveBeenCalledTimes(2);
      expect(callbacks.onSpeechLanguages).toHaveBeenLastCalledWith(
        "fr-FR",
        "de-DE",
      );
    });
  });

  describe("handleMessage — speech_stop (via StreamMessage)", () => {
    it("calls onSpeechStop callback", () => {
      const callbacks = makeCallbacks();
      const state = new TranslationState(callbacks);

      state.handleMessage(lt({ type: "speech_stop", speech_stop: {} }));

      expect(callbacks.onSpeechStop).toHaveBeenCalledTimes(1);
    });

    it("calls onSpeechStop each time a message arrives", () => {
      const callbacks = makeCallbacks();
      const state = new TranslationState(callbacks);

      state.handleMessage(lt({ type: "speech_stop", speech_stop: {} }));
      state.handleMessage(lt({ type: "speech_stop", speech_stop: {} }));

      expect(callbacks.onSpeechStop).toHaveBeenCalledTimes(2);
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

      state.handleMessage(
        lt({
          type: "transcription",
          transcription: {
            complete: [makeWord("a")],
            partial: [],
            utterance_idx: 0,
          },
        }),
      );
      state.handleMessage(
        lt({
          type: "transcription",
          transcription: {
            complete: [makeWord("b")],
            partial: [],
            utterance_idx: 1,
          },
        }),
      );

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

      state.handleMessage(
        lt({
          type: "transcription",
          transcription: {
            complete: [makeWord("hello")],
            partial: [],
            utterance_idx: 0,
          },
        }),
      );
      state.handleMessage(
        lt({
          type: "transcription",
          transcription: {
            complete: [makeWord("world")],
            partial: [],
            utterance_idx: 2,
          },
        }),
      );

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

      state.handleMessage(
        lt({
          type: "transcription",
          transcription: {
            complete: [makeWord("hello")],
            partial: [],
            utterance_idx: 0,
          },
        }),
      );
      state.handleMessage(
        lt({
          type: "transcription",
          transcription: {
            complete: [makeWord("world")],
            partial: [],
            utterance_idx: 2,
          },
        }),
      );

      state.handleMessage(
        lt({
          type: "translation",
          translation: {
            complete: [makeWord("hola")],
            partial: [],
            utterance_idx: 0,
          },
        }),
      );
      state.handleMessage(
        lt({
          type: "translation",
          translation: {
            complete: [makeWord("mundo")],
            partial: [],
            utterance_idx: 2,
          },
        }),
      );

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

      state.handleMessage(
        lt({
          type: "transcription",
          transcription: {
            complete: [makeWord("hello")],
            partial: [],
            utterance_idx: 0,
          },
        }),
      );
      state.handleMessage(
        lt({
          type: "transcription",
          transcription: {
            complete: [makeWord("world")],
            partial: [],
            utterance_idx: 3,
          },
        }),
      );

      state.handleMessage(
        lt({
          type: "speech_delimiter",
          speech_delimiter: {
            time: 1.0,
            transcription: { utterance_idx: 3, word_idx: 0, char_idx: 3 },
            translation: { utterance_idx: 3, word_idx: 0, char_idx: 3 },
          },
        }),
      );

      const display0 = state.getUtteranceDisplay(0);
      expect(display0.transcription.spokenText).toBe("hello");
      expect(display0.transcription.unspokenText).toBe("");

      const display1 = state.getUtteranceDisplay(1);
      expect(display1.transcription.spokenText).toBe("wor");
      expect(display1.transcription.unspokenText).toBe("ld");
    });

    it("notifies correct utterances on speech_delimiter with gaps", () => {
      const callbacks = makeCallbacks();
      const state = new TranslationState(callbacks);

      state.handleMessage(
        lt({
          type: "transcription",
          transcription: {
            complete: [makeWord("a")],
            partial: [],
            utterance_idx: 0,
          },
        }),
      );
      state.handleMessage(
        lt({
          type: "transcription",
          transcription: {
            complete: [makeWord("b")],
            partial: [],
            utterance_idx: 2,
          },
        }),
      );
      state.handleMessage(
        lt({
          type: "transcription",
          transcription: {
            complete: [makeWord("c")],
            partial: [],
            utterance_idx: 5,
          },
        }),
      );

      (callbacks.onUtterance as jest.Mock).mockClear();

      state.handleMessage(
        lt({
          type: "speech_delimiter",
          speech_delimiter: {
            time: 1.0,
            transcription: { utterance_idx: 2, word_idx: 0, char_idx: 0 },
            translation: { utterance_idx: 0, word_idx: 0, char_idx: 0 },
          },
        }),
      );

      const calls = (callbacks.onUtterance as jest.Mock).mock.calls;
      const notifiedArrayIndices = calls.map(
        (call: [unknown, number]) => call[1],
      );
      expect(notifiedArrayIndices).toContain(0);
      expect(notifiedArrayIndices).toContain(1);
      expect(notifiedArrayIndices).not.toContain(2);
    });

    it("merges words into correct utterance with non-contiguous indices", () => {
      const state = new TranslationState(makeCallbacks());

      state.handleMessage(
        lt({
          type: "transcription",
          transcription: {
            complete: [makeWord("hello")],
            partial: [],
            utterance_idx: 0,
          },
        }),
      );
      state.handleMessage(
        lt({
          type: "transcription",
          transcription: {
            complete: [makeWord("world")],
            partial: [],
            utterance_idx: 3,
          },
        }),
      );

      state.handleMessage(
        lt({
          type: "transcription",
          transcription: {
            complete: [makeWord("!")],
            partial: [],
            utterance_idx: 3,
          },
        }),
      );

      const result = state.getState();
      expect(result.utterances).toHaveLength(2);
      expect(result.utterances[1].transcription.complete).toEqual([
        makeWord("world"),
        makeWord("!"),
      ]);
    });
  });
});

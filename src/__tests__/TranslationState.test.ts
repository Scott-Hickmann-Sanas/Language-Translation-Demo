import { TranslationState } from "../TranslationState";
import { StreamMessage, TranslationStateCallbacks, Word } from "../types";

function makeWord(text: string, start = 0, end = 1): Word {
  return { word: text, start, end };
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

async function tick(): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, 0));
}

describe("TranslationState", () => {
  it("updates transcription and translation from direct v3 messages", () => {
    const callbacks = makeCallbacks();
    const state = new TranslationState(callbacks);

    state.handleMessage({
      type: "transcription",
      utterance_idx: 0,
      complete: [makeWord("hello")],
      partial: [makeWord("wor")],
    });
    state.handleMessage({
      type: "translation",
      utterance_idx: 0,
      complete: [makeWord("hola")],
      partial: [],
    });

    const display = state.getUtteranceDisplay(0);
    expect(display.transcription.complete).toEqual([makeWord("hello")]);
    expect(display.transcription.partial).toEqual([makeWord("wor")]);
    expect(display.translation.complete).toEqual([makeWord("hola")]);
    expect(callbacks.onUtterance).toHaveBeenCalledTimes(2);
  });

  it("merges updates for the same utterance index", () => {
    const state = new TranslationState(makeCallbacks());

    state.handleMessage({
      type: "transcription",
      utterance_idx: 0,
      complete: [makeWord("hello")],
      partial: [],
    });
    state.handleMessage({
      type: "transcription",
      utterance_idx: 0,
      complete: [makeWord("world")],
      partial: [],
    });

    expect(state.getState().utterances).toHaveLength(1);
    expect(state.getUtteranceDisplay(0).transcription.complete).toEqual([
      makeWord("hello"),
      makeWord("world"),
    ]);
  });

  it("resolves configured waiters by request_id", async () => {
    const callbacks = makeCallbacks();
    const state = new TranslationState(callbacks);
    const wait = state.waitForConfigured("cfg-1");

    state.handleMessage({ type: "configured", request_id: "cfg-1" });

    await expect(wait).resolves.toBeUndefined();
    expect(callbacks.onConfigured).toHaveBeenCalledWith("cfg-1");
  });

  it("does not resolve configured waiters for a different request_id", async () => {
    const state = new TranslationState(makeCallbacks());
    let resolved = false;
    void state.waitForConfigured("cfg-1").then(() => {
      resolved = true;
    });

    state.handleMessage({ type: "configured", request_id: "cfg-2" });
    await tick();

    expect(resolved).toBe(false);
  });

  it("applies output_text_boundary positions using the message utterance index", () => {
    const callbacks = makeCallbacks();
    const state = new TranslationState(callbacks);
    state.handleMessage({
      type: "transcription",
      utterance_idx: 0,
      complete: [makeWord("hello")],
      partial: [],
    });
    state.handleMessage({
      type: "translation",
      utterance_idx: 0,
      complete: [makeWord("hola")],
      partial: [],
    });

    state.handleMessage({
      type: "output_text_boundary",
      utterance_idx: 0,
      output_time: 1.5,
      transcription: { word_idx: 0, char_idx: 2 },
      translation: { word_idx: 0, char_idx: 3 },
    });

    const display = state.getUtteranceDisplay(0);
    expect(display.transcription.spokenText).toBe("he");
    expect(display.transcription.unspokenText).toBe("llo");
    expect(display.translation.spokenText).toBe("hol");
    expect(display.translation.unspokenText).toBe("a");
  });

  it("ignores output_text_boundary positions that move backwards", () => {
    const state = new TranslationState(makeCallbacks());
    state.handleMessage({
      type: "transcription",
      utterance_idx: 0,
      complete: [makeWord("hello")],
      partial: [],
    });

    state.handleMessage({
      type: "output_text_boundary",
      utterance_idx: 0,
      output_time: 1,
      transcription: { word_idx: 0, char_idx: 4 },
    });
    state.handleMessage({
      type: "output_text_boundary",
      utterance_idx: 0,
      output_time: 2,
      transcription: { word_idx: 0, char_idx: 1 },
    });

    expect(state.getUtteranceDisplay(0).transcription.spokenText).toBe("hell");
  });

  it("updates identified languages from identified_languages", () => {
    const callbacks = makeCallbacks();
    const state = new TranslationState(callbacks);

    state.handleMessage({
      type: "identified_languages",
      languages: [{ short_code: "en", name: "English", probability: 0.9 }],
    });

    expect(state.identifiedLanguages).toEqual([
      { shortCode: "en", name: "English", probability: 0.9 },
    ]);
    expect(callbacks.onLanguages).toHaveBeenCalledWith(
      state.identifiedLanguages,
    );
  });

  it("routes v3 lifecycle callbacks", async () => {
    const callbacks = makeCallbacks();
    const state = new TranslationState(callbacks);
    const flushWait = state.waitForFlushed("flush-1");

    const messages: StreamMessage[] = [
      {
        type: "language_route",
        utterance_idx: 4,
        lang_in: "en",
        lang_out: "es",
      },
      { type: "translation_ended", utterance_idx: 4 },
      { type: "output_speech_ended", utterance_idx: 4, output_time: 3.2 },
      { type: "flushed", request_id: "flush-1" },
      { type: "error", message: "boom", code: "ERR" },
      { type: "transport", state: "connected" },
    ];

    for (const message of messages) {
      state.handleMessage(message);
    }

    await expect(flushWait).resolves.toBeUndefined();
    expect(callbacks.onLanguageRoute).toHaveBeenCalledWith("en", "es", 4);
    expect(callbacks.onTranslationEnded).toHaveBeenCalledWith(4);
    expect(callbacks.onOutputSpeechEnded).toHaveBeenCalledWith(4, 3.2);
    expect(callbacks.onFlushed).toHaveBeenCalledWith("flush-1");
    expect(callbacks.onError).toHaveBeenCalledWith("boom");
    expect(callbacks.onConnectionStateChange).toHaveBeenCalledWith("connected");
  });
});

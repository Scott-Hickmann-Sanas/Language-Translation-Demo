import {
  ConnectionState,
  IdentifiedLanguageDisplay,
  StreamMessage,
  TranslationClientState,
  TranslationStateCallbacks,
  Utterance,
  UtteranceDisplay,
  UtteranceStreamDisplay,
  Word,
} from "./types";

interface CharacterPosition {
  utteranceIdx: number;
  wordIdx: number;
  charIdx: number;
}

const ZERO_POSITION: CharacterPosition = {
  utteranceIdx: 0,
  wordIdx: 0,
  charIdx: 0,
};

function updateUtterances(
  prev: Utterance[],
  complete: Word[],
  partial: Word[],
  utteranceIdx: number,
): Utterance[] {
  const utterance: Utterance = {
    complete,
    partial,
    idx: utteranceIdx,
    isFromSelf: true,
    createdAt: Date.now(),
    updatedAt: Date.now(),
  };

  const lastUtterance = prev[prev.length - 1];
  if (lastUtterance?.idx === utterance.idx) {
    const merged: Utterance = {
      ...lastUtterance,
      complete: [...lastUtterance.complete, ...utterance.complete],
      partial: utterance.partial,
      updatedAt: Date.now(),
    };
    return [...prev.slice(0, -1), merged];
  } else {
    return [...prev, utterance];
  }
}

function getWord(utterance: Utterance, wordIdx: number): Word | undefined {
  if (wordIdx < utterance.complete.length) {
    return utterance.complete[wordIdx];
  }
  const partialIdx = wordIdx - utterance.complete.length;
  if (partialIdx < utterance.partial.length) {
    return utterance.partial[partialIdx];
  }
  return undefined;
}

function positionLessThan(a: CharacterPosition, b: CharacterPosition): boolean {
  if (a.utteranceIdx !== b.utteranceIdx) return a.utteranceIdx < b.utteranceIdx;
  if (a.wordIdx !== b.wordIdx) return a.wordIdx < b.wordIdx;
  return a.charIdx < b.charIdx;
}

/**
 * Compute spoken/unspoken text for a single utterance given its server
 * utterance index and the global speech boundary.
 */
function computeSpeechDividedText(
  utterance: Utterance,
  utteranceIdx: number,
  boundary: CharacterPosition,
): { spokenText: string; unspokenText: string } {
  let spokenText = "";
  let unspokenText = "";

  const totalWords = utterance.complete.length + utterance.partial.length;
  for (let wordIdx = 0; wordIdx < totalWords; wordIdx++) {
    const word = getWord(utterance, wordIdx);
    if (!word) continue;
    for (let charIdx = 0; charIdx < word.word.length; charIdx++) {
      const pos: CharacterPosition = {
        utteranceIdx,
        wordIdx,
        charIdx,
      };
      if (positionLessThan(pos, boundary)) {
        spokenText += word.word[charIdx];
      } else {
        unspokenText += word.word[charIdx];
      }
    }
  }

  return { spokenText, unspokenText };
}

function buildUtteranceStreamDisplay(
  utterance: Utterance | undefined,
  utteranceIdx: number,
  boundary: CharacterPosition,
): UtteranceStreamDisplay {
  if (!utterance) {
    return {
      spokenText: "",
      unspokenText: "",
      complete: [],
      partial: [],
    };
  }

  const { spokenText, unspokenText } = computeSpeechDividedText(
    utterance,
    utteranceIdx,
    boundary,
  );

  return {
    spokenText,
    unspokenText,
    complete: utterance.complete,
    partial: utterance.partial,
  };
}

export class TranslationState {
  private transcriptions: Utterance[] = [];
  private translations: Utterance[] = [];
  private _connectionState: ConnectionState = "disconnected";
  private transcriptionsSpeechBoundary: CharacterPosition = {
    ...ZERO_POSITION,
  };
  private translationsSpeechBoundary: CharacterPosition = {
    ...ZERO_POSITION,
  };
  private _identifiedLanguages: IdentifiedLanguageDisplay[] = [];
  private callbacks: TranslationStateCallbacks;
  private _configuredPromises: Map<
    string | null,
    { resolve: () => void; reject: (error: Error) => void }[]
  > = new Map();
  private _flushedPromises: Map<
    string | null,
    { resolve: () => void; reject: (error: Error) => void }[]
  > = new Map();

  constructor(callbacks: TranslationStateCallbacks = {}) {
    this.callbacks = callbacks;
  }

  get connectionState(): ConnectionState {
    return this._connectionState;
  }

  get identifiedLanguages(): IdentifiedLanguageDisplay[] {
    return this._identifiedLanguages;
  }

  handleMessage(message: StreamMessage): void {
    switch (message.type) {
      case "transport":
        if (this._connectionState !== message.state) {
          this._connectionState = message.state;
          this.callbacks.onConnectionStateChange?.(message.state);
        }
        break;
      case "transcription": {
        const { complete, partial, utterance_idx: utteranceIdx } = message;

        this.transcriptions = updateUtterances(
          this.transcriptions,
          complete,
          partial,
          utteranceIdx,
        );

        this.notifyUtteranceByIdx(utteranceIdx);
        break;
      }
      case "translation": {
        const { complete, partial, utterance_idx: utteranceIdx } = message;

        if (complete.length > 0) {
          this.translations = updateUtterances(
            this.translations,
            complete,
            partial,
            utteranceIdx,
          );

          this.notifyUtteranceByIdx(utteranceIdx);
        }
        break;
      }
      case "configured": {
        const requestId = message.request_id ?? null;
        this.resolveConfigured(requestId);
        this.callbacks.onConfigured?.(requestId);
        break;
      }
      case "output_text_boundary": {
        this.handleOutputTextBoundary(message);
        break;
      }
      case "identified_languages": {
        this._identifiedLanguages = message.languages.map((l) => ({
          shortCode: l.short_code,
          name: l.name,
          probability: l.probability,
        }));
        this.callbacks.onLanguages?.(this._identifiedLanguages);
        break;
      }
      case "language_route": {
        this.callbacks.onLanguageRoute?.(
          message.lang_in,
          message.lang_out,
          message.utterance_idx,
        );
        break;
      }
      case "output_speech_ended": {
        this.callbacks.onOutputSpeechEnded?.(
          message.utterance_idx,
          message.output_time,
        );
        break;
      }
      case "translation_ended": {
        this.callbacks.onTranslationEnded?.(message.utterance_idx);
        break;
      }
      case "flushed": {
        const requestId = message.request_id ?? null;
        this.resolveFlushed(requestId);
        this.callbacks.onFlushed?.(requestId);
        break;
      }
      case "error": {
        this.callbacks.onError?.(message.message);
        break;
      }
      case "input_speech_started":
      case "transcription_ended":
      case "input_speech_ended":
      case "output_speech_started":
        break;
    }
  }

  waitForConfigured(requestId: string | null): Promise<void> {
    return new Promise((resolve, reject) => {
      const configuredPromises = this._configuredPromises.get(requestId) ?? [];
      configuredPromises.push({ resolve, reject });
      this._configuredPromises.set(requestId, configuredPromises);
    });
  }

  waitForFlushed(requestId: string | null): Promise<void> {
    return new Promise((resolve, reject) => {
      const flushedPromises = this._flushedPromises.get(requestId) ?? [];
      flushedPromises.push({ resolve, reject });
      this._flushedPromises.set(requestId, flushedPromises);
    });
  }

  destroy(): void {
    this._configuredPromises.forEach((configuredPromises) => {
      for (const { reject } of configuredPromises) {
        reject(new Error("Disconnected"));
      }
    });
    this._configuredPromises.clear();

    this._flushedPromises.forEach((flushedPromises) => {
      for (const { reject } of flushedPromises) {
        reject(new Error("Disconnected"));
      }
    });
    this._flushedPromises.clear();
  }

  getUtteranceDisplay(index: number): UtteranceDisplay {
    const transcription = this.transcriptions[index];
    const transcriptionUtteranceIdx = transcription?.idx ?? index;
    const translation = this.findTranslationForUtterance(
      transcriptionUtteranceIdx,
    );

    return {
      transcription: buildUtteranceStreamDisplay(
        transcription,
        transcriptionUtteranceIdx,
        this.transcriptionsSpeechBoundary,
      ),
      translation: buildUtteranceStreamDisplay(
        translation?.utterance,
        translation?.utterance?.idx ?? transcriptionUtteranceIdx,
        this.translationsSpeechBoundary,
      ),
    };
  }

  getState(): TranslationClientState {
    const utterances: UtteranceDisplay[] = [];
    for (let i = 0; i < this.transcriptions.length; i++) {
      utterances.push(this.getUtteranceDisplay(i));
    }
    return {
      utterances,
      identifiedLanguages: this._identifiedLanguages,
    };
  }

  private handleOutputTextBoundary(message: {
    utterance_idx: number;
    transcription?: { word_idx: number; char_idx: number } | null;
    translation?: { word_idx: number; char_idx: number } | null;
  }): void {
    const oldTransBoundary = this.transcriptionsSpeechBoundary;
    const oldTranslBoundary = this.translationsSpeechBoundary;

    const newTransBoundary: CharacterPosition = message.transcription
      ? {
          utteranceIdx: message.utterance_idx,
          wordIdx: message.transcription.word_idx,
          charIdx: message.transcription.char_idx,
        }
      : this.transcriptionsSpeechBoundary;

    const newTranslBoundary: CharacterPosition = message.translation
      ? {
          utteranceIdx: message.utterance_idx,
          wordIdx: message.translation.word_idx,
          charIdx: message.translation.char_idx,
        }
      : this.translationsSpeechBoundary;

    if (
      !positionLessThan(newTransBoundary, this.transcriptionsSpeechBoundary)
    ) {
      this.transcriptionsSpeechBoundary = newTransBoundary;
    }
    if (!positionLessThan(newTranslBoundary, this.translationsSpeechBoundary)) {
      this.translationsSpeechBoundary = newTranslBoundary;
    }

    this.notifyAffectedUtterances(
      oldTransBoundary,
      this.transcriptionsSpeechBoundary,
      oldTranslBoundary,
      this.translationsSpeechBoundary,
    );
  }

  private resolveConfigured(requestId: string | null) {
    const configuredPromises = this._configuredPromises.get(requestId) ?? [];
    for (const { resolve } of configuredPromises) {
      resolve();
    }
    this._configuredPromises.delete(requestId);
  }

  private resolveFlushed(requestId: string | null) {
    const flushedPromises = this._flushedPromises.get(requestId) ?? [];
    for (const { resolve } of flushedPromises) {
      resolve();
    }
    this._flushedPromises.delete(requestId);
  }

  private findTranslationForUtterance(
    utteranceIdx: number,
  ): { utterance: Utterance; arrayIdx: number } | undefined {
    const arrayIdx = this.translations.findIndex((t) => t.idx === utteranceIdx);
    if (arrayIdx === -1) return undefined;
    return { utterance: this.translations[arrayIdx], arrayIdx };
  }

  private findArrayIndexByUtteranceIdx(
    utterances: Utterance[],
    utteranceIdx: number,
  ): number {
    return utterances.findIndex((u) => u.idx === utteranceIdx);
  }

  private notifyUtteranceByIdx(utteranceIdx: number): void {
    const arrayIdx = this.findArrayIndexByUtteranceIdx(
      this.transcriptions,
      utteranceIdx,
    );
    if (arrayIdx !== -1) {
      this.callbacks.onUtterance?.(
        this.getUtteranceDisplay(arrayIdx),
        arrayIdx,
      );
    }
  }

  private notifyAffectedUtterances(
    oldTransBoundary: CharacterPosition,
    newTransBoundary: CharacterPosition,
    oldTranslBoundary: CharacterPosition,
    newTranslBoundary: CharacterPosition,
  ): void {
    const minUtteranceIdx = Math.min(
      oldTransBoundary.utteranceIdx,
      newTransBoundary.utteranceIdx,
      oldTranslBoundary.utteranceIdx,
      newTranslBoundary.utteranceIdx,
    );
    const maxUtteranceIdx = Math.max(
      oldTransBoundary.utteranceIdx,
      newTransBoundary.utteranceIdx,
      oldTranslBoundary.utteranceIdx,
      newTranslBoundary.utteranceIdx,
    );

    for (let i = 0; i < this.transcriptions.length; i++) {
      const serverIdx = this.transcriptions[i].idx;
      if (serverIdx >= minUtteranceIdx && serverIdx <= maxUtteranceIdx) {
        this.callbacks.onUtterance?.(this.getUtteranceDisplay(i), i);
      }
    }
  }
}

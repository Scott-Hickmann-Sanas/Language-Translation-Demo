import {
  IdentifiedLanguage,
  LTMessage,
  TranslationClientState,
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
 * Compute spoken/unspoken text for a single utterance given its array index
 * and the global speech boundary.
 */
function computeSpeechDividedText(
  utterance: Utterance,
  arrayIdx: number,
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
        utteranceIdx: arrayIdx,
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
  arrayIdx: number,
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
    arrayIdx,
    boundary,
  );

  return {
    spokenText,
    unspokenText,
    complete: utterance.complete,
    partial: utterance.partial,
  };
}

export interface TranslationStateCallbacks {
  onUtteranceChanged: (utterance: UtteranceDisplay, index: number) => void;
  onLanguagesChanged: (languages: IdentifiedLanguage[]) => void;
  onReady: (id: string | null) => void;
}

export class TranslationState {
  private transcriptions: Utterance[] = [];
  private translations: Utterance[] = [];
  private transcriptionsSpeechBoundary: CharacterPosition = {
    ...ZERO_POSITION,
  };
  private translationsSpeechBoundary: CharacterPosition = {
    ...ZERO_POSITION,
  };
  private _identifiedLanguages: IdentifiedLanguage[] = [];
  private resetTime: number = 0;
  private pendingTimeouts: ReturnType<typeof setTimeout>[] = [];
  private callbacks: TranslationStateCallbacks;
  private readyOnceCallbacks: Array<(id: string | null) => void> = [];

  constructor(callbacks: TranslationStateCallbacks) {
    this.callbacks = callbacks;
  }

  /** Register a one-time listener for the next ready message. */
  onReadyOnce(callback: (id: string | null) => void): void {
    this.readyOnceCallbacks.push(callback);
  }

  get identifiedLanguages(): IdentifiedLanguage[] {
    return this._identifiedLanguages;
  }

  handleMessage(message: LTMessage): void {
    switch (message.type) {
      case "transcription": {
        const {
          complete,
          partial,
          utterance_idx: utteranceIdx,
        } = message.transcription;

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
        const {
          complete,
          partial,
          utterance_idx: utteranceIdx,
        } = message.translation;

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
      case "ready": {
        this.resetReady(true);
        this.callbacks.onReady(message.ready.id);
        // Fire and clear one-time ready listeners
        const readyOnce = this.readyOnceCallbacks;
        this.readyOnceCallbacks = [];
        for (const cb of readyOnce) {
          cb(message.ready.id);
        }
        break;
      }
      case "speech_delimiter": {
        const { transcription, translation, time } = message.speech_delimiter;

        const targetTime = this.resetTime + time * 1000;
        const currentTime = Date.now();
        const delay = Math.max(0, targetTime - currentTime);

        const timeoutId = setTimeout(() => {
          const oldTransBoundary = this.transcriptionsSpeechBoundary;
          const oldTranslBoundary = this.translationsSpeechBoundary;

          this.transcriptionsSpeechBoundary = {
            utteranceIdx: transcription.utterance_idx,
            wordIdx: transcription.word_idx,
            charIdx: transcription.char_idx,
          };
          this.translationsSpeechBoundary = {
            utteranceIdx: translation.utterance_idx,
            wordIdx: translation.word_idx,
            charIdx: translation.char_idx,
          };

          this.pendingTimeouts = this.pendingTimeouts.filter(
            (id) => id !== timeoutId,
          );

          // Notify all utterances affected by the boundary change
          this.notifyAffectedUtterances(
            oldTransBoundary,
            this.transcriptionsSpeechBoundary,
            oldTranslBoundary,
            this.translationsSpeechBoundary,
          );
        }, delay);

        this.pendingTimeouts.push(timeoutId);
        break;
      }
      case "languages": {
        this._identifiedLanguages = message.languages.languages;
        this.callbacks.onLanguagesChanged(this._identifiedLanguages);
        break;
      }
    }
  }

  resetReady(ready = false): void {
    // Clear all pending timeouts
    for (const id of this.pendingTimeouts) {
      clearTimeout(id);
    }
    this.pendingTimeouts = [];

    this.resetTime = Date.now();
    this.transcriptions = [];
    this.translations = [];
    this.transcriptionsSpeechBoundary = { ...ZERO_POSITION };
    this.translationsSpeechBoundary = { ...ZERO_POSITION };

    if (!ready) {
      this._identifiedLanguages = [];
    }
  }

  destroy(): void {
    for (const id of this.pendingTimeouts) {
      clearTimeout(id);
    }
    this.pendingTimeouts = [];
    this.readyOnceCallbacks = [];
  }

  getUtteranceDisplay(index: number): UtteranceDisplay {
    const transcription = this.transcriptions[index];
    const translation = this.findTranslationForUtterance(
      transcription?.idx ?? index,
    );

    return {
      transcription: buildUtteranceStreamDisplay(
        transcription,
        index,
        this.transcriptionsSpeechBoundary,
      ),
      translation: buildUtteranceStreamDisplay(
        translation?.utterance,
        translation?.arrayIdx ?? index,
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
      this.callbacks.onUtteranceChanged(
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
    // Determine the range of utterance array indices that could be affected
    const minIdx = Math.min(
      oldTransBoundary.utteranceIdx,
      newTransBoundary.utteranceIdx,
      oldTranslBoundary.utteranceIdx,
      newTranslBoundary.utteranceIdx,
    );
    const maxIdx = Math.max(
      oldTransBoundary.utteranceIdx,
      newTransBoundary.utteranceIdx,
      oldTranslBoundary.utteranceIdx,
      newTranslBoundary.utteranceIdx,
    );

    for (let i = minIdx; i <= maxIdx && i < this.transcriptions.length; i++) {
      this.callbacks.onUtteranceChanged(this.getUtteranceDisplay(i), i);
    }
  }
}

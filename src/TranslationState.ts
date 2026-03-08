import {
  ConnectionState,
  IdentifiedLanguageDisplay,
  LTMessage,
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
  private _readyPromises: Map<
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
      case "lt":
        this.handleLTMessage(message.lt);
        break;
      case "transport":
        if (this._connectionState !== message.state) {
          this._connectionState = message.state;
          this.callbacks.onConnectionStateChange?.(message.state);
        }
        break;
      case "error":
        this.callbacks.onError?.(message.message);
        break;
    }
  }

  waitForReady(resetId: string | null): Promise<void> {
    return new Promise((resolve, reject) => {
      const readyPromises = this._readyPromises.get(resetId) ?? [];
      readyPromises.push({ resolve, reject });
      this._readyPromises.set(resetId, readyPromises);
    });
  }

  destroy(): void {
    this._readyPromises.forEach((readyPromises) => {
      for (const { reject } of readyPromises) {
        reject(new Error("Disconnected"));
      }
    });
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

  private handleLTMessage(message: LTMessage): void {
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
        this.resolveReady(message.ready.id);
        this.callbacks.onReady?.(message.ready.id);
        break;
      }
      case "speech_delimiter": {
        const { transcription, translation, time } = message.speech_delimiter;
        console.log(
          "[LT] Speech delimiter received:",
          transcription,
          translation,
          time,
        );

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

        this.notifyAffectedUtterances(
          oldTransBoundary,
          this.transcriptionsSpeechBoundary,
          oldTranslBoundary,
          this.translationsSpeechBoundary,
        );
        break;
      }
      case "languages": {
        this._identifiedLanguages = message.languages.languages.map((l) => ({
          shortCode: l.short_code,
          name: l.name,
          probability: l.probability,
        }));
        this.callbacks.onLanguages?.(this._identifiedLanguages);
        break;
      }
      case "speech_languages": {
        this.callbacks.onSpeechLanguages?.(
          message.speech_languages.lang_in,
          message.speech_languages.lang_out,
        );
        break;
      }
      case "speech_stop": {
        this.callbacks.onSpeechStop?.();
        break;
      }
      default: {
        console.warn("[LT] Unknown message type:", message.type);
        break;
      }
    }
  }

  private resolveReady(resetId: string | null) {
    const readyPromises = this._readyPromises.get(resetId) ?? [];
    for (const { resolve } of readyPromises) {
      resolve();
    }
    this._readyPromises.delete(resetId);
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

import { Utterance } from "@/types/words";

interface UtteranceProps {
  transcription: Utterance;
  translation: Utterance;
}

export default function UtteranceComponent({
  utterance,
}: {
  utterance: UtteranceProps;
}) {
  return (
    <div className="p-2 bg-gray-100 rounded-md">
      <div>
        <span className="text-black">
          {utterance.transcription.complete.map((word) => word.word).join("")}
        </span>
        <span className="text-gray-500">
          {utterance.transcription.partial.map((word) => word.word).join("")}
        </span>
      </div>
      <hr />
      <div>
        <span className="text-black">
          {utterance.translation.complete.map((word) => word.word).join("")}
        </span>
        <span className="text-gray-500">
          {utterance.translation.partial.map((word) => word.word).join("")}
        </span>
      </div>
    </div>
  );
}

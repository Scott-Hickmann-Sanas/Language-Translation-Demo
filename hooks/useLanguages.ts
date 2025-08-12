import { Languages } from "@/types/languages";
import { useEffect, useState } from "react";

if (!process.env.NEXT_PUBLIC_LT_ENDPOINT) {
  throw new Error("NEXT_PUBLIC_LT_ENDPOINT is not set");
}
const LT_ENDPOINT = process.env.NEXT_PUBLIC_LT_ENDPOINT;

export function useLanguages() {
  const [languages, setLanguages] = useState<Languages>([]);
  useEffect(() => {
    fetch(`${LT_ENDPOINT}/languages`)
      .then((res) => res.json())
      .then((data) => setLanguages(Languages.parse(data)));
  }, []);
  return languages;
}

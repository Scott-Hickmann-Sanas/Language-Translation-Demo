import { Languages } from "@/types/languages";
import { useEffect, useState } from "react";

if (!process.env.NEXT_PUBLIC_LT_ENDPOINT) {
  throw new Error("NEXT_PUBLIC_LT_ENDPOINT is not set");
}
const LT_ENDPOINT = process.env.NEXT_PUBLIC_LT_ENDPOINT;

if (!process.env.NEXT_PUBLIC_SANAS_API_KEY) {
  throw new Error("NEXT_PUBLIC_SANAS_API_KEY is not set");
}
const SANAS_API_KEY = process.env.NEXT_PUBLIC_SANAS_API_KEY;

export function useLanguages() {
  const [languages, setLanguages] = useState<Languages>([]);
  useEffect(() => {
    fetch(`${LT_ENDPOINT}/languages`, {
      headers: {
        "Content-Type": "application/json",
        "X-API-Key": SANAS_API_KEY,
      },
    })
      .then((res) => res.json())
      .then((data) => setLanguages(Languages.parse(data)));
  }, []);
  return languages;
}

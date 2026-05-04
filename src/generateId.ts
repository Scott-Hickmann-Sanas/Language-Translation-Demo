// Mirrors the ID format from ../translation/common/sanas-shared/sanas_shared/generate_id.py.
const ADJECTIVES = [
  "acrid",
  "ambrosial",
  "amorphous",
  "armored",
  "aromatic",
  "bald",
  "blazing",
  "boisterous",
  "bouncy",
  "brawny",
  "broad",
  "bulky",
  "camouflaged",
  "caped",
  "chubby",
  "curvy",
  "elastic",
  "ethereal",
  "feathered",
  "fiery",
  "flashy",
  "flat",
  "fluffy",
  "foamy",
  "fragrant",
  "furry",
  "fuzzy",
  "glaring",
  "hairy",
  "heavy",
  "hissing",
  "horned",
  "icy",
  "imaginary",
  "invisible",
  "lean",
  "loud",
  "loutish",
  "luminous",
  "lumpy",
  "lush",
  "masked",
  "meaty",
  "messy",
  "misty",
  "nebulous",
  "noisy",
  "nondescript",
  "organic",
  "prudent",
];

const ANIMALS = [
  "ant",
  "armadillo",
  "barnacle",
  "bat",
  "bee",
  "beetle",
  "bison",
  "buffalo",
  "butterfly",
  "caterpillar",
  "centipede",
  "cicada",
  "cow",
  "crab",
  "crayfish",
  "cricket",
  "dragonfly",
  "earwig",
  "earthworm",
  "elephant",
  "firefly",
  "gazelle",
  "goat",
  "grasshopper",
  "honeybee",
  "hornet",
  "ladybug",
  "leech",
  "lobster",
  "locust",
  "mantis",
  "mayfly",
  "millipede",
  "mosquito",
  "moth",
  "pillbug",
  "prawn",
  "pronghorn",
  "scorpion",
  "shrimp",
  "silkworm",
  "spider",
  "tarantula",
  "termite",
  "wasp",
  "woodlouse",
  "worm",
];

function randomInt(maxExclusive: number): number {
  const buffer = new Uint32Array(1);
  if (globalThis.crypto?.getRandomValues) {
    globalThis.crypto.getRandomValues(buffer);
    return buffer[0] % maxExclusive;
  }
  return Math.floor(Math.random() * maxExclusive);
}

export function generateConversationId(): string {
  const now = new Date();
  const datePart = [
    String(now.getUTCFullYear() % 100).padStart(2, "0"),
    String(now.getUTCMonth() + 1).padStart(2, "0"),
    String(now.getUTCDate()).padStart(2, "0"),
  ].join("");
  const adjective = ADJECTIVES[randomInt(ADJECTIVES.length)];
  const animal = ANIMALS[randomInt(ANIMALS.length)];
  const digits = String(randomInt(1000)).padStart(3, "0");

  return `${datePart}-${adjective}-${animal}-${digits}`;
}

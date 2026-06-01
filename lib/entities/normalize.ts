/**
 * Account/entity name normalization for fuzzy matching.
 *
 * Goal: collapse "Chubb" / "Chubb INA Holdings Inc." / "CHUBB INA HOLDINGS, INC."
 * into one canonical entity row instead of three.
 *
 * Two-tier match:
 *   Tier 1: exact match after normalization (lowercase, strip punctuation,
 *           strip corporate suffix words, collapse whitespace).
 *   Tier 2: when one normalized name is a single word AND it equals the first
 *           word of the other normalized name, treat as match. Catches the
 *           common case of Codex inferring "Chubb" from the email domain while
 *           Salesforce has "Chubb INA Holdings Inc." (normalizes to "chubb ina").
 *
 * Stays conservative — won't merge "Apple" with "Apple Bank for Savings".
 */

const SUFFIX_WORDS = new Set([
  "inc",
  "incorporated",
  "ltd",
  "llc",
  "corp",
  "corporation",
  "limited",
  "holdings",
  "holding",
  "group",
  "co",
  "company",
  "plc",
  "ag",
  "sa",
  "spa",
  "gmbh",
  "kg",
  "bv",
  "nv",
  "pte",
  "pty",
  "pvt",
  "lp",
  "llp",
  "lllp",
  "trust",
  "the",
  "and",
]);

const PUNCT_RE = /[,.&;:!?()\/[\]"'’]/g;

/**
 * Words too generic to anchor a tier-2 match. e.g., "Capital" alone wouldn't
 * disambiguate "Capital One" vs "Capital Group" vs "Capital Bancorp".
 */
const TIER2_STOP_WORDS = new Set([
  "capital",
  "global",
  "national",
  "international",
  "american",
  "united",
  "first",
  "second",
  "central",
  "federal",
  "financial",
  "finance",
  "services",
  "service",
  "solutions",
  "systems",
  "industries",
  "industry",
  "technologies",
  "technology",
  "enterprise",
  "enterprises",
  "business",
  "trust",
  "customer",
  "customers",
  "client",
  "clients",
  "general",
  "special",
  "world",
  "worldwide",
  "global",
  "advanced",
  "premier",
  "premium",
  "core",
  "data",
  "credit",
  "savings",
  "investments",
  "investment",
  "securities",
  "insurance",
  "bank",
  "banks",
  "banking",
  "mutual",
  "mortgage",
  "wealth",
]);

export function normalizeName(name: string): string {
  if (!name) return "";
  let s = name.toLowerCase();
  s = s.replace(PUNCT_RE, " ");
  s = s.replace(/\s+/g, " ").trim();
  const words = s.split(" ").filter((w) => w.length > 0 && !SUFFIX_WORDS.has(w));
  return words.join(" ").trim();
}

/**
 * True if the two raw names should be treated as the same entity.
 */
export function namesMatch(a: string, b: string): boolean {
  const na = normalizeName(a);
  const nb = normalizeName(b);
  if (!na || !nb) return false;
  if (na === nb) return true;

  const aWords = na.split(" ");
  const bWords = nb.split(" ");

  // Tier 2: single-word side matches first word of the other side, BUT only
  // if the matching word is discriminating enough to anchor an identity (not
  // a generic first-word like "Capital", "Global", "Customer").
  function tier2Anchor(word: string): boolean {
    return !TIER2_STOP_WORDS.has(word);
  }
  if (aWords.length === 1 && aWords[0] === bWords[0] && tier2Anchor(aWords[0])) return true;
  if (bWords.length === 1 && bWords[0] === aWords[0] && tier2Anchor(bWords[0])) return true;

  return false;
}

/**
 * Pick the "canonical" name among a group of matching variants — the longest one
 * (most specific), with original casing preserved.
 */
export function pickCanonical(names: string[]): string {
  if (names.length === 0) return "";
  return [...names].sort((a, b) => b.length - a.length)[0];
}

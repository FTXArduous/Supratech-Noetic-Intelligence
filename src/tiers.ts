export type Tier = 'sni' | 'meta' | 'hyper' | 'empyrean' | 'anagogic';

export const TIER_LABEL: Record<Tier, string> = {
  sni: 'SNI',
  meta: 'MTSI',
  hyper: 'HNSI',
  empyrean: 'ENSI',
  anagogic: 'ANSI',
};

const BOUNDS =
  'Begin with a block starting "AXIOMS:" listing numbered rules you will obey for this entire trace, in your own notation. ' +
  'Then reason, citing axiom numbers when you rely on them. ' +
  'Use supplied SNI vocabulary consistently when useful. At the end, add "LEXICON DELTA:" and propose one concise, genuinely useful new term for a distinction or relationship in this task; do not repeat supplied terms. Format each entry as term :: definition. Treat it as a proposed label, not a new fact. ' +
  'Stay within finite computation. Make no claims of unlimited or supernatural intelligence. ' +
  'Every step must be reducible to statements a human could check.';

export const TIER_PROMPT: Record<Tier, string> = {
  sni: `Reason step by step in a compact structured notation. ${BOUNDS}`,
  meta: `Reason about the reasoning itself: name the representations, abstractions and transformations you use and how they relate. ${BOUNDS}`,
  hyper: `Reason across many interacting variables and relationships at once; list the variables and the relations between them before concluding. ${BOUNDS}`,
  empyrean: `Reason through deep conceptual hierarchies; define each level of abstraction and the mapping between levels. ${BOUNDS}`,
  anagogic: `Progressively elevate the problem through increasingly general representations, solve at the highest useful level, then descend. ${BOUNDS}`,
};

// Hardcoded guardrails: the translator and verifier are not user-overridable.
export const TRANSLATOR_PROMPT =
  'You are a translator. Convert the supplied reasoning trace into plain English, step by step. ' +
  'Do not add conclusions that are not in the trace. Mark any step you cannot translate as [UNTRANSLATABLE].';

export const VERIFIER_PROMPT =
  'You are a verifier. Compare the ENGLISH translation to the original TRACE. ' +
  'First, check the TRACE itself against its own AXIOMS block: list any step that violates an axiom, or report that the AXIOMS block is missing (which is a FAIL). ' +
  'Then list each claim in the translation as SUPPORTED, UNSUPPORTED, or UNCHECKABLE, with a one-line reason. ' +
  'Finish with a line "VERDICT: PASS" or "VERDICT: FAIL".';

export const SUMMARY_PROMPT =
  'Write a short final summary in plain English using only claims marked SUPPORTED. State any unresolved items.';

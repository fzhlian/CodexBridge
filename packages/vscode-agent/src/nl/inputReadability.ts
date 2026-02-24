export type UnreadableInputReason =
  | "empty_input"
  | "contains_replacement_character"
  | "contains_control_characters"
  | "no_lexical_content"
  | "low_lexical_density";

const MIN_DENSITY_LENGTH = 8;
const MIN_LEXICAL_DENSITY = 0.35;

export function detectUnreadableTaskInput(input: string): UnreadableInputReason | undefined {
  const trimmed = input.trim();
  if (!trimmed) {
    return "empty_input";
  }
  if (trimmed.includes("\uFFFD")) {
    return "contains_replacement_character";
  }
  if (containsDisallowedControlChars(trimmed)) {
    return "contains_control_characters";
  }

  const compact = trimmed.replace(/\s+/g, "");
  if (!compact) {
    return "empty_input";
  }

  let lexicalCount = 0;
  let totalCount = 0;
  for (const char of compact) {
    totalCount += 1;
    if (isLexicalChar(char)) {
      lexicalCount += 1;
    }
  }

  if (lexicalCount === 0) {
    return "no_lexical_content";
  }
  if (totalCount >= MIN_DENSITY_LENGTH && lexicalCount / totalCount < MIN_LEXICAL_DENSITY) {
    return "low_lexical_density";
  }
  return undefined;
}

function isLexicalChar(char: string): boolean {
  return /[\p{L}\p{N}]/u.test(char);
}

function containsDisallowedControlChars(input: string): boolean {
  for (const char of input) {
    const code = char.codePointAt(0) ?? 0;
    if (code > 0x1f && code !== 0x7f) {
      continue;
    }
    if (code === 0x09 || code === 0x0a || code === 0x0d) {
      continue;
    }
    return true;
  }
  return false;
}

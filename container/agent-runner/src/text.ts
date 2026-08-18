// ABOUTME: Codepoint-safe text helpers for values that end up in API request bodies.
// ABOUTME: Lone UTF-16 surrogates make the Anthropic API reject the request as invalid JSON.

// A high surrogate not followed by a low one, or a low surrogate not preceded
// by a high one. Either makes JSON.stringify emit an unpaired \uD8xx escape,
// which the API rejects with "no low surrogate in string".
const LONE_SURROGATE =
  /[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/g;

/** Replace unpaired UTF-16 surrogates with U+FFFD REPLACEMENT CHARACTER. */
export function stripLoneSurrogates(s: string): string {
  return s.replace(LONE_SURROGATE, '�');
}

/**
 * Truncate to `max` codepoints, appending '...' when anything was cut.
 *
 * Slicing a JS string by index cuts on UTF-16 code units, which splits emoji
 * surrogate pairs in half. Spreading into an array iterates by codepoint, so
 * an emoji is kept or dropped whole.
 */
export function truncateChars(value: unknown, max: number): string {
  const s = stripLoneSurrogates(
    typeof value === 'string' ? value : String(value),
  );
  const chars = [...s];
  return chars.length <= max ? s : chars.slice(0, max).join('') + '...';
}

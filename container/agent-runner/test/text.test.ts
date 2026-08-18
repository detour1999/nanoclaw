// ABOUTME: Tests for codepoint-safe text truncation and lone-surrogate stripping.
// ABOUTME: Guards the Anthropic API against "no low surrogate in string" 400s.

import { describe, it, expect } from 'vitest';
import { truncateChars, stripLoneSurrogates } from '../src/text.js';

// U+1F389 PARTY POPPER — a surrogate pair: 🎉
const PARTY = '\u{1F389}';

const LONE_SURROGATE =
  /[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/;

describe('stripLoneSurrogates', () => {
  it('leaves well-formed text untouched', () => {
    expect(stripLoneSurrogates(`Hey Rando ${PARTY} ok`)).toBe(
      `Hey Rando ${PARTY} ok`,
    );
  });

  it('replaces an unpaired high surrogate with U+FFFD', () => {
    expect(stripLoneSurrogates('Hey \uD83C')).toBe('Hey �');
  });

  it('replaces an unpaired low surrogate with U+FFFD', () => {
    expect(stripLoneSurrogates('\uDF89 tail')).toBe('� tail');
  });

  it('produces output that survives a JSON round-trip', () => {
    const sanitized = stripLoneSurrogates('Hey Rando \uD83C');
    expect(JSON.parse(JSON.stringify(sanitized))).toBe(sanitized);
    expect(sanitized).not.toMatch(LONE_SURROGATE);
  });
});

describe('truncateChars', () => {
  it('returns short strings unchanged, with no ellipsis', () => {
    expect(truncateChars('short', 50)).toBe('short');
  });

  it('truncates on a codepoint boundary rather than splitting a surrogate pair', () => {
    // The emoji straddles UTF-16 index 49/50 — a naive slice(0, 50) keeps the
    // high surrogate and drops the low one, poisoning the JSON request body.
    const prompt = `Weekly 1:1 (your regular 1:1 with Mo)\n\nHey Rando ${PARTY} more text`;
    expect(prompt.slice(0, 50)).toMatch(/[\uD800-\uDBFF]$/); // the bug we're fixing

    const out = truncateChars(prompt, 50);
    expect(out).not.toMatch(LONE_SURROGATE);
    expect(out).toContain(PARTY); // the emoji is kept whole, not halved
    expect(out.endsWith('...')).toBe(true);
  });

  it('keeps a whole emoji when it fits within the limit', () => {
    expect(truncateChars(`ab${PARTY}cd`, 3)).toBe(`ab${PARTY}...`);
  });

  it('counts codepoints, not UTF-16 code units', () => {
    expect(truncateChars(`${PARTY}${PARTY}${PARTY}`, 2)).toBe(
      `${PARTY}${PARTY}...`,
    );
  });

  it('strips lone surrogates already present in the input', () => {
    expect(truncateChars('bad \uD83C input', 50)).toBe('bad � input');
  });

  it('coerces non-string input instead of throwing', () => {
    expect(truncateChars(undefined, 10)).toBe('undefined');
    expect(truncateChars(Buffer.from('hello'), 10)).toBe('hello');
  });
});

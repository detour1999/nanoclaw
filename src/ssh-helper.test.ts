// ABOUTME: Tests for POSIX single-quote shell escaping used on remote SSH commands.
// ABOUTME: A bad escape silently mangles arguments like book titles with apostrophes.

import { describe, it, expect } from 'vitest';
import { execFileSync } from 'child_process';
import { shellQuote } from './ssh-helper.js';

// Round-trip through a real shell: whatever we quote must come back verbatim.
function echoThroughShell(arg: string): string {
  return execFileSync('/bin/sh', ['-c', `printf %s ${shellQuote(arg)}`], {
    encoding: 'utf-8',
  });
}

describe('shellQuote', () => {
  it('wraps a plain string in single quotes', () => {
    expect(shellQuote('hello')).toBe("'hello'");
  });

  it('preserves an apostrophe instead of dropping it', () => {
    expect(echoThroughShell("The Butcher's Masquerade")).toBe(
      "The Butcher's Masquerade",
    );
  });

  it('preserves multiple apostrophes', () => {
    expect(echoThroughShell("it's o'clock's")).toBe("it's o'clock's");
  });

  it('neutralizes shell metacharacters', () => {
    const nasty = '$(whoami) `id` && rm -rf / ; echo *';
    expect(echoThroughShell(nasty)).toBe(nasty);
  });

  it('handles an empty string', () => {
    expect(echoThroughShell('')).toBe('');
  });
});

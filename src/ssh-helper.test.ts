// ABOUTME: Tests for POSIX single-quote shell escaping used on remote SSH commands.
// ABOUTME: A bad escape silently mangles arguments like book titles with apostrophes.

import { describe, it, expect } from 'vitest';
import { execFileSync } from 'child_process';
import { shellQuote, formatSshFailure } from './ssh-helper.js';

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

describe('formatSshFailure', () => {
  type ExecErr = Error & {
    code?: string | number | null;
    killed?: boolean;
    stdout?: string;
    stderr?: string;
  };
  const err = (message: string, extra: Partial<ExecErr> = {}): ExecErr =>
    Object.assign(new Error(message), extra);

  it('surfaces stdout, which is where output lands when the caller uses 2>&1', () => {
    // The nightly git task appended 2>&1, so stderr was always empty and the
    // real reason (a gh error) was discarded. 119 failures reported nothing.
    const msg = formatSshFailure(
      err('Command failed: ssh ... localhost', {
        code: 1,
        stdout:
          'pull request create failed: GraphQL: No commits between nanocoai:main and detour1999:agent/wip',
        stderr: '',
      }),
    );
    expect(msg).toContain('nanocoai:main');
    expect(msg).toContain('exit 1');
  });

  it('includes stderr when the command wrote there', () => {
    const msg = formatSshFailure(
      err('Command failed', { code: 2, stdout: '', stderr: 'gh: not found' }),
    );
    expect(msg).toContain('gh: not found');
  });

  it('includes both streams when both have content', () => {
    const msg = formatSshFailure(
      err('Command failed', {
        code: 1,
        stdout: 'on stdout',
        stderr: 'on stderr',
      }),
    );
    expect(msg).toContain('on stdout');
    expect(msg).toContain('on stderr');
  });

  it('reports a timeout distinctly rather than as a command failure', () => {
    const msg = formatSshFailure(
      err('Command failed', { killed: true, stdout: '', stderr: '' }),
    );
    expect(msg).toMatch(/timed out/i);
  });

  it('distinguishes ssh transport failure (255) from a remote non-zero exit', () => {
    const transport = formatSshFailure(
      err('Command failed', { code: 255, stderr: 'Connection refused' }),
    );
    expect(transport).toMatch(/ssh transport/i);

    const remote = formatSshFailure(err('Command failed', { code: 3 }));
    expect(remote).not.toMatch(/ssh transport/i);
    expect(remote).toContain('exit 3');
  });

  it('never returns a bare "Command failed" with no detail', () => {
    const msg = formatSshFailure(err('Command failed: ssh ... localhost'));
    expect(msg).not.toBe('Command failed: ssh ... localhost');
    expect(msg.length).toBeGreaterThan(20);
  });

  it('truncates very long output', () => {
    const msg = formatSshFailure(
      err('Command failed', { code: 1, stdout: 'x'.repeat(9000) }),
    );
    expect(msg.length).toBeLessThan(2500);
  });
});

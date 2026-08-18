// ABOUTME: Tests for BookDrop failure reporting over SSH.
// ABOUTME: A vague "Command failed" made agents misdiagnose slow downloads as dead SSH.

import { describe, it, expect } from 'vitest';
import { describeBookDropFailure, BOOKDROP_TIMEOUT_MS } from './bookdrop.js';

type ExecErr = Error & { killed?: boolean; signal?: string; code?: number };

function execError(message: string, extra: Partial<ExecErr> = {}): ExecErr {
  return Object.assign(new Error(message), extra);
}

describe('BOOKDROP_TIMEOUT_MS', () => {
  it("outlasts bookdrop.py's own 30-minute poll timeout", () => {
    expect(BOOKDROP_TIMEOUT_MS).toBeGreaterThan(1800 * 1000);
  });
});

describe('describeBookDropFailure', () => {
  it('reports a timeout as a timeout, not as an SSH failure', () => {
    const msg = describeBookDropFailure(
      execError('Command failed: ssh ...', { killed: true, signal: 'SIGTERM' }),
      '',
      '',
    );
    expect(msg).toMatch(/timed out/i);
    expect(msg).toMatch(/35 min/);
    expect(msg).not.toMatch(/Command failed/);
  });

  it('names an unreachable host when ssh exits 255', () => {
    const msg = describeBookDropFailure(
      execError('Command failed: ssh ...', { code: 255 }),
      '',
      'ssh: connect to host 100.112.19.152 port 22: No route to host',
    );
    expect(msg).toMatch(/SSH to Proxmox failed/i);
    expect(msg).toContain('No route to host');
  });

  it('surfaces stdout when the remote script fails with 2>&1 redirecting stderr', () => {
    // Agents append 2>&1, so stderr is empty and the real error is in stdout.
    const msg = describeBookDropFailure(
      execError('Command failed: ssh ...', { code: 1 }),
      'Traceback (most recent call last):\nKeyError: readarr_api_key',
      '',
    );
    expect(msg).toMatch(/BookDrop failed on Proxmox/i);
    expect(msg).toContain('KeyError: readarr_api_key');
    expect(msg).toMatch(/exit code 1/);
  });

  it('prefers stderr when the remote script wrote to it', () => {
    const msg = describeBookDropFailure(
      execError('Command failed: ssh ...', { code: 2 }),
      'some stdout',
      'real error on stderr',
    );
    expect(msg).toContain('real error on stderr');
  });

  it('falls back to the error message when there is no output at all', () => {
    const msg = describeBookDropFailure(
      execError('spawn ssh ENOENT', { code: 1 }),
      '',
      '',
    );
    expect(msg).toContain('spawn ssh ENOENT');
  });

  it('truncates very long output so it stays readable in chat', () => {
    const msg = describeBookDropFailure(
      execError('Command failed', { code: 1 }),
      'x'.repeat(5000),
      '',
    );
    expect(msg.length).toBeLessThan(2000);
  });
});

// ABOUTME: Executes commands on localhost via SSH for container agents.
// ABOUTME: Main-group-only capability — provides host access from sandboxed containers.

import { exec } from 'child_process';
import { promisify } from 'util';

const execAsync = promisify(exec);

/**
 * Wrap a string as a single POSIX shell word.
 *
 * Inside single quotes every character is literal except the quote itself, so
 * an embedded quote is escaped by closing, emitting an escaped quote, and
 * reopening: `'` becomes `'\''`.
 */
export function shellQuote(s: string): string {
  return "'" + s.replace(/'/g, "'\\''") + "'";
}

const SSH_TIMEOUT_MS = 30000;
const MAX_OUTPUT_CHARS = 1000;

function tail(output: string | undefined): string {
  const trimmed = (output ?? '').trim();
  return trimmed.length > MAX_OUTPUT_CHARS
    ? '...' + trimmed.slice(-MAX_OUTPUT_CHARS)
    : trimmed;
}

/**
 * Build an actionable message from a failed ssh exec.
 *
 * Node's exec error message is just "Command failed: <cmd>" plus stderr, and
 * agents routinely append `2>&1` — which makes stderr empty and sends the real
 * diagnostics to stdout, where the old code discarded them. Both streams and
 * the exit code are reported so the caller can tell a transport failure from a
 * remote command that simply exited non-zero.
 */
export function formatSshFailure(
  err: Error & {
    code?: string | number | null;
    killed?: boolean;
    signal?: string | null;
    stdout?: string;
    stderr?: string;
  },
): string {
  const parts: string[] = [];
  const out = tail(err.stdout);
  const errOut = tail(err.stderr);
  if (errOut) parts.push(`stderr: ${errOut}`);
  if (out) parts.push(`stdout: ${out}`);
  const detail = parts.join('\n') || `no output (${err.message})`;

  if (err.killed || err.signal === 'SIGTERM') {
    return `SSH command timed out after ${Math.round(SSH_TIMEOUT_MS / 1000)}s and was killed.\n${detail}`;
  }
  // ssh reserves 255 for its own errors; anything else is the remote exit code.
  if (err.code === 255) {
    return `ssh transport failure (exit 255) — could not run the command on the host.\n${detail}`;
  }
  return `Command failed on host (exit ${err.code ?? 'unknown'}).\n${detail}`;
}

export async function executeSSHLocalhost(command: string): Promise<string> {
  const sshCommand = `ssh -o BatchMode=yes -o ConnectTimeout=5 localhost ${shellQuote(command)}`;

  try {
    const { stdout, stderr } = await execAsync(sshCommand, {
      timeout: SSH_TIMEOUT_MS,
      maxBuffer: 1024 * 1024,
    });
    const output = stdout || stderr;
    return output.trim() || 'Command executed successfully (no output)';
  } catch (err) {
    throw new Error(
      formatSshFailure(err as Parameters<typeof formatSshFailure>[0]),
    );
  }
}

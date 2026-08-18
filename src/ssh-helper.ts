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

export async function executeSSHLocalhost(command: string): Promise<string> {
  const escaped = command.replace(/'/g, "'\\''");
  const sshCommand = `ssh -o BatchMode=yes -o ConnectTimeout=5 localhost '${escaped}'`;

  const { stdout, stderr } = await execAsync(sshCommand, {
    timeout: 30000,
    maxBuffer: 1024 * 1024,
  });

  const output = stdout || stderr;
  return output.trim() || 'Command executed successfully (no output)';
}

// ABOUTME: Executes commands on localhost via SSH for container agents.
// ABOUTME: Main-group-only capability — provides host access from sandboxed containers.

import { exec } from 'child_process';
import { promisify } from 'util';

const execAsync = promisify(exec);

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

// ABOUTME: BookDrop timeout and failure reporting for the get_book IPC handler.
// ABOUTME: Keeps remote-script failures distinguishable from real SSH failures.

/**
 * bookdrop.py polls AudiobookShelf for up to 30 minutes waiting on a download,
 * so the host must wait longer than that or it SIGTERMs work that would have
 * succeeded. 35 minutes leaves headroom for the email step.
 */
export const BOOKDROP_TIMEOUT_MS = 35 * 60 * 1000;

const MAX_OUTPUT_CHARS = 1200;

function tail(output: string): string {
  const trimmed = output.trim();
  return trimmed.length > MAX_OUTPUT_CHARS
    ? '...' + trimmed.slice(-MAX_OUTPUT_CHARS)
    : trimmed;
}

/**
 * Turn an execFile error into something an agent can act on.
 *
 * Agents append `2>&1` to remote commands, so stderr is usually empty and the
 * real diagnostics land in stdout. Reporting only `stderr || err.message` left
 * agents with a bare "Command failed: ssh ..." and led them to conclude SSH was
 * down when the remote script had simply exited non-zero or run long.
 */
export function describeBookDropFailure(
  // Matches Node's ExecFileException, whose code is a numeric exit status for a
  // process that ran and a string errno (e.g. 'ENOENT') when spawning failed.
  err: Error & {
    killed?: boolean;
    signal?: string | null;
    code?: string | number | null;
  },
  stdout: string,
  stderr: string,
): string {
  const minutes = Math.round(BOOKDROP_TIMEOUT_MS / 60000);
  const output = tail(stderr) || tail(stdout);

  if (err.killed || err.signal === 'SIGTERM') {
    return `BookDrop timed out after ${minutes} min and was killed. The SSH connection itself was fine — the download or Readarr search ran long.${output ? `\nLast output: ${output}` : ''}`;
  }

  // ssh reserves exit code 255 for its own errors; anything else is the
  // remote command's exit code.
  if (err.code === 255) {
    return `SSH to Proxmox failed (ssh exit 255): ${output || err.message}`;
  }

  return `BookDrop failed on Proxmox with exit code ${err.code ?? 'unknown'} (SSH connected fine): ${output || err.message}`;
}

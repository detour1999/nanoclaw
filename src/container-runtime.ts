/**
 * Container runtime abstraction for NanoClaw.
 * All runtime-specific logic lives here so swapping runtimes means changing one file.
 */
import { execSync } from 'child_process';
import fs from 'fs';
import os from 'os';

import { logger } from './logger.js';

/** The container runtime binary name. */
export const CONTAINER_RUNTIME_BIN = process.env.CONTAINER_RUNTIME || 'docker';

/** Hostname containers use to reach the host machine. */
export let CONTAINER_HOST_GATEWAY =
  process.env.CONTAINER_HOST_GATEWAY || 'host.docker.internal';

/**
 * For Apple Container on macOS, detect the gateway IP dynamically.
 * The subnet can change when the container service restarts, so we probe
 * a throwaway container's /etc/resolv.conf to find the current gateway.
 * Must be called after ensureContainerRuntimeRunning().
 */
export function detectContainerHostGateway(): void {
  if (process.env.CONTAINER_HOST_GATEWAY) return; // explicit override, don't touch
  if (CONTAINER_RUNTIME_BIN !== 'container') return; // only needed for Apple Container

  try {
    const output = execSync(
      `${CONTAINER_RUNTIME_BIN} run --rm node:22-slim cat /etc/resolv.conf`,
      { stdio: ['pipe', 'pipe', 'pipe'], encoding: 'utf-8', timeout: 15000 },
    );
    const match = output.match(/nameserver\s+([\d.]+)/);
    if (match) {
      const detected = match[1];
      if (detected !== CONTAINER_HOST_GATEWAY) {
        logger.info(
          { old: CONTAINER_HOST_GATEWAY, detected },
          'Auto-detected Apple Container gateway IP',
        );
      }
      CONTAINER_HOST_GATEWAY = detected;
    }
  } catch (err) {
    logger.warn(
      { err },
      'Failed to auto-detect container gateway IP, using default',
    );
  }
}

/**
 * Address the credential proxy binds to.
 * Docker Desktop (macOS): 127.0.0.1 — the VM routes host.docker.internal to loopback.
 * Docker (Linux): bind to the docker0 bridge IP so only containers can reach it,
 *   falling back to 0.0.0.0 if the interface isn't found.
 */
export const PROXY_BIND_HOST =
  process.env.CREDENTIAL_PROXY_HOST || detectProxyBindHost();

function detectProxyBindHost(): string {
  if (os.platform() === 'darwin') return '127.0.0.1';

  // WSL uses Docker Desktop (same VM routing as macOS) — loopback is correct.
  // Check /proc filesystem, not env vars — WSL_DISTRO_NAME isn't set under systemd.
  if (fs.existsSync('/proc/sys/fs/binfmt_misc/WSLInterop')) return '127.0.0.1';

  // Bare-metal Linux: bind to the docker0 bridge IP instead of 0.0.0.0
  const ifaces = os.networkInterfaces();
  const docker0 = ifaces['docker0'];
  if (docker0) {
    const ipv4 = docker0.find((a) => a.family === 'IPv4');
    if (ipv4) return ipv4.address;
  }
  return '0.0.0.0';
}

/** CLI args needed for the container to resolve the host gateway. */
export function hostGatewayArgs(): string[] {
  // On Linux, host.docker.internal isn't built-in — add it explicitly
  if (os.platform() === 'linux') {
    return ['--add-host=host.docker.internal:host-gateway'];
  }
  return [];
}

/** Returns CLI args for a readonly bind mount. */
export function readonlyMountArgs(
  hostPath: string,
  containerPath: string,
): string[] {
  return ['-v', `${hostPath}:${containerPath}:ro`];
}

/** Returns the shell command to stop a container by name. */
export function stopContainer(name: string): string {
  return `${CONTAINER_RUNTIME_BIN} stop ${name}`;
}

/** Ensure the container runtime is running, starting it if needed. */
export function ensureContainerRuntimeRunning(): void {
  // Apple container CLI uses `container list` instead of `docker info`
  const healthCmd =
    CONTAINER_RUNTIME_BIN === 'container'
      ? `${CONTAINER_RUNTIME_BIN} list`
      : `${CONTAINER_RUNTIME_BIN} info`;
  try {
    execSync(healthCmd, {
      stdio: 'pipe',
      timeout: 10000,
    });
    logger.debug('Container runtime already running');
  } catch (err) {
    logger.error({ err }, 'Failed to reach container runtime');
    console.error(
      '\n╔════════════════════════════════════════════════════════════════╗',
    );
    console.error(
      '║  FATAL: Container runtime failed to start                      ║',
    );
    console.error(
      '║                                                                ║',
    );
    console.error(
      '║  Agents cannot run without a container runtime. To fix:        ║',
    );
    console.error(
      `║  1. Ensure ${CONTAINER_RUNTIME_BIN} is installed and running${' '.repeat(Math.max(0, 24 - CONTAINER_RUNTIME_BIN.length))}║`,
    );
    console.error(
      `║  2. Run: ${healthCmd}${' '.repeat(Math.max(0, 38 - healthCmd.length))}║`,
    );
    console.error(
      '║  3. Restart NanoClaw                                           ║',
    );
    console.error(
      '╚════════════════════════════════════════════════════════════════╝\n',
    );
    throw new Error('Container runtime is required but failed to start');
  }
}

/** Kill orphaned NanoClaw containers from previous runs. */
export function cleanupOrphans(): void {
  try {
    let orphans: string[];
    if (CONTAINER_RUNTIME_BIN === 'container') {
      // Apple container: parse `container list` output for nanoclaw- entries
      const output = execSync(`${CONTAINER_RUNTIME_BIN} list`, {
        stdio: ['pipe', 'pipe', 'pipe'],
        encoding: 'utf-8',
      });
      orphans = output
        .trim()
        .split('\n')
        .slice(1) // skip header
        .map((line) => line.split(/\s+/)[0])
        .filter((name) => name && name.startsWith('nanoclaw-'));
    } else {
      const output = execSync(
        `${CONTAINER_RUNTIME_BIN} ps --filter name=nanoclaw- --format '{{.Names}}'`,
        { stdio: ['pipe', 'pipe', 'pipe'], encoding: 'utf-8' },
      );
      orphans = output.trim().split('\n').filter(Boolean);
    }
    for (const name of orphans) {
      try {
        execSync(stopContainer(name), { stdio: 'pipe' });
      } catch {
        /* already stopped */
      }
    }
    if (orphans.length > 0) {
      logger.info(
        { count: orphans.length, names: orphans },
        'Stopped orphaned containers',
      );
    }
  } catch (err) {
    logger.warn({ err }, 'Failed to clean up orphaned containers');
  }
}

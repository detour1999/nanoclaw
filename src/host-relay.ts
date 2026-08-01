// ABOUTME: Host-side TCP relays that let Apple Container containers reach
// ABOUTME: LAN/Tailscale hosts by forwarding through the container gateway interface.

import net from 'net';

import { CONTAINER_HOST_GATEWAY } from './container-runtime.js';
import { logger } from './logger.js';

interface Relay {
  server: net.Server;
  listen: number;
  target: string;
  group: string;
}

// Keyed by `${bindHost}:${listen}` so multiple groups can share a relay port
// if they happen to declare the same forward (idempotent).
const active = new Map<string, Relay>();

function parseTarget(target: string): { host: string; port: number } | null {
  const idx = target.lastIndexOf(':');
  if (idx < 1) return null;
  const host = target.slice(0, idx);
  const port = Number(target.slice(idx + 1));
  if (!Number.isInteger(port) || port <= 0 || port > 65535) return null;
  return { host, port };
}

function bindHost(): string {
  // Container gateway is what containers see as the host. On Apple Container
  // this is the auto-detected 192.168.64.1 style address; on Docker for Mac
  // it may be host.docker.internal — we can't bind to a hostname so fall
  // back to 0.0.0.0 (relay is only usable from the container network anyway
  // because that IP is not routable externally).
  const gw = CONTAINER_HOST_GATEWAY;
  return /^\d+\.\d+\.\d+\.\d+$/.test(gw) ? gw : '0.0.0.0';
}

/**
 * Start (or reuse) a relay listening on the container gateway interface at
 * `listen`, forwarding each connection to `target`. Safe to call multiple
 * times for the same (bindHost,listen) pair.
 */
export function ensureRelay(
  group: string,
  listen: number,
  target: string,
): void {
  const host = bindHost();
  const key = `${host}:${listen}`;
  if (active.has(key)) return;

  const dest = parseTarget(target);
  if (!dest) {
    logger.warn({ group, target }, 'hostRelay: invalid target, skipping');
    return;
  }

  const startServer = (attempt: number): void => {
    const server = net.createServer((client) => {
      const upstream = net.connect(dest.port, dest.host);
      client.pipe(upstream);
      upstream.pipe(client);
      client.on('error', () => upstream.destroy());
      upstream.on('error', () => client.destroy());
    });
    server.once('error', (err: NodeJS.ErrnoException) => {
      // Apple Container's bridge interface (bridge100) is created lazily —
      // may not be up at nanoclaw boot. Retry a handful of times before
      // giving up so the relay comes online after the first container spawns.
      if (err.code === 'EADDRNOTAVAIL' && attempt < 20) {
        setTimeout(() => startServer(attempt + 1), 1000);
        return;
      }
      logger.warn(
        { group, host, listen, target, attempt, err: err.message },
        'hostRelay: server error',
      );
    });
    server.listen(listen, host, () => {
      logger.info(
        { group, bind: `${host}:${listen}`, target, attempt },
        'hostRelay: listening',
      );
      active.set(key, { server, listen, target, group });
    });
  };
  startServer(0);
}

/** Close all relays. Called on shutdown so the port is released promptly. */
export function stopAllRelays(): void {
  for (const [key, r] of active) {
    r.server.close();
    active.delete(key);
  }
}

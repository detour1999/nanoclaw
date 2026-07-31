// ABOUTME: Resolve ${op:Vault/Item/field} template refs in arbitrary JSON via 1Password CLI.
// ABOUTME: Used to inject secrets into container config at spawn time without storing them in the DB.

import { execFile } from 'child_process';

import { readEnvFile } from './env.js';
import { logger } from './logger.js';

const OP_REF_RE = /\$\{op:([^}]+)\}/g;

function opRead(ref: string, opToken: string): Promise<string> {
  return new Promise((resolve, reject) => {
    execFile(
      'op',
      ['read', `op://${ref}`],
      {
        env: { ...process.env, OP_SERVICE_ACCOUNT_TOKEN: opToken },
        timeout: 10000,
      },
      (err, stdout, stderr) => {
        if (err) reject(new Error(stderr?.trim() || err.message));
        else resolve(stdout.trim());
      },
    );
  });
}

async function resolveString(s: string, opToken: string): Promise<string> {
  const matches = [...s.matchAll(OP_REF_RE)];
  if (matches.length === 0) return s;
  let out = s;
  for (const m of matches) {
    const value = await opRead(m[1], opToken);
    out = out.split(m[0]).join(value);
  }
  return out;
}

/**
 * Walk an arbitrary JSON-shaped value and resolve any ${op:...} refs found in
 * string values. Requires OP_SERVICE_ACCOUNT_TOKEN in the host .env; if absent,
 * strings containing refs are returned unchanged and a warning is logged (the
 * downstream consumer decides whether to fail closed).
 */
export async function resolveOpRefs<T>(value: T): Promise<T> {
  const opToken = readEnvFile(['OP_SERVICE_ACCOUNT_TOKEN'])[
    'OP_SERVICE_ACCOUNT_TOKEN'
  ];
  if (!opToken) {
    logger.warn(
      'OP_SERVICE_ACCOUNT_TOKEN not set — ${op:...} refs will not be resolved',
    );
    return value;
  }
  const walk = async (v: unknown): Promise<unknown> => {
    if (typeof v === 'string') return resolveString(v, opToken);
    if (Array.isArray(v)) return Promise.all(v.map(walk));
    if (v && typeof v === 'object') {
      const out: Record<string, unknown> = {};
      for (const [k, val] of Object.entries(v)) out[k] = await walk(val);
      return out;
    }
    return v;
  };
  return (await walk(value)) as T;
}

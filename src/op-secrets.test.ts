// ABOUTME: Tests for 1Password reference parsing and wrong-vault fallback logic.
// ABOUTME: The service account sees one vault, so agents routinely guess the vault wrong.

import { describe, it, expect } from 'vitest';
import {
  parseOpReference,
  pickSearchVaults,
  buildSecretHint,
  pickSecretField,
  rankCandidateTitles,
} from './op-secrets.js';

describe('parseOpReference', () => {
  it('splits a full op:// reference', () => {
    expect(parseOpReference('op://Homelab Agents/Proxmox/password')).toEqual({
      vault: 'Homelab Agents',
      item: 'Proxmox',
      field: 'password',
    });
  });

  it('tolerates a missing op:// prefix', () => {
    expect(parseOpReference('Homelab Agents/Proxmox/password').item).toBe(
      'Proxmox',
    );
  });

  it('defaults the field to password when omitted', () => {
    expect(parseOpReference('op://Personal/Netlify').field).toBe('password');
  });

  it('preserves a vault or item name containing spaces', () => {
    const r = parseOpReference(
      'op://Homelab Agents/Synology Home Remote/password',
    );
    expect(r.vault).toBe('Homelab Agents');
    expect(r.item).toBe('Synology Home Remote');
  });

  it('returns an empty item rather than throwing on junk input', () => {
    expect(parseOpReference('').item).toBe('');
  });
});

describe('pickSearchVaults', () => {
  const accessible = ['Homelab Agents'];

  it('searches only the requested vault when it is accessible', () => {
    expect(pickSearchVaults('Homelab Agents', accessible)).toEqual([
      'Homelab Agents',
    ]);
  });

  it('falls back to every accessible vault when the request names an unreachable one', () => {
    // The real failure: agent asked for op://Personal/Netlify/password while
    // "Netlify " lives in Homelab Agents. Searching "Personal" is a dead end.
    expect(pickSearchVaults('Personal', accessible)).toEqual([
      'Homelab Agents',
    ]);
  });

  it('is case-insensitive about the requested vault name', () => {
    expect(pickSearchVaults('homelab agents', accessible)).toEqual([
      'Homelab Agents',
    ]);
  });

  it('returns all accessible vaults when there are several', () => {
    expect(pickSearchVaults('Nope', ['A', 'B'])).toEqual(['A', 'B']);
  });

  it('returns an empty list when nothing is accessible', () => {
    expect(pickSearchVaults('Personal', [])).toEqual([]);
  });
});

describe('buildSecretHint', () => {
  it('tells the agent to retry with the suggested reference when candidates exist', () => {
    const hint = buildSecretHint(
      'Netlify',
      ['Homelab Agents'],
      [
        {
          title: 'Netlify ',
          username: null,
          updated_at: null,
          suggested_reference: 'op://Homelab Agents/Netlify /password',
        },
      ],
    );
    expect(hint).toContain('suggested_reference');
    expect(hint).toContain('1 candidate');
  });

  it('names the vaults actually searched, not the one requested', () => {
    const hint = buildSecretHint('Netlify', ['Homelab Agents'], []);
    expect(hint).toContain('Homelab Agents');
    expect(hint).not.toContain('Personal');
  });

  it('says so plainly when the service account can reach no vaults', () => {
    const hint = buildSecretHint('Netlify', [], []);
    expect(hint).toMatch(/no vaults/i);
  });
});

describe('pickSecretField', () => {
  const f = (label: string, type: string, value?: string) => ({
    label,
    type,
    value,
  });

  it('prefers a populated password field', () => {
    expect(
      pickSecretField([
        f('credential', 'CONCEALED', 'x'),
        f('password', 'CONCEALED', 'y'),
      ]),
    ).toBe('password');
  });

  it('falls back to another concealed field when there is no password', () => {
    // The real Netlify item: secret lives in "credential", not "password".
    // Suggesting /password produced "does not have a field 'password'".
    expect(
      pickSecretField([
        f('notesPlain', 'STRING', 'note'),
        f('username', 'STRING'),
        f('credential', 'CONCEALED', 'x'),
        f('hostname', 'STRING'),
      ]),
    ).toBe('credential');
  });

  it('ignores concealed fields that have no value', () => {
    expect(
      pickSecretField([
        f('password', 'CONCEALED'),
        f('token', 'CONCEALED', 'x'),
      ]),
    ).toBe('token');
  });

  it('returns password as a last resort when nothing is concealed', () => {
    expect(pickSecretField([f('username', 'STRING', 'bob')])).toBe('password');
  });

  it('handles an empty field list', () => {
    expect(pickSecretField([])).toBe('password');
  });
});

describe('rankCandidateTitles', () => {
  const VAULT = [
    'Homelab Anthropic Key',
    'Proxmox',
    'Synology Home Remote',
    'Netlify ',
    'readarr',
  ];

  it('finds an item when the query words are reordered or padded', () => {
    // Hal asked for "Anthropic API Key"; the item is "Homelab Anthropic Key".
    // A whole-string substring test finds nothing, which is what left him stuck.
    expect(rankCandidateTitles(VAULT, 'Anthropic API Key')).toContain(
      'Homelab Anthropic Key',
    );
  });

  it('still matches a plain substring query', () => {
    expect(rankCandidateTitles(VAULT, 'Netlify')).toEqual(['Netlify ']);
  });

  it('is case- and whitespace-insensitive', () => {
    expect(rankCandidateTitles(VAULT, '  netlify  ')).toEqual(['Netlify ']);
  });

  it('ranks the closest title first', () => {
    const ranked = rankCandidateTitles(
      ['Anthropic Billing', 'Homelab Anthropic Key'],
      'Anthropic Key',
    );
    expect(ranked[0]).toBe('Homelab Anthropic Key');
  });

  it('returns nothing when no meaningful word overlaps', () => {
    expect(rankCandidateTitles(VAULT, 'Cloudflare')).toEqual([]);
  });

  it('ignores noise words so they cannot match everything', () => {
    // "key"/"api" are common; a query of only noise should not match all items.
    expect(rankCandidateTitles(VAULT, 'the')).toEqual([]);
  });

  it('caps how many candidates it returns', () => {
    const many = Array.from({ length: 40 }, (_, i) => `Anthropic ${i}`);
    expect(rankCandidateTitles(many, 'Anthropic').length).toBeLessThanOrEqual(
      5,
    );
  });

  it('handles an empty query and an empty vault', () => {
    expect(rankCandidateTitles(VAULT, '')).toEqual([]);
    expect(rankCandidateTitles([], 'Anthropic')).toEqual([]);
  });
});

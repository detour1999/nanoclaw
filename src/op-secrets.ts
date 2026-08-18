// ABOUTME: 1Password reference parsing and wrong-vault fallback for the get_secret IPC tool.
// ABOUTME: The service account can reach few vaults, so agents often name one it cannot see.

export interface OpReference {
  vault: string;
  item: string;
  field: string;
}

export interface SecretCandidate {
  title: string;
  username: string | null;
  updated_at: string | null;
  suggested_reference: string;
}

/** Split `op://Vault/Item/field` into parts, defaulting the field to password. */
export function parseOpReference(reference: string): OpReference {
  const parts = reference.replace(/^op:\/\//, '').split('/');
  return {
    vault: parts[0] ?? '',
    item: parts[1] ?? '',
    field: parts[2] || 'password',
  };
}

/**
 * Decide which vaults to search after a failed read.
 *
 * Searching the vault the agent named is useless when that vault is not one the
 * service account can see — `op item list` just fails again and the agent gets
 * "no items in vault X" for a secret that exists elsewhere. In that case search
 * everything actually reachable instead.
 */
export function pickSearchVaults(
  requestedVault: string,
  accessibleVaults: string[],
): string[] {
  const match = accessibleVaults.find(
    (v) => v.toLowerCase() === requestedVault.trim().toLowerCase(),
  );
  return match ? [match] : accessibleVaults;
}

export interface OpField {
  label: string;
  type: string;
  value?: string;
}

/**
 * Choose the field most likely to hold the secret.
 *
 * Items in this account do not consistently use `password` — the Netlify entry
 * stores its secret under `credential`, so a hardcoded `/password` reference
 * resolved the item and then failed on the field. Prefer a populated
 * `password`, else any other populated CONCEALED field.
 */
export function pickSecretField(fields: OpField[]): string {
  const concealed = fields.filter(
    (f) => f.type === 'CONCEALED' && f.value && f.value.length > 0,
  );
  const password = concealed.find((f) => f.label.toLowerCase() === 'password');
  return password?.label ?? concealed[0]?.label ?? 'password';
}

/** Compose the operator-facing hint returned alongside a failed lookup. */
export function buildSecretHint(
  itemTerm: string,
  searchedVaults: string[],
  candidates: SecretCandidate[],
): string {
  if (searchedVaults.length === 0) {
    return 'The 1Password service account can reach no vaults — check OP_SERVICE_ACCOUNT_TOKEN and its vault grants.';
  }
  const where = searchedVaults.map((v) => `"${v}"`).join(', ');
  if (candidates.length > 0) {
    return `No exact match for "${itemTerm}". ${candidates.length} candidate(s) found in ${where} — retry with suggested_reference.`;
  }
  return `No items matching "${itemTerm}" in the vault(s) this service account can reach: ${where}.`;
}

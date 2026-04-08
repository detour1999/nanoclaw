// ABOUTME: Parser/renderer for task documentation files in docs/tasks/.
// ABOUTME: Frontmatter (yaml) + markdown body + canonical ## Prompt fenced block.
import { parse as parseYaml, stringify as stringifyYaml } from 'yaml';

export interface TaskDocFrontmatter {
  name: string;
  schedule_type: 'cron' | 'interval' | 'once';
  schedule_value: string;
  context_mode?: 'group' | 'isolated';
  requires_host_access?: boolean;
  vars?: Record<string, string>;
}

export interface TaskDoc {
  frontmatter: TaskDocFrontmatter;
  /** Prompt body extracted from the ## Prompt fenced code block (placeholders unresolved). */
  prompt: string;
  /** The full markdown body (everything after the frontmatter), unmodified. */
  body: string;
}

const FRONTMATTER_RE = /^---\n([\s\S]*?)\n---\n?([\s\S]*)$/;

/**
 * Locate the prompt block: a fenced code block (```text or plain ```) under
 * a `## Prompt` heading. Returns the inner text or null if not found.
 */
function extractPromptBlock(body: string): string | null {
  // Find the ## Prompt heading
  const headingMatch = body.match(/^##\s+Prompt\s*$/m);
  if (!headingMatch) return null;
  const after = body.slice(headingMatch.index! + headingMatch[0].length);

  // Find the first fenced block after the heading
  const fenceRe = /```(?:text|markdown|md)?\n([\s\S]*?)\n```/;
  const fenceMatch = after.match(fenceRe);
  if (!fenceMatch) return null;
  return fenceMatch[1];
}

function validateFrontmatter(fm: unknown): TaskDocFrontmatter {
  if (!fm || typeof fm !== 'object') {
    throw new Error('Invalid task doc: frontmatter must be an object');
  }
  const f = fm as Record<string, unknown>;
  if (typeof f.name !== 'string' || !f.name) {
    throw new Error('Invalid task doc: frontmatter.name is required');
  }
  if (
    f.schedule_type !== 'cron' &&
    f.schedule_type !== 'interval' &&
    f.schedule_type !== 'once'
  ) {
    throw new Error(
      'Invalid task doc: frontmatter.schedule_type must be cron|interval|once',
    );
  }
  if (typeof f.schedule_value !== 'string' || !f.schedule_value) {
    throw new Error('Invalid task doc: frontmatter.schedule_value is required');
  }
  if (
    f.context_mode !== undefined &&
    f.context_mode !== 'group' &&
    f.context_mode !== 'isolated'
  ) {
    throw new Error(
      'Invalid task doc: frontmatter.context_mode must be group|isolated',
    );
  }
  if (
    f.requires_host_access !== undefined &&
    typeof f.requires_host_access !== 'boolean'
  ) {
    throw new Error(
      'Invalid task doc: frontmatter.requires_host_access must be a boolean',
    );
  }
  if (f.vars !== undefined) {
    if (typeof f.vars !== 'object' || f.vars === null || Array.isArray(f.vars)) {
      throw new Error('Invalid task doc: frontmatter.vars must be a map');
    }
    for (const [k, v] of Object.entries(f.vars as Record<string, unknown>)) {
      if (typeof v !== 'string') {
        throw new Error(
          `Invalid task doc: frontmatter.vars.${k} must be a string`,
        );
      }
    }
  }
  return {
    name: f.name,
    schedule_type: f.schedule_type,
    schedule_value: f.schedule_value,
    context_mode: f.context_mode as 'group' | 'isolated' | undefined,
    requires_host_access: f.requires_host_access as boolean | undefined,
    vars: f.vars as Record<string, string> | undefined,
  };
}

export function parseTaskDoc(content: string): TaskDoc {
  const match = content.match(FRONTMATTER_RE);
  if (!match) {
    throw new Error('Invalid task doc: missing frontmatter');
  }
  const [, yamlText, body] = match;
  const fm = validateFrontmatter(parseYaml(yamlText));
  const prompt = extractPromptBlock(body);
  if (prompt === null) {
    throw new Error(
      'Invalid task doc: missing prompt — expected a fenced code block under "## Prompt"',
    );
  }
  return { frontmatter: fm, prompt, body };
}

export function substituteVars(
  text: string,
  vars: Record<string, string>,
): string {
  return text.replace(/\{\{\s*(\w+)\s*\}\}/g, (full, key) => {
    return Object.prototype.hasOwnProperty.call(vars, key) ? vars[key] : full;
  });
}

export function renderTaskDoc(
  frontmatter: TaskDocFrontmatter,
  body: string,
  prompt: string,
): string {
  const yamlBlock = stringifyYaml(frontmatter).trimEnd();
  const trimmedBody = body.trimEnd();
  const sections: string[] = [];
  sections.push(`---\n${yamlBlock}\n---`);
  if (trimmedBody) {
    sections.push(trimmedBody);
  }
  sections.push(`## Prompt\n\n\`\`\`text\n${prompt}\n\`\`\``);
  return sections.join('\n\n') + '\n';
}

// ABOUTME: Tests for task documentation parser/renderer used by document_task and install_task.
// ABOUTME: Covers frontmatter parsing, prompt extraction, and variable substitution.
import { describe, it, expect } from 'vitest';

import {
  parseTaskDoc,
  renderTaskDoc,
  substituteVars,
  TaskDocFrontmatter,
} from './task-doc.js';

const sampleDoc = `---
name: session-health-monitor
schedule_type: cron
schedule_value: "*/10 * * * *"
context_mode: isolated
requires_host_access: true
vars:
  agent_name: Reed
  user_name: Dylan
---

# Session Health Monitor

Watches every \`claude\` pane on the host and auto-restarts after rate limits.

## Prompt

\`\`\`text
You are {{agent_name}}, {{user_name}}'s work agent.
Run the session health check now.
\`\`\`

## State file

Lives at \`/workspace/group/session-health-state.json\`.
`;

describe('parseTaskDoc', () => {
  it('extracts frontmatter fields', () => {
    const doc = parseTaskDoc(sampleDoc);
    expect(doc.frontmatter.name).toBe('session-health-monitor');
    expect(doc.frontmatter.schedule_type).toBe('cron');
    expect(doc.frontmatter.schedule_value).toBe('*/10 * * * *');
    expect(doc.frontmatter.context_mode).toBe('isolated');
    expect(doc.frontmatter.requires_host_access).toBe(true);
    expect(doc.frontmatter.vars).toEqual({
      agent_name: 'Reed',
      user_name: 'Dylan',
    });
  });

  it('extracts the prompt from the ## Prompt fenced block', () => {
    const doc = parseTaskDoc(sampleDoc);
    expect(doc.prompt).toContain('You are {{agent_name}}');
    expect(doc.prompt).toContain("{{user_name}}'s work agent");
    expect(doc.prompt).not.toContain('```');
    expect(doc.prompt).not.toContain('## Prompt');
  });

  it('preserves the body content separately from the prompt', () => {
    const doc = parseTaskDoc(sampleDoc);
    expect(doc.body).toContain('# Session Health Monitor');
    expect(doc.body).toContain('## State file');
  });

  it('rejects docs missing frontmatter', () => {
    expect(() => parseTaskDoc('# Just a heading')).toThrow(/frontmatter/i);
  });

  it('rejects docs missing required frontmatter fields', () => {
    const bad = `---
name: foo
---

## Prompt

\`\`\`text
hi
\`\`\`
`;
    expect(() => parseTaskDoc(bad)).toThrow(/schedule_type/);
  });

  it('rejects docs missing a ## Prompt block', () => {
    const bad = `---
name: foo
schedule_type: cron
schedule_value: "* * * * *"
---

# Foo

No prompt here.
`;
    expect(() => parseTaskDoc(bad)).toThrow(/prompt/i);
  });

  it('accepts a fenced block without a language tag', () => {
    const doc = `---
name: foo
schedule_type: cron
schedule_value: "* * * * *"
---

## Prompt

\`\`\`
plain prompt body
\`\`\`
`;
    const parsed = parseTaskDoc(doc);
    expect(parsed.prompt).toBe('plain prompt body');
  });
});

describe('substituteVars', () => {
  it('replaces {{var}} placeholders', () => {
    const result = substituteVars('hello {{name}}, you are {{role}}', {
      name: 'Dylan',
      role: 'admin',
    });
    expect(result).toBe('hello Dylan, you are admin');
  });

  it('leaves unknown placeholders intact', () => {
    const result = substituteVars('hello {{name}} and {{other}}', {
      name: 'Dylan',
    });
    expect(result).toBe('hello Dylan and {{other}}');
  });

  it('handles repeated placeholders', () => {
    const result = substituteVars('{{x}} and {{x}}', { x: 'foo' });
    expect(result).toBe('foo and foo');
  });

  it('returns input unchanged when vars is empty', () => {
    expect(substituteVars('no {{vars}} here', {})).toBe('no {{vars}} here');
  });
});

describe('renderTaskDoc', () => {
  it('produces a doc that round-trips through parseTaskDoc', () => {
    const fm: TaskDocFrontmatter = {
      name: 'test-task',
      schedule_type: 'interval',
      schedule_value: '60000',
      context_mode: 'group',
    };
    const body = '# Test Task\n\nA test task.';
    const prompt = 'do the thing';

    const rendered = renderTaskDoc(fm, body, prompt);
    const parsed = parseTaskDoc(rendered);

    expect(parsed.frontmatter.name).toBe('test-task');
    expect(parsed.frontmatter.schedule_type).toBe('interval');
    expect(parsed.frontmatter.schedule_value).toBe('60000');
    expect(parsed.prompt).toBe('do the thing');
    expect(parsed.body).toContain('# Test Task');
  });

  it('handles multi-line prompts with special characters', () => {
    const prompt = 'line one\nline two with `backticks` and "quotes"';
    const rendered = renderTaskDoc(
      {
        name: 'multi',
        schedule_type: 'once',
        schedule_value: '2026-04-08T09:00:00',
      },
      '',
      prompt,
    );
    const parsed = parseTaskDoc(rendered);
    expect(parsed.prompt).toBe(prompt);
  });
});

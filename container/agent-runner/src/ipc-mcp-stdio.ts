/**
 * Stdio MCP Server for NanoClaw
 * Standalone process that agent teams subagents can inherit.
 * Reads context from environment variables, writes IPC files for the host.
 */

import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { z } from 'zod';
import fs from 'fs';
import path from 'path';
import { CronExpressionParser } from 'cron-parser';
import { truncateChars } from './text.js';

const IPC_DIR = '/workspace/ipc';
const MESSAGES_DIR = path.join(IPC_DIR, 'messages');
const TASKS_DIR = path.join(IPC_DIR, 'tasks');

// Context from environment variables (set by the agent runner)
const chatJid = process.env.NANOCLAW_CHAT_JID!;
const groupFolder = process.env.NANOCLAW_GROUP_FOLDER!;
const isMain = process.env.NANOCLAW_IS_MAIN === '1';
const hasHostAccess = process.env.NANOCLAW_HOST_ACCESS === '1';

function writeIpcFile(dir: string, data: object): string {
  fs.mkdirSync(dir, { recursive: true });

  const filename = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}.json`;
  const filepath = path.join(dir, filename);

  // Atomic write: temp file then rename
  const tempPath = `${filepath}.tmp`;
  fs.writeFileSync(tempPath, JSON.stringify(data, null, 2));
  fs.renameSync(tempPath, filepath);

  return filename;
}

const server = new McpServer({
  name: 'nanoclaw',
  version: '1.0.0',
});

server.tool(
  'send_message',
  "Send a message to the user or group immediately while you're still running. Use this for progress updates or to send multiple messages. You can call this multiple times.",
  {
    text: z.string().describe('The message text to send'),
    sender: z.string().optional().describe('Your role/identity name (e.g. "Researcher"). When set, messages appear from a dedicated bot in Telegram.'),
  },
  async (args) => {
    const data: Record<string, string | undefined> = {
      type: 'message',
      chatJid,
      text: args.text,
      sender: args.sender || undefined,
      groupFolder,
      timestamp: new Date().toISOString(),
    };

    writeIpcFile(MESSAGES_DIR, data);

    return { content: [{ type: 'text' as const, text: 'Message sent.' }] };
  },
);

server.tool(
  'schedule_task',
  `Schedule a recurring or one-time task. The task will run as a full agent with access to all tools. Returns the task ID for future reference. To modify an existing task, use update_task instead.

CONTEXT MODE - Choose based on task type:
\u2022 "group": Task runs in the group's conversation context, with access to chat history. Use for tasks that need context about ongoing discussions, user preferences, or recent interactions.
\u2022 "isolated": Task runs in a fresh session with no conversation history. Use for independent tasks that don't need prior context. When using isolated mode, include all necessary context in the prompt itself.

If unsure which mode to use, you can ask the user. Examples:
- "Remind me about our discussion" \u2192 group (needs conversation context)
- "Check the weather every morning" \u2192 isolated (self-contained task)
- "Follow up on my request" \u2192 group (needs to know what was requested)
- "Generate a daily report" \u2192 isolated (just needs instructions in prompt)

MESSAGING BEHAVIOR - The task agent's output is sent to the user or group. It can also use send_message for immediate delivery, or wrap output in <internal> tags to suppress it. Include guidance in the prompt about whether the agent should:
\u2022 Always send a message (e.g., reminders, daily briefings)
\u2022 Only send a message when there's something to report (e.g., "notify me if...")
\u2022 Never send a message (background maintenance tasks)

SCHEDULE VALUE FORMAT (all times are LOCAL timezone):
\u2022 cron: Standard cron expression (e.g., "*/5 * * * *" for every 5 minutes, "0 9 * * *" for daily at 9am LOCAL time)
\u2022 interval: Milliseconds between runs (e.g., "300000" for 5 minutes, "3600000" for 1 hour)
\u2022 once: Local time WITHOUT "Z" suffix (e.g., "2026-02-01T15:30:00"). Do NOT use UTC/Z suffix.`,
  {
    prompt: z.string().describe('What the agent should do when the task runs. For isolated mode, include all necessary context here.'),
    schedule_type: z.enum(['cron', 'interval', 'once']).describe('cron=recurring at specific times, interval=recurring every N ms, once=run once at specific time'),
    schedule_value: z.string().describe('cron: "*/5 * * * *" | interval: milliseconds like "300000" | once: local timestamp like "2026-02-01T15:30:00" (no Z suffix!)'),
    context_mode: z.enum(['group', 'isolated']).default('group').describe('group=runs with chat history and memory, isolated=fresh session (include context in prompt)'),
    target_group_jid: z.string().optional().describe('JID of the group to schedule the task for. Defaults to the current group.'),
  },
  async (args) => {
    // Validate schedule_value before writing IPC
    if (args.schedule_type === 'cron') {
      try {
        CronExpressionParser.parse(args.schedule_value);
      } catch {
        return {
          content: [{ type: 'text' as const, text: `Invalid cron: "${args.schedule_value}". Use format like "0 9 * * *" (daily 9am) or "*/5 * * * *" (every 5 min).` }],
          isError: true,
        };
      }
    } else if (args.schedule_type === 'interval') {
      const ms = parseInt(args.schedule_value, 10);
      if (isNaN(ms) || ms <= 0) {
        return {
          content: [{ type: 'text' as const, text: `Invalid interval: "${args.schedule_value}". Must be positive milliseconds (e.g., "300000" for 5 min).` }],
          isError: true,
        };
      }
    } else if (args.schedule_type === 'once') {
      if (/[Zz]$/.test(args.schedule_value) || /[+-]\d{2}:\d{2}$/.test(args.schedule_value)) {
        return {
          content: [{ type: 'text' as const, text: `Timestamp must be local time without timezone suffix. Got "${args.schedule_value}" — use format like "2026-02-01T15:30:00".` }],
          isError: true,
        };
      }
      const date = new Date(args.schedule_value);
      if (isNaN(date.getTime())) {
        return {
          content: [{ type: 'text' as const, text: `Invalid timestamp: "${args.schedule_value}". Use local time format like "2026-02-01T15:30:00".` }],
          isError: true,
        };
      }
    }

    // Use target_group_jid if provided (IPC layer enforces auth for non-main groups)
    const targetJid = args.target_group_jid ?? chatJid;

    const taskId = `task-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;

    const data = {
      type: 'schedule_task',
      taskId,
      prompt: args.prompt,
      schedule_type: args.schedule_type,
      schedule_value: args.schedule_value,
      context_mode: args.context_mode || 'group',
      targetJid,
      createdBy: groupFolder,
      timestamp: new Date().toISOString(),
    };

    writeIpcFile(TASKS_DIR, data);

    return {
      content: [{ type: 'text' as const, text: `Task ${taskId} scheduled: ${args.schedule_type} - ${args.schedule_value}` }],
    };
  },
);

server.tool(
  'list_tasks',
  "List all scheduled tasks. From main: shows all tasks. From other groups: shows only that group's tasks.",
  {},
  async () => {
    const tasksFile = path.join(IPC_DIR, 'current_tasks.json');

    try {
      if (!fs.existsSync(tasksFile)) {
        return { content: [{ type: 'text' as const, text: 'No scheduled tasks found.' }] };
      }

      const allTasks = JSON.parse(fs.readFileSync(tasksFile, 'utf-8'));

      const tasks = isMain
        ? allTasks
        : allTasks.filter((t: { groupFolder: string }) => t.groupFolder === groupFolder);

      if (tasks.length === 0) {
        return { content: [{ type: 'text' as const, text: 'No scheduled tasks found.' }] };
      }

      const formatted = tasks
        .map(
          (t: { id: string; prompt: string; schedule_type: string; schedule_value: string; status: string; next_run: string }) =>
            `- [${t.id}] ${truncateChars(t.prompt, 50)} (${t.schedule_type}: ${t.schedule_value}) - ${t.status}, next: ${t.next_run || 'N/A'}`,
        )
        .join('\n');

      return { content: [{ type: 'text' as const, text: `Scheduled tasks:\n${formatted}` }] };
    } catch (err) {
      return {
        content: [{ type: 'text' as const, text: `Error reading tasks: ${err instanceof Error ? err.message : String(err)}` }],
      };
    }
  },
);

server.tool(
  'pause_task',
  'Pause a scheduled task. It will not run until resumed.',
  { task_id: z.string().describe('The task ID to pause') },
  async (args) => {
    const data = {
      type: 'pause_task',
      taskId: args.task_id,
      groupFolder,
      isMain,
      timestamp: new Date().toISOString(),
    };

    writeIpcFile(TASKS_DIR, data);

    return { content: [{ type: 'text' as const, text: `Task ${args.task_id} pause requested.` }] };
  },
);

server.tool(
  'resume_task',
  'Resume a paused task.',
  { task_id: z.string().describe('The task ID to resume') },
  async (args) => {
    const data = {
      type: 'resume_task',
      taskId: args.task_id,
      groupFolder,
      isMain,
      timestamp: new Date().toISOString(),
    };

    writeIpcFile(TASKS_DIR, data);

    return { content: [{ type: 'text' as const, text: `Task ${args.task_id} resume requested.` }] };
  },
);

server.tool(
  'cancel_task',
  'Cancel and delete a scheduled task.',
  { task_id: z.string().describe('The task ID to cancel') },
  async (args) => {
    const data = {
      type: 'cancel_task',
      taskId: args.task_id,
      groupFolder,
      isMain,
      timestamp: new Date().toISOString(),
    };

    writeIpcFile(TASKS_DIR, data);

    return { content: [{ type: 'text' as const, text: `Task ${args.task_id} cancellation requested.` }] };
  },
);

server.tool(
  'update_task',
  'Update an existing scheduled task. Only provided fields are changed; omitted fields stay the same.',
  {
    task_id: z.string().describe('The task ID to update'),
    prompt: z.string().optional().describe('New prompt for the task'),
    schedule_type: z.enum(['cron', 'interval', 'once']).optional().describe('New schedule type'),
    schedule_value: z.string().optional().describe('New schedule value (see schedule_task for format)'),
  },
  async (args) => {
    // Validate schedule_value if provided
    if (args.schedule_type === 'cron' || (!args.schedule_type && args.schedule_value)) {
      if (args.schedule_value) {
        try {
          CronExpressionParser.parse(args.schedule_value);
        } catch {
          return {
            content: [{ type: 'text' as const, text: `Invalid cron: "${args.schedule_value}".` }],
            isError: true,
          };
        }
      }
    }
    if (args.schedule_type === 'interval' && args.schedule_value) {
      const ms = parseInt(args.schedule_value, 10);
      if (isNaN(ms) || ms <= 0) {
        return {
          content: [{ type: 'text' as const, text: `Invalid interval: "${args.schedule_value}".` }],
          isError: true,
        };
      }
    }

    const data: Record<string, string | undefined> = {
      type: 'update_task',
      taskId: args.task_id,
      groupFolder,
      isMain: String(isMain),
      timestamp: new Date().toISOString(),
    };
    if (args.prompt !== undefined) data.prompt = args.prompt;
    if (args.schedule_type !== undefined) data.schedule_type = args.schedule_type;
    if (args.schedule_value !== undefined) data.schedule_value = args.schedule_value;

    writeIpcFile(TASKS_DIR, data);

    return { content: [{ type: 'text' as const, text: `Task ${args.task_id} update requested.` }] };
  },
);

server.tool(
  'ssh_localhost',
  'Execute a command on the host machine via SSH. Requires host access privilege. Use for checking tmux sessions, running builds, managing files, or any host-level operation. The command runs as the host user with full access. Returns the command output synchronously.',
  {
    command: z.string().describe('Shell command to execute on localhost (e.g., "tmux list-sessions", "ls ~/work")'),
  },
  async (args) => {
    if (!hasHostAccess) {
      return {
        content: [{ type: 'text' as const, text: 'Error: SSH commands require host access privilege.' }],
        isError: true,
      };
    }

    const requestId = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    const responsesDir = path.join(IPC_DIR, 'responses');
    fs.mkdirSync(responsesDir, { recursive: true });
    const responseFile = path.join(responsesDir, `${requestId}.json`);

    const data = {
      type: 'ssh_localhost',
      requestId,
      command: args.command,
      chatJid,
      groupFolder,
      timestamp: new Date().toISOString(),
    };

    writeIpcFile(TASKS_DIR, data);

    // Poll for response file (host writes it when SSH completes)
    const timeout = 30000;
    const interval = 100;
    const deadline = Date.now() + timeout;

    while (Date.now() < deadline) {
      await new Promise(r => setTimeout(r, interval));
      if (fs.existsSync(responseFile)) {
        try {
          const result = JSON.parse(fs.readFileSync(responseFile, 'utf-8'));
          fs.unlinkSync(responseFile);
          if (result.error) {
            return { content: [{ type: 'text' as const, text: `SSH error: ${result.error}` }], isError: true };
          }
          return { content: [{ type: 'text' as const, text: result.output }] };
        } catch {
          fs.unlinkSync(responseFile);
          return { content: [{ type: 'text' as const, text: 'Failed to parse SSH response' }], isError: true };
        }
      }
    }

    return { content: [{ type: 'text' as const, text: 'SSH command timed out after 30s' }], isError: true };
  },
);


server.tool(
  'get_book',
  'Add a book to your Kindle via BookDrop. Searches for the book, downloads it, and emails it to your Kindle. Takes a few minutes. Use this when asked to send a book to Kindle.',
  {
    title: z.string().describe('Book title to search for'),
    author: z.string().optional().describe('Author name (optional, improves search accuracy)'),
  },
  async (args) => {
    const requestId = Date.now() + '-' + Math.random().toString(36).slice(2, 8);
    const responsesDir = path.join(IPC_DIR, 'responses');
    fs.mkdirSync(responsesDir, { recursive: true });
    const responseFile = path.join(responsesDir, requestId + '.json');

    const data = {
      type: 'get_book',
      requestId,
      title: args.title,
      author: args.author,
      chatJid,
      groupFolder,
      timestamp: new Date().toISOString(),
    };

    writeIpcFile(TASKS_DIR, data);

    // Poll for a response, but don't hold the turn open for BookDrop's full
    // 30-minute worst case — the host keeps running it after we stop waiting.
    const timeout = 300000;
    const interval = 2000;
    const deadline = Date.now() + timeout;

    while (Date.now() < deadline) {
      await new Promise(r => setTimeout(r, interval));
      if (fs.existsSync(responseFile)) {
        try {
          const result = JSON.parse(fs.readFileSync(responseFile, 'utf-8'));
          fs.unlinkSync(responseFile);
          if (result.error) {
            return { content: [{ type: 'text' as const, text: 'BookDrop error: ' + result.error }], isError: true };
          }
          return { content: [{ type: 'text' as const, text: result.output }] };
        } catch {
          fs.unlinkSync(responseFile);
          return { content: [{ type: 'text' as const, text: 'Failed to parse BookDrop response' }], isError: true };
        }
      }
    }

    // Not an error: BookDrop is still running on Proxmox and will finish on its
    // own. Reporting this as a failure led agents to conclude SSH was broken.
    return {
      content: [{
        type: 'text' as const,
        text: "BookDrop is still running on Proxmox after 5 minutes — this is normal for a book that has to be downloaded first. It keeps running in the background and the book will arrive at the Kindle when it finishes (up to 30 min). Don't retry, and don't report this as an SSH failure.",
      }],
    };
  },
);


server.tool(
  'get_messages',
  `Read recent conversation messages from a group by folder name. You can read your own group and any group that reports to you (main reads all). Leave folder empty to read across all groups (main only). Returns messages in reverse-chronological order.`,
  {
    folder: z.string().describe('Group folder name to read from (e.g. "rando", "jo", "hans", "mo", "reed"). Leave empty to get recent messages across all groups.'),
    limit: z.number().optional().describe('Number of messages to return (default 20, max 200)'),
  },
  async (args) => {
    const requestId = `get_messages_${Date.now()}_${Math.random().toString(36).slice(2)}`;
    const taskPath = `/workspace/ipc/tasks/${requestId}.json`;
    const responsePath = `/workspace/ipc/responses/${requestId}.json`;
    const fs = await import('fs');
    fs.writeFileSync(taskPath, JSON.stringify({ type: 'get_messages', folder: args.folder || '', limit: args.limit || 20, requestId }));
    const start = Date.now();
    while (Date.now() - start < 15000) {
      await new Promise(r => setTimeout(r, 300));
      if (fs.existsSync(responsePath)) {
        const result = JSON.parse(fs.readFileSync(responsePath, 'utf8'));
        fs.unlinkSync(responsePath);
        if (result.error) return { content: [{ type: 'text' as const, text: `Error: ${result.error}` }], isError: true };
        const msgs = (result.messages || []).reverse();
        const lines = msgs.map((m: {timestamp: string; sender: string; is_from_me: number; content: string; folder?: string}) =>
          `[${m.timestamp}] ${m.is_from_me ? '(bot)' : m.sender}: ${m.content}`
        );
        return { content: [{ type: 'text' as const, text: `${result.count} messages from "${result.folder || 'all'}":

${lines.join('\n')}` }] };
      }
    }
    return { content: [{ type: 'text' as const, text: 'get_messages timed out' }], isError: true };
  },
);

server.tool(
  'get_secret',
  'Retrieve a secret from 1Password by reference URI. Reference format: op://VaultName/ItemName/FieldName (e.g. op://Homelab Agents/Proxmox/password). Returns the secret value as a string. If the reference fails or the item name is ambiguous, returns an error with a `candidates` array of fuzzy matches including their titles, usernames, updated_at timestamps, and suggested_reference paths — retry with the correct suggested_reference.',
  {
    reference: z.string().describe('1Password reference URI, e.g. op://Homelab Agents/Proxmox/password'),
  },
  async (args) => {
    const requestId = Date.now() + '-' + Math.random().toString(36).slice(2, 8);
    const responsesDir = path.join(IPC_DIR, 'responses');
    fs.mkdirSync(responsesDir, { recursive: true });
    const responseFile = path.join(responsesDir, requestId + '.json');

    const data = {
      type: 'get_secret',
      requestId,
      reference: args.reference,
      chatJid,
      groupFolder,
      timestamp: new Date().toISOString(),
    };

    writeIpcFile(TASKS_DIR, data);

    // Poll for response
    const timeout = 15000;
    const interval = 500;
    const deadline = Date.now() + timeout;

    while (Date.now() < deadline) {
      await new Promise(r => setTimeout(r, interval));
      if (fs.existsSync(responseFile)) {
        try {
          const result = JSON.parse(fs.readFileSync(responseFile, 'utf-8'));
          fs.unlinkSync(responseFile);
          if (result.error) {
            return { content: [{ type: 'text' as const, text: '1Password error: ' + result.error }], isError: true };
          }
          return { content: [{ type: 'text' as const, text: result.output }] };
        } catch {
          fs.unlinkSync(responseFile);
          return { content: [{ type: 'text' as const, text: 'Failed to parse 1Password response' }], isError: true };
        }
      }
    }

    return { content: [{ type: 'text' as const, text: 'get_secret timed out' }], isError: true };
  },
);

server.tool(
  'restart_nanoclaw',
  'Safely restart the NanoClaw orchestrator service. Requires host access privilege. Use this instead of ssh_localhost with launchctl commands. The service will restart cleanly via launchd after a 2-second delay.',
  {},
  async () => {
    if (!hasHostAccess) {
      return {
        content: [{ type: 'text' as const, text: 'Error: restart requires host access privilege.' }],
        isError: true,
      };
    }

    writeIpcFile(TASKS_DIR, {
      type: 'restart_nanoclaw',
      chatJid,
      groupFolder,
      timestamp: new Date().toISOString(),
    });

    return { content: [{ type: 'text' as const, text: 'Restart requested. NanoClaw will restart in ~2 seconds.' }] };
  },
);

server.tool(
  'document_task',
  `Save an existing scheduled task as a reusable doc in docs/tasks/<slug>.md.

Use this when a task you've created (or that already exists) is worth sharing or reinstalling later. The host will write a markdown file with frontmatter (schedule, context_mode, etc.) and the prompt embedded in a fenced code block.

Provide a short slug (\`name\`) and a 1-3 sentence description of what the task does and why it exists. The doc can be installed elsewhere via install_task.

Defaults to refusing if the file already exists; pass force:true to overwrite.`,
  {
    task_id: z.string().describe('The ID of the scheduled task to document'),
    name: z.string().describe('Slug for the doc filename, e.g. "session-health-monitor"'),
    description: z.string().describe('1-3 sentences explaining what the task does and why it exists'),
    force: z.boolean().optional().describe('Overwrite an existing doc if one already has this name'),
  },
  async (args) => {
    const data = {
      type: 'document_task',
      taskId: args.task_id,
      name: args.name,
      description: args.description,
      force: args.force,
      groupFolder,
      chatJid,
      timestamp: new Date().toISOString(),
    };
    writeIpcFile(TASKS_DIR, data);
    return {
      content: [{ type: 'text' as const, text: `Documenting task ${args.task_id} as ${args.name}.md...` }],
    };
  },
);

server.tool(
  'install_task',
  `Install a task from a doc file under docs/tasks/. The host parses the frontmatter (schedule, context_mode, requires_host_access) and the prompt block, substitutes any {{vars}} from the doc's defaults overlaid with vars_override, and creates a scheduled task.

Main group can install for any registered group via target_group_jid; other groups install only for themselves.

If the doc declares requires_host_access:true, the target group must have hostAccess enabled or the install is refused.`,
  {
    doc_path: z.string().describe('Path to the task doc, e.g. "docs/tasks/session-health-monitor.md" (relative to repo root)'),
    target_group_jid: z.string().optional().describe('(Main only) JID of the group to install the task for. Defaults to the current group.'),
    vars_override: z.record(z.string(), z.string()).optional().describe('Override placeholder values from the doc. Keys must match {{var}} placeholders in the prompt.'),
  },
  async (args) => {
    const data = {
      type: 'install_task',
      docPath: args.doc_path,
      targetGroupJid: args.target_group_jid,
      varsOverride: args.vars_override,
      groupFolder,
      chatJid,
      isMain,
      timestamp: new Date().toISOString(),
    };
    writeIpcFile(TASKS_DIR, data);
    return {
      content: [{ type: 'text' as const, text: `Installing task from ${args.doc_path}...` }],
    };
  },
);

server.tool(
  'send_file',
  'Send a file as a Telegram attachment to the user or group. IMPORTANT: The file must be under /workspace/group/ or /workspace/extra/ — files in /tmp/ or other container-local paths cannot be sent. Copy to /workspace/group/ first if needed.',
  {
    file_path: z.string().describe('Absolute path under /workspace/group/ or /workspace/extra/ (e.g. /workspace/group/report.md). Files in /tmp/ are NOT accessible to the host.'),
    caption: z.string().optional().describe('Optional caption to include with the file'),
  },
  async (args) => {
    // Validate the path is resolvable before sending to host
    if (!args.file_path.startsWith('/workspace/group/') && !args.file_path.startsWith('/workspace/extra/')) {
      return {
        content: [{ type: 'text' as const, text: `Error: file_path must start with /workspace/group/ or /workspace/extra/. Got "${args.file_path}". Copy the file to /workspace/group/ first, then retry.` }],
        isError: true,
      };
    }

    if (!fs.existsSync(args.file_path)) {
      return {
        content: [{ type: 'text' as const, text: `Error: file not found at "${args.file_path}".` }],
        isError: true,
      };
    }

    const data = {
      type: 'send_file',
      filePath: args.file_path,
      caption: args.caption,
      chatJid,
      groupFolder,
      timestamp: new Date().toISOString(),
    };

    writeIpcFile(TASKS_DIR, data);

    return {
      content: [{ type: 'text' as const, text: `Sending file: ${args.file_path}` }],
    };
  },
);

server.tool(
  'register_group',
  `Register a new chat/group so the agent can respond to messages there. Main group only.

Use available_groups.json to find the JID for a group. The folder name must be channel-prefixed: "{channel}_{group-name}" (e.g., "whatsapp_family-chat", "telegram_dev-team", "discord_general"). Use lowercase with hyphens for the group name part.`,
  {
    jid: z.string().describe('The chat JID (e.g., "120363336345536173@g.us", "tg:-1001234567890", "dc:1234567890123456")'),
    name: z.string().describe('Display name for the group'),
    folder: z.string().describe('Channel-prefixed folder name (e.g., "whatsapp_family-chat", "telegram_dev-team")'),
    trigger: z.string().describe('Trigger word (e.g., "@Andy")'),
  },
  async (args) => {
    if (!isMain) {
      return {
        content: [{ type: 'text' as const, text: 'Only the main group can register new groups.' }],
        isError: true,
      };
    }

    const data = {
      type: 'register_group',
      jid: args.jid,
      name: args.name,
      folder: args.folder,
      trigger: args.trigger,
      timestamp: new Date().toISOString(),
    };

    writeIpcFile(TASKS_DIR, data);

    return {
      content: [{ type: 'text' as const, text: `Group "${args.name}" registered. It will start receiving messages immediately.` }],
    };
  },
);


server.tool(
  'check_kindle_library',
  'Check if a book has been sent to Kindle. Returns delivery history for a title, or the last 10 sends if query is empty or \*\.',
  {
    query: z.string().describe('Book title to search for. Pass empty string or \*\ to list the last 10 sends.'),
  },
  async (args) => {
    const requestId = Date.now() + '-' + Math.random().toString(36).slice(2, 8);
    const responsesDir = path.join(IPC_DIR, 'responses');
    fs.mkdirSync(responsesDir, { recursive: true });
    const responseFile = path.join(responsesDir, requestId + '.json');

    const data = {
      type: 'check_kindle_library',
      requestId,
      query: args.query,
      chatJid,
      groupFolder,
      timestamp: new Date().toISOString(),
    };

    writeIpcFile(TASKS_DIR, data);

    const timeout = 15000;
    const interval = 500;
    const deadline = Date.now() + timeout;

    while (Date.now() < deadline) {
      await new Promise(r => setTimeout(r, interval));
      if (fs.existsSync(responseFile)) {
        try {
          const result = JSON.parse(fs.readFileSync(responseFile, 'utf-8'));
          fs.unlinkSync(responseFile);
          if (result.error) {
            return { content: [{ type: 'text' as const, text: 'Error: ' + result.error }], isError: true };
          }
          return { content: [{ type: 'text' as const, text: result.output }] };
        } catch {
          fs.unlinkSync(responseFile);
          return { content: [{ type: 'text' as const, text: 'Failed to parse response' }], isError: true };
        }
      }
    }

    return { content: [{ type: 'text' as const, text: 'check_kindle_library timed out' }], isError: true };
  },
);

// Start the stdio transport
const transport = new StdioServerTransport();
await server.connect(transport);

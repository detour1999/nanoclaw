import fs from 'fs';
import path from 'path';

import { CronExpressionParser } from 'cron-parser';

import {
  DATA_DIR,
  DOCS_TASKS_DIR,
  GROUPS_DIR,
  IPC_POLL_INTERVAL,
  REPO_ROOT,
  TIMEZONE,
} from './config.js';
import { executeSSHLocalhost } from './ssh-helper.js';
import { AvailableGroup } from './container-runner.js';
import { createTask, deleteTask, getTaskById, updateTask } from './db.js';
import { isValidGroupFolder, resolveGroupIpcPath } from './group-folder.js';
import { logger } from './logger.js';
import {
  parseTaskDoc,
  renderTaskDoc,
  substituteVars,
  TaskDocFrontmatter,
} from './task-doc.js';
import { RegisteredGroup } from './types.js';

export interface IpcDeps {
  sendMessage: (jid: string, text: string) => Promise<void>;
  sendDocument: (
    jid: string,
    filePath: string,
    caption?: string,
  ) => Promise<void>;
  registeredGroups: () => Record<string, RegisteredGroup>;
  registerGroup: (jid: string, group: RegisteredGroup) => void;
  syncGroups: (force: boolean) => Promise<void>;
  getAvailableGroups: () => AvailableGroup[];
  writeGroupsSnapshot: (
    groupFolder: string,
    isMain: boolean,
    availableGroups: AvailableGroup[],
    registeredJids: Set<string>,
  ) => void;
}

let ipcWatcherRunning = false;

export function startIpcWatcher(deps: IpcDeps): void {
  if (ipcWatcherRunning) {
    logger.debug('IPC watcher already running, skipping duplicate start');
    return;
  }
  ipcWatcherRunning = true;

  const ipcBaseDir = path.join(DATA_DIR, 'ipc');
  fs.mkdirSync(ipcBaseDir, { recursive: true });

  const processIpcFiles = async () => {
    // Scan all group IPC directories (identity determined by directory)
    let groupFolders: string[];
    try {
      groupFolders = fs.readdirSync(ipcBaseDir).filter((f) => {
        const stat = fs.statSync(path.join(ipcBaseDir, f));
        return stat.isDirectory() && f !== 'errors';
      });
    } catch (err) {
      logger.error({ err }, 'Error reading IPC base directory');
      setTimeout(processIpcFiles, IPC_POLL_INTERVAL);
      return;
    }

    const registeredGroups = deps.registeredGroups();

    // Build folder→privilege lookups from registered groups
    const folderIsMain = new Map<string, boolean>();
    const folderHasHostAccess = new Map<string, boolean>();
    for (const group of Object.values(registeredGroups)) {
      if (group.isMain) folderIsMain.set(group.folder, true);
      if (group.isMain || group.containerConfig?.hostAccess) {
        folderHasHostAccess.set(group.folder, true);
      }
    }

    for (const sourceGroup of groupFolders) {
      const isMain = folderIsMain.get(sourceGroup) === true;
      const hasHostAccess = folderHasHostAccess.get(sourceGroup) === true;
      const messagesDir = path.join(ipcBaseDir, sourceGroup, 'messages');
      const tasksDir = path.join(ipcBaseDir, sourceGroup, 'tasks');

      // Process messages from this group's IPC directory
      try {
        if (fs.existsSync(messagesDir)) {
          const messageFiles = fs
            .readdirSync(messagesDir)
            .filter((f) => f.endsWith('.json'));
          for (const file of messageFiles) {
            const filePath = path.join(messagesDir, file);
            try {
              const data = JSON.parse(fs.readFileSync(filePath, 'utf-8'));
              if (data.type === 'message' && data.chatJid && data.text) {
                // Authorization: verify this group can send to this chatJid
                const targetGroup = registeredGroups[data.chatJid];
                if (
                  isMain ||
                  (targetGroup && targetGroup.folder === sourceGroup)
                ) {
                  await deps.sendMessage(data.chatJid, data.text);
                  logger.info(
                    { chatJid: data.chatJid, sourceGroup },
                    'IPC message sent',
                  );
                } else {
                  logger.warn(
                    { chatJid: data.chatJid, sourceGroup },
                    'Unauthorized IPC message attempt blocked',
                  );
                }
              }
              fs.unlinkSync(filePath);
            } catch (err) {
              logger.error(
                { file, sourceGroup, err },
                'Error processing IPC message',
              );
              const errorDir = path.join(ipcBaseDir, 'errors');
              fs.mkdirSync(errorDir, { recursive: true });
              fs.renameSync(
                filePath,
                path.join(errorDir, `${sourceGroup}-${file}`),
              );
            }
          }
        }
      } catch (err) {
        logger.error(
          { err, sourceGroup },
          'Error reading IPC messages directory',
        );
      }

      // Process tasks from this group's IPC directory
      try {
        if (fs.existsSync(tasksDir)) {
          const taskFiles = fs
            .readdirSync(tasksDir)
            .filter((f) => f.endsWith('.json'));
          for (const file of taskFiles) {
            const filePath = path.join(tasksDir, file);
            try {
              const data = JSON.parse(fs.readFileSync(filePath, 'utf-8'));
              // Delete before processing to prevent restart loops: if a task
              // kills the process (e.g. ssh_localhost running launchctl),
              // the file must already be gone so it isn't re-executed on boot.
              fs.unlinkSync(filePath);
              // Pass source group identity to processTaskIpc for authorization
              await processTaskIpc(
                data,
                sourceGroup,
                isMain,
                hasHostAccess,
                deps,
              );
            } catch (err) {
              logger.error(
                { file, sourceGroup, err },
                'Error processing IPC task',
              );
              // Only move to errors if the file still exists (wasn't already deleted)
              if (fs.existsSync(filePath)) {
                const errorDir = path.join(ipcBaseDir, 'errors');
                fs.mkdirSync(errorDir, { recursive: true });
                fs.renameSync(
                  filePath,
                  path.join(errorDir, `${sourceGroup}-${file}`),
                );
              }
            }
          }
        }
      } catch (err) {
        logger.error({ err, sourceGroup }, 'Error reading IPC tasks directory');
      }
    }

    setTimeout(processIpcFiles, IPC_POLL_INTERVAL);
  };

  processIpcFiles();
  logger.info('IPC watcher started (per-group namespaces)');
}

/** Translate a container path back to a host path. */
function resolveContainerPath(
  containerPath: string,
  groupFolder: string,
  group: RegisteredGroup | undefined,
): string | null {
  // /workspace/group/... → GROUPS_DIR/{folder}/...
  if (containerPath.startsWith('/workspace/group/')) {
    const rel = containerPath.slice('/workspace/group/'.length);
    return path.join(GROUPS_DIR, groupFolder, rel);
  }
  // /workspace/extra/... → look up in additionalMounts
  if (
    containerPath.startsWith('/workspace/extra/') &&
    group?.containerConfig?.additionalMounts
  ) {
    const rel = containerPath.slice('/workspace/extra/'.length);
    const firstSegment = rel.split('/')[0];
    const mount = group.containerConfig.additionalMounts.find(
      (m) => m.containerPath === firstSegment,
    );
    if (mount) {
      const restOfPath = rel.slice(firstSegment.length + 1);
      return restOfPath
        ? path.join(mount.hostPath, restOfPath)
        : mount.hostPath;
    }
  }
  return null;
}

export async function processTaskIpc(
  data: {
    type: string;
    taskId?: string;
    prompt?: string;
    schedule_type?: string;
    schedule_value?: string;
    context_mode?: string;
    groupFolder?: string;
    chatJid?: string;
    targetJid?: string;
    // For ssh_localhost
    command?: string;
    requestId?: string;
    // For send_file
    filePath?: string;
    caption?: string;
    // For register_group
    jid?: string;
    name?: string;
    folder?: string;
    trigger?: string;
    requiresTrigger?: boolean;
    containerConfig?: RegisteredGroup['containerConfig'];
    // For document_task
    description?: string;
    force?: boolean;
    // For install_task
    docPath?: string;
    targetGroupJid?: string;
    varsOverride?: Record<string, string>;
  },
  sourceGroup: string, // Verified identity from IPC directory
  isMain: boolean, // Verified from directory path
  hasHostAccess: boolean, // isMain or containerConfig.hostAccess
  deps: IpcDeps,
): Promise<void> {
  const registeredGroups = deps.registeredGroups();

  switch (data.type) {
    case 'schedule_task':
      if (
        data.prompt &&
        data.schedule_type &&
        data.schedule_value &&
        data.targetJid
      ) {
        // Resolve the target group from JID
        const targetJid = data.targetJid as string;
        const targetGroupEntry = registeredGroups[targetJid];

        if (!targetGroupEntry) {
          logger.warn(
            { targetJid },
            'Cannot schedule task: target group not registered',
          );
          break;
        }

        const targetFolder = targetGroupEntry.folder;

        // Authorization: non-main groups can only schedule for themselves
        if (!isMain && targetFolder !== sourceGroup) {
          logger.warn(
            { sourceGroup, targetFolder },
            'Unauthorized schedule_task attempt blocked',
          );
          break;
        }

        const scheduleType = data.schedule_type as 'cron' | 'interval' | 'once';

        let nextRun: string | null = null;
        if (scheduleType === 'cron') {
          try {
            const interval = CronExpressionParser.parse(data.schedule_value, {
              tz: TIMEZONE,
            });
            nextRun = interval.next().toISOString();
          } catch {
            logger.warn(
              { scheduleValue: data.schedule_value },
              'Invalid cron expression',
            );
            break;
          }
        } else if (scheduleType === 'interval') {
          const ms = parseInt(data.schedule_value, 10);
          if (isNaN(ms) || ms <= 0) {
            logger.warn(
              { scheduleValue: data.schedule_value },
              'Invalid interval',
            );
            break;
          }
          nextRun = new Date(Date.now() + ms).toISOString();
        } else if (scheduleType === 'once') {
          const date = new Date(data.schedule_value);
          if (isNaN(date.getTime())) {
            logger.warn(
              { scheduleValue: data.schedule_value },
              'Invalid timestamp',
            );
            break;
          }
          nextRun = date.toISOString();
        }

        const taskId =
          data.taskId ||
          `task-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
        const contextMode =
          data.context_mode === 'group' || data.context_mode === 'isolated'
            ? data.context_mode
            : 'isolated';
        createTask({
          id: taskId,
          group_folder: targetFolder,
          chat_jid: targetJid,
          prompt: data.prompt,
          schedule_type: scheduleType,
          schedule_value: data.schedule_value,
          context_mode: contextMode,
          next_run: nextRun,
          status: 'active',
          created_at: new Date().toISOString(),
        });
        logger.info(
          { taskId, sourceGroup, targetFolder, contextMode },
          'Task created via IPC',
        );
      }
      break;

    case 'pause_task':
      if (data.taskId) {
        const task = getTaskById(data.taskId);
        if (task && (isMain || task.group_folder === sourceGroup)) {
          updateTask(data.taskId, { status: 'paused' });
          logger.info(
            { taskId: data.taskId, sourceGroup },
            'Task paused via IPC',
          );
        } else {
          logger.warn(
            { taskId: data.taskId, sourceGroup },
            'Unauthorized task pause attempt',
          );
        }
      }
      break;

    case 'resume_task':
      if (data.taskId) {
        const task = getTaskById(data.taskId);
        if (task && (isMain || task.group_folder === sourceGroup)) {
          updateTask(data.taskId, { status: 'active' });
          logger.info(
            { taskId: data.taskId, sourceGroup },
            'Task resumed via IPC',
          );
        } else {
          logger.warn(
            { taskId: data.taskId, sourceGroup },
            'Unauthorized task resume attempt',
          );
        }
      }
      break;

    case 'cancel_task':
      if (data.taskId) {
        const task = getTaskById(data.taskId);
        if (task && (isMain || task.group_folder === sourceGroup)) {
          deleteTask(data.taskId);
          logger.info(
            { taskId: data.taskId, sourceGroup },
            'Task cancelled via IPC',
          );
        } else {
          logger.warn(
            { taskId: data.taskId, sourceGroup },
            'Unauthorized task cancel attempt',
          );
        }
      }
      break;

    case 'update_task':
      if (data.taskId) {
        const task = getTaskById(data.taskId);
        if (!task) {
          logger.warn(
            { taskId: data.taskId, sourceGroup },
            'Task not found for update',
          );
          break;
        }
        if (!isMain && task.group_folder !== sourceGroup) {
          logger.warn(
            { taskId: data.taskId, sourceGroup },
            'Unauthorized task update attempt',
          );
          break;
        }

        const updates: Parameters<typeof updateTask>[1] = {};
        if (data.prompt !== undefined) updates.prompt = data.prompt;
        if (data.schedule_type !== undefined)
          updates.schedule_type = data.schedule_type as
            | 'cron'
            | 'interval'
            | 'once';
        if (data.schedule_value !== undefined)
          updates.schedule_value = data.schedule_value;

        // Recompute next_run if schedule changed
        if (data.schedule_type || data.schedule_value) {
          const updatedTask = {
            ...task,
            ...updates,
          };
          if (updatedTask.schedule_type === 'cron') {
            try {
              const interval = CronExpressionParser.parse(
                updatedTask.schedule_value,
                { tz: TIMEZONE },
              );
              updates.next_run = interval.next().toISOString();
            } catch {
              logger.warn(
                { taskId: data.taskId, value: updatedTask.schedule_value },
                'Invalid cron in task update',
              );
              break;
            }
          } else if (updatedTask.schedule_type === 'interval') {
            const ms = parseInt(updatedTask.schedule_value, 10);
            if (!isNaN(ms) && ms > 0) {
              updates.next_run = new Date(Date.now() + ms).toISOString();
            }
          }
        }

        updateTask(data.taskId, updates);
        logger.info(
          { taskId: data.taskId, sourceGroup, updates },
          'Task updated via IPC',
        );
      }
      break;

    case 'refresh_groups':
      // Only main group can request a refresh
      if (isMain) {
        logger.info(
          { sourceGroup },
          'Group metadata refresh requested via IPC',
        );
        await deps.syncGroups(true);
        // Write updated snapshot immediately
        const availableGroups = deps.getAvailableGroups();
        deps.writeGroupsSnapshot(
          sourceGroup,
          true,
          availableGroups,
          new Set(Object.keys(registeredGroups)),
        );
      } else {
        logger.warn(
          { sourceGroup },
          'Unauthorized refresh_groups attempt blocked',
        );
      }
      break;

    case 'register_group':
      // Only main group can register new groups
      if (!isMain) {
        logger.warn(
          { sourceGroup },
          'Unauthorized register_group attempt blocked',
        );
        break;
      }
      if (data.jid && data.name && data.folder && data.trigger) {
        if (!isValidGroupFolder(data.folder)) {
          logger.warn(
            { sourceGroup, folder: data.folder },
            'Invalid register_group request - unsafe folder name',
          );
          break;
        }
        // Defense in depth: agent cannot set isMain via IPC
        deps.registerGroup(data.jid, {
          name: data.name,
          folder: data.folder,
          trigger: data.trigger,
          added_at: new Date().toISOString(),
          containerConfig: data.containerConfig,
          requiresTrigger: data.requiresTrigger,
        });
      } else {
        logger.warn(
          { data },
          'Invalid register_group request - missing required fields',
        );
      }
      break;

    case 'ssh_localhost':
      if (!hasHostAccess) {
        logger.warn(
          { sourceGroup },
          'Unauthorized ssh_localhost attempt blocked',
        );
        break;
      }
      if (data.command && data.requestId) {
        // Write response file so the container can poll for it synchronously
        const responseDir = path.join(
          resolveGroupIpcPath(sourceGroup),
          'responses',
        );
        fs.mkdirSync(responseDir, { recursive: true });
        const responseFile = path.join(responseDir, `${data.requestId}.json`);

        try {
          logger.info(
            { command: data.command, requestId: data.requestId, sourceGroup },
            'Executing SSH command on localhost',
          );
          const sshResult = await executeSSHLocalhost(data.command);
          fs.writeFileSync(responseFile, JSON.stringify({ output: sshResult }));
        } catch (error: unknown) {
          const errMsg = error instanceof Error ? error.message : String(error);
          logger.error(
            { command: data.command, error: errMsg },
            'SSH command failed',
          );
          fs.writeFileSync(responseFile, JSON.stringify({ error: errMsg }));
        }
      } else {
        logger.warn({ data }, 'Invalid ssh_localhost request - missing fields');
      }
      break;

    case 'restart_nanoclaw':
      // Safe restart: uses process.exit so launchd restarts us cleanly.
      // No SSH, no SIGTERM race conditions.
      if (!hasHostAccess) {
        logger.warn(
          { sourceGroup },
          'Unauthorized restart_nanoclaw attempt blocked',
        );
        break;
      }
      logger.info({ sourceGroup }, 'Restart requested via IPC, exiting in 2s');
      if (data.chatJid) {
        try {
          await deps.sendMessage(data.chatJid, 'Restarting NanoClaw...');
        } catch {
          // Best effort notification
        }
      }
      setTimeout(() => process.exit(0), 2000);
      break;

    case 'document_task': {
      // Render an existing scheduled task to docs/tasks/<slug>.md
      if (!data.taskId) {
        logger.warn({ data }, 'document_task: missing taskId');
        break;
      }
      const task = getTaskById(data.taskId as string);
      if (!task) {
        logger.warn({ taskId: data.taskId }, 'document_task: task not found');
        if (data.chatJid) {
          await deps.sendMessage(
            data.chatJid as string,
            `document_task: task ${data.taskId} not found`,
          );
        }
        break;
      }
      // Authorization: non-main groups can only document their own tasks
      if (!isMain && task.group_folder !== sourceGroup) {
        logger.warn(
          { sourceGroup, taskGroup: task.group_folder },
          'Unauthorized document_task attempt blocked',
        );
        break;
      }
      const rawSlug =
        (data.name as string | undefined) || `task-${task.id.slice(0, 12)}`;
      const slug = rawSlug
        .toLowerCase()
        .replace(/[^a-z0-9-]+/g, '-')
        .replace(/^-+|-+$/g, '')
        .slice(0, 80);
      if (!slug) {
        logger.warn({ rawSlug }, 'document_task: invalid slug');
        break;
      }
      const targetPath = path.join(DOCS_TASKS_DIR, `${slug}.md`);
      const force = data.force === true;
      if (fs.existsSync(targetPath) && !force) {
        const msg = `document_task: ${path.relative(REPO_ROOT, targetPath)} already exists. Pass force:true to overwrite.`;
        logger.warn({ targetPath }, msg);
        if (data.chatJid) {
          await deps.sendMessage(data.chatJid as string, msg);
        }
        break;
      }
      const fm: TaskDocFrontmatter = {
        name: slug,
        schedule_type: task.schedule_type,
        schedule_value: task.schedule_value,
        context_mode: task.context_mode,
      };
      const description =
        (data.description as string | undefined) ||
        `Documented from task ${task.id}.`;
      const body = `# ${slug}\n\n${description}`;
      const rendered = renderTaskDoc(fm, body, task.prompt);
      try {
        fs.mkdirSync(DOCS_TASKS_DIR, { recursive: true });
        fs.writeFileSync(targetPath, rendered);
        const rel = path.relative(REPO_ROOT, targetPath);
        logger.info({ taskId: task.id, targetPath }, 'Task documented');
        if (data.chatJid) {
          await deps.sendMessage(
            data.chatJid as string,
            `Task documented to \`${rel}\``,
          );
        }
      } catch (err) {
        logger.error({ err, targetPath }, 'document_task: write failed');
        if (data.chatJid) {
          await deps.sendMessage(
            data.chatJid as string,
            `document_task: failed to write file — ${err instanceof Error ? err.message : String(err)}`,
          );
        }
      }
      break;
    }

    case 'install_task': {
      if (!data.docPath) {
        logger.warn({ data }, 'install_task: missing docPath');
        break;
      }
      const docPath = path.isAbsolute(data.docPath as string)
        ? (data.docPath as string)
        : path.resolve(REPO_ROOT, data.docPath as string);
      // Confine reads to docs/tasks/ to prevent arbitrary file reads
      const relToDocs = path.relative(DOCS_TASKS_DIR, docPath);
      if (relToDocs.startsWith('..') || path.isAbsolute(relToDocs)) {
        logger.warn(
          { docPath, sourceGroup },
          'install_task: path outside docs/tasks/',
        );
        if (data.chatJid) {
          await deps.sendMessage(
            data.chatJid as string,
            `install_task: path must be inside docs/tasks/`,
          );
        }
        break;
      }
      let parsed;
      try {
        const content = fs.readFileSync(docPath, 'utf-8');
        parsed = parseTaskDoc(content);
      } catch (err) {
        const msg = `install_task: parse error — ${err instanceof Error ? err.message : String(err)}`;
        logger.warn({ docPath, err }, msg);
        if (data.chatJid) {
          await deps.sendMessage(data.chatJid as string, msg);
        }
        break;
      }

      // Determine target group: main may target any group, others self only
      const targetJid =
        isMain && data.targetGroupJid
          ? (data.targetGroupJid as string)
          : data.chatJid
            ? (data.chatJid as string)
            : null;
      if (!targetJid) {
        logger.warn({ sourceGroup }, 'install_task: no target JID resolvable');
        break;
      }
      const targetGroupEntry = registeredGroups[targetJid];
      if (!targetGroupEntry) {
        logger.warn({ targetJid }, 'install_task: target group not registered');
        break;
      }
      const targetFolder = targetGroupEntry.folder;
      if (!isMain && targetFolder !== sourceGroup) {
        logger.warn(
          { sourceGroup, targetFolder },
          'Unauthorized install_task attempt blocked',
        );
        break;
      }
      // Enforce requires_host_access against the target group
      if (parsed.frontmatter.requires_host_access) {
        const targetHostAccess =
          targetGroupEntry.isMain === true ||
          targetGroupEntry.containerConfig?.hostAccess === true;
        if (!targetHostAccess) {
          const msg = `install_task: doc requires host access but target group "${targetFolder}" does not have hostAccess`;
          logger.warn({ targetFolder }, msg);
          if (data.chatJid) {
            await deps.sendMessage(data.chatJid as string, msg);
          }
          break;
        }
      }

      // Resolve vars: defaults from frontmatter overlaid with caller overrides
      const vars: Record<string, string> = {
        ...(parsed.frontmatter.vars || {}),
        ...((data.varsOverride as Record<string, string> | undefined) || {}),
      };
      const resolvedPrompt = substituteVars(parsed.prompt, vars);

      // Validate schedule_value
      let nextRun: string | null = null;
      const scheduleType = parsed.frontmatter.schedule_type;
      const scheduleValue = parsed.frontmatter.schedule_value;
      if (scheduleType === 'cron') {
        try {
          const interval = CronExpressionParser.parse(scheduleValue, {
            tz: TIMEZONE,
          });
          nextRun = interval.next().toISOString();
        } catch {
          const msg = `install_task: invalid cron "${scheduleValue}"`;
          logger.warn({ scheduleValue }, msg);
          if (data.chatJid) await deps.sendMessage(data.chatJid as string, msg);
          break;
        }
      } else if (scheduleType === 'interval') {
        const ms = parseInt(scheduleValue, 10);
        if (isNaN(ms) || ms <= 0) {
          const msg = `install_task: invalid interval "${scheduleValue}"`;
          logger.warn({ scheduleValue }, msg);
          if (data.chatJid) await deps.sendMessage(data.chatJid as string, msg);
          break;
        }
        nextRun = new Date(Date.now() + ms).toISOString();
      } else if (scheduleType === 'once') {
        const date = new Date(scheduleValue);
        if (isNaN(date.getTime())) {
          const msg = `install_task: invalid timestamp "${scheduleValue}"`;
          logger.warn({ scheduleValue }, msg);
          if (data.chatJid) await deps.sendMessage(data.chatJid as string, msg);
          break;
        }
        nextRun = date.toISOString();
      }

      const taskId = `task-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
      createTask({
        id: taskId,
        group_folder: targetFolder,
        chat_jid: targetJid,
        prompt: resolvedPrompt,
        schedule_type: scheduleType,
        schedule_value: scheduleValue,
        context_mode: parsed.frontmatter.context_mode || 'isolated',
        next_run: nextRun,
        status: 'active',
        created_at: new Date().toISOString(),
      });
      logger.info(
        { taskId, sourceGroup, targetFolder, docPath },
        'Task installed from doc',
      );
      if (data.chatJid) {
        await deps.sendMessage(
          data.chatJid as string,
          `Installed task ${taskId} from \`${path.relative(REPO_ROOT, docPath)}\` (next run: ${nextRun || 'N/A'})`,
        );
      }
      break;
    }

    case 'send_file': {
      if (!data.filePath || !data.chatJid) {
        logger.warn({ data }, 'Invalid send_file request - missing fields');
        break;
      }
      const targetGroup = registeredGroups[data.chatJid];
      const hostPath = resolveContainerPath(
        data.filePath,
        sourceGroup,
        targetGroup,
      );
      if (!hostPath) {
        logger.warn(
          { filePath: data.filePath, sourceGroup },
          'Could not resolve host path for send_file',
        );
        break;
      }
      if (!fs.existsSync(hostPath)) {
        logger.warn(
          { hostPath, filePath: data.filePath },
          'send_file: resolved host path does not exist',
        );
        break;
      }
      try {
        logger.info(
          { filePath: hostPath, chatJid: data.chatJid, sourceGroup },
          'Sending file via channel',
        );
        await deps.sendDocument(data.chatJid, hostPath, data.caption);
      } catch (err) {
        logger.error({ err, filePath: hostPath }, 'send_file failed');
      }
      break;
    }

    default:
      logger.warn({ type: data.type }, 'Unknown IPC task type');
  }
}

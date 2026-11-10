import { Channel, NewMessage } from './types.js';
import { formatLocalTime } from './timezone.js';

export function escapeXml(s: string): string {
  if (!s) return '';
  // toWellFormed() replaces lone Unicode surrogates (e.g. malformed emoji from
  // WhatsApp) with U+FFFD before serializing to JSON, preventing the
  // API error: "no low surrogate in string".
  return s
    .toWellFormed()
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

export function formatMessages(
  messages: NewMessage[],
  timezone: string,
): string {
  const lines = messages.map((m) => {
    const displayTime = formatLocalTime(m.timestamp, timezone);
    return `<message sender="${escapeXml(m.sender_name)}" time="${escapeXml(displayTime)}">${escapeXml(m.content)}</message>`;
  });

  const header = `<context timezone="${escapeXml(timezone)}" />\n`;

  return `${header}<messages>\n${lines.join('\n')}\n</messages>`;
}

export function stripInternalTags(text: string): string {
  return text
    .replace(/<internal>[\s\S]*?<\/internal>/g, '')
    .replace(/<\/?internal>/g, '')
    .trim();
}

export function formatOutbound(rawText: string): string {
  const text = stripInternalTags(rawText);
  if (!text) return '';
  return text;
}

const NOISE_PATTERNS = [
  'nothing to report',
  'nothing qualifies',
  'empty collector output',
  'no active panes',
  'collector returned empty',
  'no changed panes',
  'nothing new',
  'already synced',
  'no changes detected',
];

/**
 * Returns true if a bot/scheduled-task message is purely a "nothing to report"
 * confirmation and should be dropped before delivery. Only matches short
 * messages (< 200 chars) to avoid suppressing real alerts that happen to
 * contain these phrases as part of a longer message.
 */
export function isNoisyMessage(text: string): boolean {
  if (text.length >= 200) return false;
  const lower = text.toLowerCase();
  return NOISE_PATTERNS.some((p) => lower.includes(p));
}

export function routeOutbound(
  channels: Channel[],
  jid: string,
  text: string,
): Promise<void> {
  const channel = channels.find((c) => c.ownsJid(jid) && c.isConnected());
  if (!channel) throw new Error(`No channel for JID: ${jid}`);
  return channel.sendMessage(jid, text);
}

export function findChannel(
  channels: Channel[],
  jid: string,
): Channel | undefined {
  return channels.find((c) => c.ownsJid(jid));
}

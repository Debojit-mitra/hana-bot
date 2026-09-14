import { jidNormalizedUser, type WASocket, type WAMessage, proto } from '@whiskeysockets/baileys';
import { getConfig } from '../config/config.js';
import { getEnvConfig } from '../config/env.js';
import { isAuthorized, isAdmin, normalizeJid } from './auth.js';
import { sendPresenceUpdate } from './socket.js';
import type { CommandContext, CommandHandler, ModuleRegistration } from '../types/index.js';
import logger from '../utils/logger.js';
import { TaskQueue } from './queue.js';

const modules: ModuleRegistration[] = [];
const chatQueues = new Map<string, TaskQueue>();

function getChatQueue(jid: string): TaskQueue {
    if (!chatQueues.has(jid)) {
        chatQueues.set(jid, new TaskQueue(1));
    }
    return chatQueues.get(jid)!;
}

/**
 * Register a module's commands with the router.
 */
export function registerModule(module: ModuleRegistration): void {
    modules.push(module);
    logger.info({ module: module.name, commands: [...module.commands.keys()] }, 'Registered module');
}

/**
 * Get all registered modules (for help text, etc).
 */
export function getRegisteredModules(): ModuleRegistration[] {
    return modules;
}

/**
 * Handle incoming messages — parse commands and dispatch to handlers.
 */
export async function handleIncomingMessages(sock: WASocket, upsert: any): Promise<void> {
    const messages: WAMessage[] = upsert.messages || [];

    for (const msg of messages) {
        const jid = msg.key.remoteJid || 'unknown';
        getChatQueue(jid).enqueue(async () => {
            try {
                await processMessage(sock, msg);
            } catch (err) {
                logger.error({ err, messageId: msg.key.id }, 'Error processing message');
            }
        });
    }
}

/**
 * Resolves the true sender JID from a message.
 * Normalizes phone number JIDs, strips device suffixes (e.g. :8),
 * and resolves group LID (Linked Identity) JIDs back to phone numbers.
 */
export async function resolveSenderJid(sock: WASocket, msg: WAMessage): Promise<string> {
    const config = getConfig();
    if (msg.key.fromMe) {
        return normalizeJid(config.ownerJid);
    }

    const key = msg.key;
    const remoteJid = key.remoteJid || '';
    const participant = key.participant;
    const participantAlt = (key as any).participantAlt;
    const remoteJidAlt = (key as any).remoteJidAlt;

    const candidates = [participantAlt, participant, remoteJidAlt, remoteJid].filter(Boolean) as string[];

    // Priority 1: Check if any candidate is a standard phone number JID (@s.whatsapp.net or @c.us)
    for (const c of candidates) {
        const norm = normalizeJid(c);
        if (norm && (norm.endsWith('@s.whatsapp.net') || norm.endsWith('@c.us'))) {
            return norm;
        }
    }

    // Priority 2: If candidate is a LID (@lid), attempt to resolve to phone number
    for (const c of candidates) {
        const norm = normalizeJid(c);
        if (norm && norm.endsWith('@lid')) {
            // Try Baileys LID mapping store
            try {
                const pn = await (sock as any).signalRepository?.lidMapping?.getPNForLID(norm);
                if (pn) {
                    return normalizeJid(pn);
                }
            } catch {
                // ignore
            }

            // Try group metadata if in a group
            if (remoteJid.endsWith('@g.us')) {
                try {
                    let groupMeta = (sock as any).cachedGroupMetadata
                        ? await (sock as any).cachedGroupMetadata(remoteJid)
                        : undefined;
                    if (!groupMeta && sock.groupMetadata) {
                        groupMeta = await sock.groupMetadata(remoteJid);
                    }
                    if (groupMeta?.participants) {
                        const found = groupMeta.participants.find((p: any) =>
                            p.lid === norm || p.id === norm || normalizeJid(p.lid || '') === norm
                        );
                        if (found?.id && !found.id.endsWith('@lid')) {
                            return normalizeJid(found.id);
                        }
                    }
                } catch {
                    // ignore
                }
            }

            return norm;
        }
    }

    // Fallback
    const raw = participant || remoteJid;
    return normalizeJid(raw);
}

async function processMessage(sock: WASocket, msg: WAMessage): Promise<void> {
    // Skip if no message content
    if (!msg.message) return;

    // Ignore status updates
    if (msg.key.remoteJid === 'status@broadcast') return;

    // Extract text content from various message types
    const text = extractTextContent(msg.message);
    if (!text) return;

    const config = getConfig();
    const prefix = config.commandPrefix;
    const isCommand = text.startsWith(prefix);

    // Ignore messages sent by the bot itself, UNLESS it's a command in the "self chat"
    if (msg.key.fromMe && !isCommand) return;

    // Extract JID (chat)
    const jid = msg.key.remoteJid;
    if (!jid) return;

    // Resolve true sender JID (handles groups, devices, LIDs)
    const senderJid = await resolveSenderJid(sock, msg);

    // Authorization check: allow if whitelisted OR if it's a self-chat command
    if (!msg.key.fromMe && !isAuthorized(senderJid)) {
        logger.warn(
            { senderJid, chat: jid, participant: msg.key.participant, participantAlt: (msg.key as any).participantAlt },
            'Unauthorized message, ignoring'
        );
        return;
    }

    // Check if this is a command
    if (!isCommand) {
        // If AI is enabled and not a command, forward to AI handler
        const aiHandler = findHandler('hana');
        const envConfig = getEnvConfig();
        if (aiHandler && envConfig.ai.provider !== 'none') {
            const isGroup = jid.endsWith('@g.us');
            const botPn = normalizeJid(envConfig.phoneNumber + '@s.whatsapp.net');
            const botLid = normalizeJid((sock.user as any)?.lid || '');
            let shouldReply = !isGroup; // Always reply in DMs

            if (isGroup) {
                // Extract contextInfo from whichever message type contains it
                const msgKeys = Object.keys(msg.message || {});
                let contextInfo: any = null;
                for (const key of msgKeys) {
                    if ((msg.message as any)[key]?.contextInfo) {
                        contextInfo = (msg.message as any)[key].contextInfo;
                        break;
                    }
                }

                const mentionedJid = contextInfo?.mentionedJid || [];
                const participant = contextInfo?.participant;

                // Check if the bot was @mentioned, replied to, or addressed by name
                const isBot = (id: string) => {
                    const norm = normalizeJid(id);
                    return norm === botPn || (botLid && norm === botLid);
                };
                const isMentioned = mentionedJid.some((j: string) => isBot(j));
                const isRepliedTo = participant && isBot(participant);
                const mentionsHana = text.toLowerCase().includes('hana');

                if (isMentioned || isRepliedTo || mentionsHana) {
                    shouldReply = true;
                }
            }

            if (shouldReply) {
                const quotedMessage = extractQuotedText(msg.message);
                const pushName = msg.pushName || 'Unknown';
                const ctx = createContext(sock, msg, jid, senderJid, 'hana', [text], pushName, text, quotedMessage);
                sendPresenceUpdate(jid).catch(() => {});
                await aiHandler(ctx);
            }
        }
        return;
    }

    // Parse the command
    const withoutPrefix = text.slice(prefix.length).trim();
    const parts = withoutPrefix.split(/\s+/);
    const commandName = parts[0]?.toLowerCase();
    const args = parts.slice(1);

    if (!commandName) return;

    // Find the handler
    const handler = findHandler(commandName);

    const quotedMessage = extractQuotedText(msg.message);

    if (!handler) {
        // Unknown command
        const pushName = msg.pushName || 'Unknown';
        const ctx = createContext(sock, msg, jid, senderJid, commandName, args, pushName, text, quotedMessage);
        await ctx.reply(`❓ Unknown command: \`${prefix}${commandName}\`\nType \`${prefix}help\` for available commands.`);
        return;
    }

    // Execute the handler
    logger.info({ command: commandName, args, sender: senderJid, chat: jid }, 'Executing command');
    const pushName = msg.pushName || 'Unknown';
    const ctx = createContext(sock, msg, jid, senderJid, commandName, args, pushName, text, quotedMessage);

    // Show typing indicator in background (non-blocking)
    sendPresenceUpdate(jid).catch(() => {});

    await handler(ctx);
}

/**
 * Find a command handler across all registered modules.
 */
function findHandler(command: string): CommandHandler | undefined {
    for (const mod of modules) {
        const handler = mod.commands.get(command);
        if (handler) return handler;
    }
    return undefined;
}

/**
 * Create a CommandContext for the handler.
 */
function createContext(
    sock: WASocket,
    msg: WAMessage,
    jid: string,
    sender: string,
    command: string,
    args: string[],
    pushName: string,
    rawMessage: string,
    quotedMessage?: string
): CommandContext {
    return {
        jid,
        sender,
        command,
        args,
        pushName,
        rawMessage,
        rawMsg: msg,
        quotedMessage,
        messageKey: msg.key,
        sock,

        async reply(text: string) {
            try {
                await sock.sendMessage(jid, { text }, { quoted: msg });
            } catch {
                await sock.sendMessage(jid, { text });
            }
        },

        async replyWithFile(content: Buffer | { url: string }, filename: string, mimetype: string, caption?: string) {
            try {
                await sock.sendMessage(jid, {
                    document: content,
                    mimetype,
                    fileName: filename,
                    caption,
                }, { quoted: msg });
            } catch {
                await sock.sendMessage(jid, {
                    document: content,
                    mimetype,
                    fileName: filename,
                    caption,
                });
            }
        },

        async react(emoji: string) {
            try {
                await sock.sendMessage(jid, {
                    react: {
                        text: emoji,
                        key: msg.key,
                    },
                });
            } catch {
                // Reactions are best-effort
            }
        },
    };
}

/**
 * Extract text content from various WhatsApp message types.
 */
function extractTextContent(message: proto.IMessage): string | null {
    if (message.conversation) {
        return message.conversation;
    }
    if (message.extendedTextMessage?.text) {
        return message.extendedTextMessage.text;
    }
    if (message.imageMessage?.caption) {
        return message.imageMessage.caption;
    }
    if (message.videoMessage?.caption) {
        return message.videoMessage.caption;
    }
    if (message.documentMessage?.caption) {
        return message.documentMessage.caption;
    }
    if (message.documentWithCaptionMessage?.message?.documentMessage?.caption) {
        return message.documentWithCaptionMessage.message.documentMessage.caption;
    }
    return null;
}

/**
 * Extract the text content of the message that is being replied to (quoted).
 */
function extractQuotedText(message: proto.IMessage): string | undefined {
    const quotedMsg = message.extendedTextMessage?.contextInfo?.quotedMessage;
    if (quotedMsg) {
        return extractTextContent(quotedMsg) || undefined;
    }
    return undefined;
}

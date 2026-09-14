import fs from 'fs/promises';
import path from 'path';
import os from 'os';
import { randomUUID } from 'crypto';
import { type WASocket, type WAMessage, downloadMediaMessage } from '@whiskeysockets/baileys';
import logger from '../utils/logger.js';

export interface MediaSessionConfig {
    toolName: string; // Used for logging (e.g., 'pdf', 'rmexif')
    maxFiles: number; // e.g., 30
    allowedMimeTypes?: RegExp; // e.g., /^image\/.*/
    timeoutMs?: number; // Defaults to 10 minutes (600000)
}

interface MediaSession {
    config: MediaSessionConfig;
    tmpDir: string;
    files: string[];
    createdAt: number;
    timeoutId?: NodeJS.Timeout;
}

const sessions = new Map<string, MediaSession>();

/**
 * Check if a user has an active media session.
 */
export function isMediaSessionActive(jid: string): boolean {
    return sessions.has(jid);
}

/**
 * Start a generic media session for a user.
 */
export async function startMediaSession(jid: string, config: MediaSessionConfig): Promise<void> {
    if (sessions.has(jid)) {
        await cancelMediaSession(jid);
    }

    const tmpDir = path.join(os.tmpdir(), `hana_${config.toolName}_session_${randomUUID()}`);
    await fs.mkdir(tmpDir, { recursive: true });

    const timeout = config.timeoutMs || 10 * 60 * 1000;
    const timeoutId = setTimeout(async () => {
        logger.info({ jid, tool: config.toolName }, 'Media session timed out');
        await cancelMediaSession(jid);
    }, timeout);

    sessions.set(jid, {
        config,
        tmpDir,
        files: [],
        createdAt: Date.now(),
        timeoutId
    });
    
    logger.info({ jid, tmpDir, tool: config.toolName }, 'Started new media session');
}

/**
 * Attempt to intercept a message containing media for an active session.
 * Called by the global router. Returns true if intercepted (so the router can swallow it).
 */
export async function interceptMedia(sock: WASocket, msg: WAMessage, senderJid: string, jid: string): Promise<boolean> {
    const session = sessions.get(senderJid);
    if (!session) return false;

    const mediaMessage = msg.message?.imageMessage || 
                         msg.message?.videoMessage || 
                         msg.message?.audioMessage ||
                         msg.message?.documentMessage ||
                         msg.message?.viewOnceMessage?.message?.imageMessage ||
                         msg.message?.viewOnceMessage?.message?.videoMessage ||
                         msg.message?.viewOnceMessageV2?.message?.imageMessage ||
                         msg.message?.viewOnceMessageV2?.message?.videoMessage ||
                         msg.message?.ephemeralMessage?.message?.imageMessage ||
                         msg.message?.ephemeralMessage?.message?.videoMessage ||
                         msg.message?.ephemeralMessage?.message?.documentMessage ||
                         msg.message?.documentWithCaptionMessage?.message?.documentMessage;

    if (!mediaMessage) return false; // Not a media message

    const mime = mediaMessage.mimetype || '';

    // Verify mimetype if a regex was provided
    if (session.config.allowedMimeTypes && !session.config.allowedMimeTypes.test(mime)) {
        // Technically intercepted, but rejected due to wrong type
        await sock.sendMessage(jid, { react: { text: "❌", key: msg.key } });
        await sock.sendMessage(jid, { text: `⚠️ This session only accepts specific file types.` }, { quoted: msg });
        return true;
    }

    if (session.files.length >= session.config.maxFiles) {
        await sock.sendMessage(jid, { react: { text: "❌", key: msg.key } });
        await sock.sendMessage(jid, { text: `⚠️ You've reached the maximum limit of ${session.config.maxFiles} files for this session. Please compile/finish now!` }, { quoted: msg });
        return true;
    }

    try {
        const buffer = await downloadMediaMessage(msg, 'buffer', {}, { 
            logger: logger as any,
            reuploadRequest: (m) => new Promise((resolve) => resolve(m))
        });
        
        // Determine basic extension from mime type
        let ext = '.bin';
        if (mime.includes('png')) ext = '.png';
        else if (mime.includes('webp')) ext = '.webp';
        else if (mime.includes('jpeg') || mime.includes('jpg')) ext = '.jpg';
        else if (mime.includes('mp4')) ext = '.mp4';
        else if (mime.includes('pdf')) ext = '.pdf';

        const fileName = `media_${session.files.length.toString().padStart(4, '0')}${ext}`;
        const filePath = path.join(session.tmpDir, fileName);

        await fs.writeFile(filePath, buffer as Buffer);
        session.files.push(filePath);
        
        // React with thumbs up to indicate the media was added
        await sock.sendMessage(jid, { react: { text: "👍", key: msg.key } });
        return true;
    } catch (err) {
        logger.error({ err }, 'Failed to download intercepted media for session');
        return true; // Still swallow it
    }
}

/**
 * Finish the session and return the collected file paths.
 */
export async function finishMediaSession(jid: string): Promise<string[]> {
    const session = sessions.get(jid);
    if (!session) throw new Error('No active media session');
    
    if (session.files.length === 0) {
        await cancelMediaSession(jid);
        throw new Error('No media files were sent in this session.');
    }

    if (session.timeoutId) {
        clearTimeout(session.timeoutId);
    }

    const files = [...session.files];
    
    // We remove it from the active map, but leave the directory intact for the caller to process and clean up
    sessions.delete(jid);
    
    return files;
}

/**
 * Cancel the session and delete the temporary directory.
 */
export async function cancelMediaSession(jid: string): Promise<void> {
    const session = sessions.get(jid);
    if (!session) return;

    if (session.timeoutId) {
        clearTimeout(session.timeoutId);
    }

    try {
        await fs.rm(session.tmpDir, { recursive: true, force: true });
    } catch (e) {
        logger.error({ err: e, tmpDir: session.tmpDir }, 'Failed to delete session tmpDir');
    }

    sessions.delete(jid);
}

/**
 * Clean up the temporary directory after processing is complete.
 * Caller should pass the path of one of the files or the tmpDir itself.
 */
export async function cleanupMediaSession(filePathOrDir: string): Promise<void> {
    try {
        const stat = await fs.stat(filePathOrDir);
        const dir = stat.isDirectory() ? filePathOrDir : path.dirname(filePathOrDir);
        await fs.rm(dir, { recursive: true, force: true });
    } catch (e) {}
}

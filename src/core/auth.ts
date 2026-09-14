import { jidNormalizedUser } from '@whiskeysockets/baileys';
import { getConfig, updateConfig } from '../config/config.js';
import logger from '../utils/logger.js';

/**
 * Normalize a phone number or raw JID to a WhatsApp JID.
 * Strips +, spaces, dashes, and appends @s.whatsapp.net if needed.
 * Also strips device suffixes (e.g. :8@s.whatsapp.net -> @s.whatsapp.net).
 */
export function normalizeJid(input: string): string {
    if (!input) return '';
    let cleaned = input.replace(/[\s\-\+\(\)]/g, '').trim();

    if (!cleaned.includes('@')) {
        cleaned = `${cleaned}@s.whatsapp.net`;
    }

    return jidNormalizedUser(cleaned) || cleaned;
}

/**
 * Check if a JID is authorized to use the bot.
 */
export function isAuthorized(jid: string): boolean {
    const config = getConfig();
    const normalized = normalizeJid(jid);
    if (!normalized) return false;

    // Owner is always authorized
    const owner = normalizeJid(config.ownerJid);
    if (owner && normalized === owner) return true;

    return (config.whitelist || []).some(item => normalizeJid(item) === normalized);
}

/**
 * Check if a JID is an admin or owner.
 */
export function isAdmin(jid: string): boolean {
    const config = getConfig();
    const normalized = normalizeJid(jid);
    if (!normalized) return false;

    // Owner is always an admin
    const owner = normalizeJid(config.ownerJid);
    if (owner && normalized === owner) return true;

    const admins = config.admins || [];
    return admins.some(item => normalizeJid(item) === normalized);
}

/**
 * Check if a JID is the bot owner.
 */
export function isOwner(jid: string): boolean {
    const config = getConfig();
    const normalized = normalizeJid(jid);
    const owner = normalizeJid(config.ownerJid);
    return !!normalized && normalized === owner;
}

/**
 * Add a JID to the admins.
 */
export async function addAdmin(phoneNumber: string, name?: string): Promise<boolean> {
    const jid = normalizeJid(phoneNumber);
    if (!jid) return false;
    const config = getConfig();

    if (!config.admins) config.admins = [];
    if (config.admins.some(item => normalizeJid(item) === jid)) {
        return false; // already admin
    }

    config.admins.push(jid);
    // Automatically whitelist admins
    if (!config.whitelist.some(item => normalizeJid(item) === jid)) {
        config.whitelist.push(jid);
    }
    if (name) {
        config.aliases[jid] = name;
    }
    
    await updateConfig({ admins: config.admins, whitelist: config.whitelist, aliases: config.aliases });
    logger.info({ jid, name }, 'Added to admins');
    return true;
}

/**
 * Remove a JID from the admins.
 */
export async function removeAdmin(phoneNumber: string): Promise<boolean> {
    const jid = normalizeJid(phoneNumber);
    if (!jid) return false;
    const config = getConfig();
    const owner = normalizeJid(config.ownerJid);

    if (jid === owner) {
        return false; // owner can't be removed
    }

    if (!config.admins) return false;

    const idx = config.admins.findIndex(item => normalizeJid(item) === jid);
    if (idx === -1) {
        return false;
    }

    config.admins.splice(idx, 1);
    await updateConfig({ admins: config.admins });
    logger.info({ jid }, 'Removed from admins');
    return true;
}

/**
 * Add a JID to the whitelist.
 */
export async function addToWhitelist(phoneNumber: string, name?: string): Promise<boolean> {
    const jid = normalizeJid(phoneNumber);
    if (!jid) return false;
    const config = getConfig();

    if (config.whitelist.some(item => normalizeJid(item) === jid)) {
        return false; // already whitelisted
    }

    if (name) {
        config.aliases[jid] = name;
    }

    await updateConfig({ whitelist: config.whitelist, aliases: config.aliases });
    logger.info({ jid, name }, 'Added to whitelist');
    return true;
}

/**
 * Remove a JID from the whitelist.
 */
export async function removeFromWhitelist(phoneNumber: string): Promise<boolean> {
    const jid = normalizeJid(phoneNumber);
    if (!jid) return false;
    const config = getConfig();
    const owner = normalizeJid(config.ownerJid);

    if (jid === owner) {
        return false; // can't remove owner
    }

    const idx = config.whitelist.findIndex(item => normalizeJid(item) === jid);
    if (idx === -1) {
        return false; // not in whitelist
    }

    config.whitelist.splice(idx, 1);
    await updateConfig({ whitelist: config.whitelist });
    logger.info({ jid }, 'Removed from whitelist');
    return true;
}

/**
 * Get the whitelist.
 */
export function getWhitelist(): string[] {
    return getConfig().whitelist;
}

/**
 * Get the admins.
 */
export function getAdmins(): string[] {
    const config = getConfig();
    const owner = config.ownerJid || '';
    return config.admins || (owner ? [owner] : []);
}

/**
 * Set a name alias for a JID.
 */
export async function setAlias(phoneNumber: string, name: string): Promise<void> {
    const jid = normalizeJid(phoneNumber);
    if (!jid) return;
    const config = getConfig();
    config.aliases[jid] = name;
    await updateConfig({ aliases: config.aliases });
}

/**
 * Get the name alias for a JID (if any).
 */
export function getAlias(phoneNumber: string): string | undefined {
    const jid = normalizeJid(phoneNumber);
    if (!jid) return undefined;
    const config = getConfig();
    return config.aliases[jid];
}

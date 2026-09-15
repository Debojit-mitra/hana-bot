import { getDefaultConfig } from './default-config.js';
import type { BotConfig } from '../types/index.js';
import { ConfigModel } from '../db/models/Config.js';
import logger from '../utils/logger.js';
import { getEnvConfig } from './env.js';

let currentConfig: BotConfig;

/**
 * Load config from MongoDB, or create with defaults if it doesn't exist.
 */
export async function loadConfig(): Promise<BotConfig> {
    const defaults = getDefaultConfig();
    const envConfig = getEnvConfig();

    try {
        let configDoc = await ConfigModel.findOne({});
        if (!configDoc) {
            configDoc = await ConfigModel.create({ config: defaults });
            logger.info('Created default config in MongoDB');
        }
        currentConfig = deepMerge(defaults, configDoc.config) as BotConfig;
        logger.info('Loaded config from MongoDB');
    } catch (err) {
        logger.error({ err }, 'Failed to load config from MongoDB, using defaults');
        currentConfig = defaults;
    }

    // Ensure owner (from env) is always properly initialized in state
    // Set owner JID and add to whitelist/admins
    const rawOwnerNumber = envConfig.ownerNumber || envConfig.phoneNumber;
    if (rawOwnerNumber) {
        const cleanedNumber = rawOwnerNumber.replace(/[\s\-\+\(\)]/g, '');
        const jid = `${cleanedNumber}@s.whatsapp.net`;
        currentConfig.ownerJid = jid;
        
        if (!currentConfig.whitelist.includes(jid)) {
            currentConfig.whitelist.push(jid);
        }
        if (!currentConfig.admins) currentConfig.admins = [];
        if (!currentConfig.admins.includes(jid)) {
            currentConfig.admins.push(jid);
        }
    }

    if (!currentConfig.aliases) {
        currentConfig.aliases = {};
    }

    return currentConfig;
}

/**
 * Get the current config (must call loadConfig first).
 */
export function getConfig(): BotConfig {
    if (!currentConfig) {
        throw new Error('Config not loaded yet. Call loadConfig() first.');
    }
    return currentConfig;
}

/**
 * Save current config to MongoDB.
 */
export async function saveConfig(): Promise<void> {
    try {
        await ConfigModel.replaceOne({}, { config: currentConfig }, { upsert: true });
        logger.debug('Config saved to MongoDB');
    } catch (err) {
        logger.error({ err }, 'Failed to save config to MongoDB');
    }
}

/**
 * Update a section of the config and persist it.
 */
export async function updateConfig(updates: Partial<BotConfig>): Promise<BotConfig> {
    currentConfig = deepMerge(currentConfig, updates) as BotConfig;
    await saveConfig();
    return currentConfig;
}

/**
 * Deep merge source into target (source values override target).
 */
function deepMerge(target: Record<string, any>, source: Record<string, any>): Record<string, any> {
    const result = { ...target };
    for (const key of Object.keys(source)) {
        if (
            source[key] &&
            typeof source[key] === 'object' &&
            !Array.isArray(source[key]) &&
            target[key] &&
            typeof target[key] === 'object' &&
            !Array.isArray(target[key])
        ) {
            result[key] = deepMerge(target[key], source[key]);
        } else {
            result[key] = source[key];
        }
    }
    return result;
}

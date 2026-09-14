import type { BotConfig } from '../types/index.js';

export function getDefaultConfig(): BotConfig {
    return {
        whitelist: [],
        admins: [],
        aliases: {},
        ownerJid: '',
        commandPrefix: '!',
        ping: {
            sites: [],
            intervalMinutes: 5,
            timeoutMs: 10000,
        },
        alerts: {
            enabled: false,
            channels: [],
            checkIntervalMinutes: 5,
            failureThreshold: 3,
        },
        jenkins: {
            enabled: false,
        },
    };
}

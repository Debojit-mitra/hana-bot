import type { EnvConfig } from '../types/index.js';
import dotenv from 'dotenv';
import logger from '../utils/logger.js';

// Load from .env if present
dotenv.config();

let envConfig: EnvConfig;

export function loadEnvConfig(): EnvConfig {
    if (envConfig) return envConfig;

    const env = process.env;

    const config: EnvConfig = {
        phoneNumber: env.PHONE_NUMBER || '',
        mongoUri: env.MONGO_URI || env.MONGODB_URI || 'mongodb://127.0.0.1:27017/hanabot',
        externalServers: [],
        pingSites: [],
        wireguard: {
            sshHost: env.WG_SSH_HOST || '',
            sshPort: parseInt(env.WG_SSH_PORT || '22', 10),
            sshUser: env.WG_SSH_USER || 'root',
            sshKeyPath: env.WG_SSH_KEY_PATH || '',
            interface: env.WG_INTERFACE || 'wg0',
            configPath: env.WG_CONFIG_PATH || '/etc/wireguard/wg0.conf',
            serverEndpoint: env.WG_SERVER_ENDPOINT || '',
            dns: env.WG_DNS || '1.1.1.1,1.0.0.1',
            allowedIps: env.WG_ALLOWED_IPS || '0.0.0.0/0',
            subnet: env.WG_SUBNET || '10.0.0',
        },
        ai: {
            provider: (env.AI_PROVIDER as any) || 'none',
            apiKey: env.AI_API_KEY || '',
            model: env.AI_MODEL || '',
            fallbackModel: env.AI_FALLBACK_MODEL || undefined,
            baseUrl: env.AI_BASE_URL || '',
            rpmLimit: parseInt(env.AI_RPM_LIMIT || '15', 10),
            historyExpirationDays: parseInt(env.AI_HISTORY_EXPIRATION_DAYS || '3', 10),
            historyMaxMessages: parseInt(env.AI_HISTORY_MAX_MESSAGES || '30', 10),
            memoryMaxPerUser: parseInt(env.AI_MEMORY_MAX_PER_USER || '50', 10),
        },
        jenkins: {
            enabled: process.env.JENKINS_ENABLED === 'true',
            port: parseInt(process.env.JENKINS_PORT || '3000', 10),
            webhookBaseUrl: process.env.WEBHOOK_BASE_URL,
            serverUrl: process.env.JENKINS_SERVER_URL,
        },
    };

    if (env.EXTERNAL_SERVERS_JSON) {
        try {
            config.externalServers = JSON.parse(env.EXTERNAL_SERVERS_JSON);
        } catch (err) {
            logger.error({ err }, 'Failed to parse EXTERNAL_SERVERS_JSON');
        }
    }

    if (env.PING_SITES_JSON) {
        try {
            config.pingSites = JSON.parse(env.PING_SITES_JSON);
        } catch (err) {
            logger.error({ err }, 'Failed to parse PING_SITES_JSON');
        }
    }

    envConfig = config;
    return config;
}

export function getEnvConfig(): EnvConfig {
    if (!envConfig) {
        return loadEnvConfig();
    }
    return envConfig;
}

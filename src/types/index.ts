// ─── Shared Types ───────────────────────────────────────────────────────────

export interface SiteConfig {
    name: string;
    url: string;
}

export interface ExternalServerConfig {
    name: string;
    url: string;
    apiKey: string;
}

export interface PingResult {
    name: string;
    url: string;
    status: 'up' | 'down';
    responseTime: number | null;
    statusCode: number | null;
    error?: string;
}

export interface WireGuardPeer {
    name: string;
    publicKey: string;
    allowedIps: string;
    latestHandshake?: string;
    transferRx?: string;
    transferTx?: string;
    endpoint?: string;
}

export interface ServerStats {
    hostname: string;
    cpuUsage: number;
    cpuCores: number;
    cpuModel: string;
    memTotal: number;
    memUsed: number;
    memPercent: number;
    diskTotal: string;
    diskUsed: string;
    diskPercent: string;
    uptime: number;
    loadAvg: number[];
    platform: string;
    networkInterfaces: { name: string; address: string }[];
}

export interface AlertState {
    url: string;
    name: string;
    status: 'up' | 'down' | 'unknown';
    consecutiveFailures: number;
    lastChecked: Date | null;
    lastStatusChange: Date | null;
}

export interface AlertChannel {
    jid: string;
    events: ('uptime' | 'jenkins')[];
}

export interface EnvConfig {
    phoneNumber: string;
    mongoUri: string;
    externalServers: ExternalServerConfig[];
    pingSites: SiteConfig[];
    wireguard: {
        sshHost: string;
        sshPort: number;
        sshUser: string;
        sshKeyPath: string;
        interface: string;
        configPath: string;
        serverEndpoint: string;
        dns: string;
        allowedIps: string;
        subnet: string;
    };
    ai: {
        provider: 'none' | 'gemini' | 'openai' | 'claude' | 'ollama';
        apiKey: string;
        model: string;
        fallbackModel?: string;
        rpmLimit: number;
        baseUrl: string;
        historyExpirationDays: number;
        historyMaxMessages: number;
        memoryMaxPerUser: number;
    };
    jenkins: {
        enabled: boolean;
        port: number;
        webhookBaseUrl?: string;
        serverUrl?: string;
    };
    timezone: string;
}

export interface BotConfig {
    whitelist: string[];
    admins: string[];
    aliases: Record<string, string>;
    ownerJid: string; // The owner is derived from EnvConfig at load time and saved here
    commandPrefix: string;
    ping: {
        sites: SiteConfig[]; // dynamic sites added via bot
        intervalMinutes: number;
        timeoutMs: number;
    };
    alerts: {
        enabled: boolean;
        channels: AlertChannel[];
        checkIntervalMinutes: number;
        failureThreshold: number;
    };
    jenkins: {
        enabled: boolean; // boolean toggle for the listener (active/inactive)
    };
}

export interface CommandContext {
    jid: string;
    sender: string;
    command: string;
    args: string[];
    pushName: string;
    rawMessage: string;
    rawMsg: any; // WAMessage object
    quotedMessage?: string;
    reply: (text: string) => Promise<void>;
    replyWithFile: (content: Buffer | { url: string }, filename: string, mimetype: string, caption?: string) => Promise<void>;
    react: (emoji: string) => Promise<void>;
    messageKey: any;
    sock?: any;
}

export type CommandHandler = (ctx: CommandContext) => Promise<void>;

export interface ModuleRegistration {
    name: string;
    commands: Map<string, CommandHandler>;
    description: string;
}

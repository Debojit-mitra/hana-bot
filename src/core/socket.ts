import makeWASocket, {
    DisconnectReason,
    makeCacheableSignalKeyStore,
    proto,
    type WASocket,
    type CacheStore,
} from '@whiskeysockets/baileys';
import { Boom } from '@hapi/boom';
import NodeCache from '@cacheable/node-cache';
import logger from '../utils/logger.js';
import { useMongoDBAuthState, clearMongoDBAuthState } from './mongo-auth.js';

const msgRetryCounterCache = new NodeCache() as CacheStore;
const groupCache = new NodeCache({ stdTTL: 5 * 60, useClones: false });
const messageStore = new Map<string, proto.IMessage>();

let sock: WASocket | null = null;
let pairingCodeRequested = false;

export interface SocketCallbacks {
    onConnected: (sock: WASocket) => void;
    onDisconnected: () => void;
    onMessage: (sock: WASocket, messages: any) => void;
}

/**
 * Create and connect the Baileys WhatsApp socket.
 * Handles pairing code auth, QR fallback, and auto-reconnection.
 */
export async function createSocket(callbacks: SocketCallbacks): Promise<WASocket> {
    const { state, saveCreds } = await useMongoDBAuthState();

    const phoneNumber = process.env.PHONE_NUMBER;

    // Reset pairing code flag on new socket creation
    pairingCodeRequested = false;

    // Use minimal config per official docs
    sock = makeWASocket({
        auth: {
            creds: state.creds,
            keys: makeCacheableSignalKeyStore(state.keys, logger as any),
        },
        markOnlineOnConnect: false,
        msgRetryCounterCache,
        generateHighQualityLinkPreview: false,
        logger: logger as any,
        getMessage: async (key) => {
            const id = `${key.remoteJid}:${key.id}`;
            return messageStore.get(id);
        },
        cachedGroupMetadata: async (jid) => groupCache.get(jid) as any,
    });

    // Use batch event processing
    sock.ev.process(async (events) => {
        // Handle connection updates
        if (events['connection.update']) {
            const update = events['connection.update'];
            const { connection, lastDisconnect, qr } = update;

            if (qr && phoneNumber && !sock!.authState.creds.registered && !pairingCodeRequested) {
                pairingCodeRequested = true;
                try {
                    const code = await sock!.requestPairingCode(phoneNumber);
                    logger.info(`🔗 Pairing Code: ${code}`);
                    console.log(`\n${'='.repeat(40)}`);
                    console.log(`  WhatsApp Pairing Code: ${code}`);
                    console.log(`${'='.repeat(40)}\n`);
                    console.log('Enter this code in WhatsApp > Linked Devices > Link a Device\n');
                } catch (err) {
                    logger.error({ err }, 'Failed to request pairing code');
                    pairingCodeRequested = false;
                }
            } else if (qr && !phoneNumber) {
                logger.info('QR code generated — set PHONE_NUMBER in .env to use pairing code instead');
            }

            if (connection === 'close') {
                const statusCode = (lastDisconnect?.error as Boom)?.output?.statusCode;
                const shouldReconnect = statusCode !== DisconnectReason.loggedOut;

                logger.warn({ statusCode, shouldReconnect }, 'Connection closed');

                callbacks.onDisconnected();

                if (shouldReconnect) {
                    logger.info('Reconnecting in 5 seconds...');
                    setTimeout(() => createSocket(callbacks), 5000);
                } else {
                    logger.error('Logged out. Clearing MongoDB auth state and exiting. Restart to re-authenticate.');
                    await clearMongoDBAuthState();
                    process.exit(1);
                }
            } else if (connection === 'open') {
                logger.info('✅ Connected to WhatsApp');
                callbacks.onConnected(sock!);
            }
        }

        // Save credentials whenever they update
        if (events['creds.update']) {
            await saveCreds();
        }

        // Forward message events and populate message store
        if (events['messages.upsert']) {
            const upsert = events['messages.upsert'];
            
            // Cache messages for retries
            for (const msg of upsert.messages) {
                if (msg.key.id && msg.message) {
                    messageStore.set(`${msg.key.remoteJid}:${msg.key.id}`, msg.message);
                }
            }

            if (upsert.type === 'notify' || upsert.type === 'append') {
                callbacks.onMessage(sock!, upsert);
            }
        }

        // Keep group cache warm
        if (events['groups.update']) {
            for (const event of events['groups.update']) {
                if (sock && event.id) {
                    try {
                        const metadata = await sock.groupMetadata(event.id);
                        groupCache.set(event.id, metadata);
                    } catch (err) {
                        logger.error({ err, groupId: event.id }, 'Failed to fetch group metadata');
                    }
                }
            }
        }

        if (events['group-participants.update']) {
            const event = events['group-participants.update'];
            if (sock && event.id) {
                try {
                    const metadata = await sock.groupMetadata(event.id);
                    groupCache.set(event.id, metadata);
                } catch (err) {
                    logger.error({ err, groupId: event.id }, 'Failed to update group participants metadata');
                }
            }
        }
    });

    return sock;
}

/**
 * Get the current socket instance.
 */
export function getSocket(): WASocket | null {
    return sock;
}

/**
 * Send presence update (appear online briefly when replying).
 * Safe, best-effort and non-blocking.
 */
export async function sendPresenceUpdate(jid: string): Promise<void> {
    if (!sock) return;
    try {
        // Groups and newsletters do not support presence subscribe in Baileys
        if (!jid.endsWith('@g.us') && !jid.endsWith('@newsletter')) {
            sock.presenceSubscribe(jid).catch(() => {});
        }
        await sock.sendPresenceUpdate('composing', jid);
        // Brief delay to simulate typing, then go unavailable
        setTimeout(async () => {
            try {
                await sock?.sendPresenceUpdate('paused', jid);
            } catch {
                // ignore
            }
        }, 500);
    } catch {
        // presence updates are best-effort
    }
}

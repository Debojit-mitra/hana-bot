import { Client } from 'ssh2';
import { readFileSync } from 'fs';
import { getEnvConfig } from '../../config/env.js';
import type { WireGuardPeer } from '../../types/index.js';
import logger from '../../utils/logger.js';

/**
 * Execute a command on the remote WireGuard server via SSH.
 */
async function sshExec(command: string): Promise<string> {
    const config = getEnvConfig().wireguard;

    if (!config.sshHost || !config.sshKeyPath) {
        throw new Error('WireGuard SSH not configured. Set WG_SSH_HOST and WG_SSH_KEY_PATH in .env');
    }

    return new Promise((resolve, reject) => {
        const conn = new Client();
        let output = '';
        let errorOutput = '';

        conn.on('ready', () => {
            conn.exec(command, (err, stream) => {
                if (err) {
                    conn.end();
                    return reject(err);
                }

                stream.on('data', (data: Buffer) => {
                    output += data.toString();
                });

                stream.stderr.on('data', (data: Buffer) => {
                    errorOutput += data.toString();
                });

                stream.on('close', (code: number) => {
                    conn.end();
                    if (code !== 0 && errorOutput) {
                        reject(new Error(`Command failed (exit ${code}): ${errorOutput.trim()}`));
                    } else {
                        resolve(output.trim());
                    }
                });
            });
        });

        conn.on('error', (err) => {
            reject(new Error(`SSH connection failed: ${err.message}`));
        });

        let privateKey: Buffer;
        try {
            privateKey = readFileSync(config.sshKeyPath);
        } catch (err) {
            reject(new Error(`Cannot read SSH key at ${config.sshKeyPath}`));
            return;
        }

        conn.connect({
            host: config.sshHost,
            port: config.sshPort,
            username: config.sshUser,
            privateKey,
            readyTimeout: 10000,
        });
    });
}

/**
 * List all WireGuard peers with their status.
 */
export async function listPeers(): Promise<WireGuardPeer[]> {
    const config = getEnvConfig().wireguard;
    const iface = config.interface;

    // Get peer data from wg show
    const wgOutput = await sshExec(`sudo wg show ${iface}`);

    // Get name mappings from the config file comments
    const configContent = await sshExec(`sudo cat ${config.configPath}`);
    const nameMap = parseNameMappings(configContent);

    return parseWgShow(wgOutput, nameMap);
}

/**
 * Get WireGuard interface status.
 */
export async function getInterfaceStatus(): Promise<string> {
    const config = getEnvConfig().wireguard;
    const output = await sshExec(`sudo wg show ${config.interface}`);
    return output;
}

/**
 * Add a new WireGuard peer.
 * Returns the client configuration text.
 */
export async function addPeer(name: string): Promise<{ config: string; publicKey: string; ip: string }> {
    const wgConfig = getEnvConfig().wireguard;
    const iface = wgConfig.interface;

    // Check if name already exists
    const configContent = await sshExec(`sudo cat ${wgConfig.configPath}`);
    if (configContent.includes(`# Name: ${name}`)) {
        throw new Error(`Peer "${name}" already exists`);
    }

    // Generate key pair on the server
    const privateKey = await sshExec('wg genkey');
    const publicKey = await sshExec(`echo "${privateKey}" | wg pubkey`);
    const presharedKey = await sshExec('wg genpsk');

    // Find next available IP
    const nextIp = await findNextAvailableIp(wgConfig.subnet, configContent);

    // Get server's public key
    const serverPublicKey = await sshExec(`sudo wg show ${iface} public-key`);

    // Add peer to server config safely using base64
    const peerBlock = [
        '',
        `# Name: ${name}`,
        `# Added: ${new Date().toISOString()}`,
        '[Peer]',
        `PublicKey = ${publicKey}`,
        `PresharedKey = ${presharedKey}`,
        `AllowedIPs = ${nextIp}/32`,
        '',
    ].join('\n');

    const b64PeerBlock = Buffer.from(peerBlock).toString('base64');
    await sshExec(`echo "${b64PeerBlock}" | base64 -d | sudo tee -a ${wgConfig.configPath} > /dev/null`);

    // Reload WireGuard without dropping connections
    await sshExec(`sudo bash -c "wg syncconf ${iface} <(wg-quick strip ${iface})"`);

    // Generate client config
    const clientConfig = [
        '[Interface]',
        `PrivateKey = ${privateKey}`,
        `Address = ${nextIp}/32`,
        `DNS = ${wgConfig.dns}`,
        '',
        '[Peer]',
        `PublicKey = ${serverPublicKey}`,
        `PresharedKey = ${presharedKey}`,
        `Endpoint = ${wgConfig.serverEndpoint}`,
        `AllowedIPs = ${wgConfig.allowedIps}`,
        'PersistentKeepalive = 25',
    ].join('\n');

    logger.info({ name, ip: nextIp }, 'WireGuard peer added');

    return { config: clientConfig, publicKey, ip: nextIp };
}

/**
 * Revoke (remove) a WireGuard peer by name.
 */
export async function revokePeer(name: string): Promise<boolean> {
    const wgConfig = getEnvConfig().wireguard;
    const iface = wgConfig.interface;

    // Read current config
    const configContent = await sshExec(`sudo cat ${wgConfig.configPath}`);

    // Find the peer block by name comment
    const lines = configContent.split('\n');
    let startIdx = -1;
    let endIdx = -1;

    for (let i = 0; i < lines.length; i++) {
        if (lines[i].includes(`# Name: ${name}`)) {
            // Look backwards for empty line or start
            startIdx = i;
            for (let j = i - 1; j >= 0; j--) {
                if (lines[j].trim() === '') {
                    startIdx = j;
                    break;
                }
            }

            // Look forward for next peer or end
            endIdx = lines.length - 1;
            for (let j = i + 1; j < lines.length; j++) {
                if (lines[j].startsWith('# Name:') || (lines[j].trim() === '' && j > i + 3)) {
                    endIdx = j - 1;
                    break;
                }
            }
            break;
        }
    }

    if (startIdx === -1) {
        throw new Error(`Peer "${name}" not found`);
    }

    // Get the public key of this peer to remove from live config
    let publicKey = '';
    for (let i = startIdx; i <= endIdx; i++) {
        const match = lines[i].match(/PublicKey\s*=\s*(.+)/);
        if (match) {
            publicKey = match[1].trim();
            break;
        }
    }

    // Remove the peer block from config
    const newLines = [...lines.slice(0, startIdx), ...lines.slice(endIdx + 1)];
    const newConfig = newLines.join('\n').replace(/\n{3,}/g, '\n\n');

    // Write back and reload safely using base64
    const b64Config = Buffer.from(newConfig).toString('base64');
    await sshExec(`echo "${b64Config}" | base64 -d | sudo tee ${wgConfig.configPath} > /dev/null`);

    // Remove peer from live interface safely
    if (publicKey) {
        await sshExec(`sudo wg set ${iface} peer "${publicKey}" remove`);
    }

    logger.info({ name, publicKey }, 'WireGuard peer revoked');
    return true;
}

/**
 * Parse `wg show` output into structured peer data.
 */
function parseWgShow(output: string, nameMap: Map<string, string>): WireGuardPeer[] {
    const peers: WireGuardPeer[] = [];
    const sections = output.split(/(?=peer:)/);

    for (const section of sections) {
        const peerMatch = section.match(/peer:\s*(\S+)/);
        if (!peerMatch) continue;

        const publicKey = peerMatch[1];
        const peer: WireGuardPeer = {
            name: nameMap.get(publicKey) || 'Unknown',
            publicKey,
            allowedIps: extractField(section, 'allowed ips') || 'N/A',
            latestHandshake: extractField(section, 'latest handshake'),
            transferRx: extractTransfer(section, 'received'),
            transferTx: extractTransfer(section, 'sent'),
            endpoint: extractField(section, 'endpoint'),
        };

        peers.push(peer);
    }

    return peers;
}

/**
 * Parse name mappings from config file comments (# Name: xxx).
 */
function parseNameMappings(configContent: string): Map<string, string> {
    const map = new Map<string, string>();
    const lines = configContent.split('\n');

    let currentName = '';
    for (const line of lines) {
        // Match any comment line and assume it's the peer name (or part of it)
        // If they use `# Name: Phone`, we strip the `Name:` part.
        const commentMatch = line.match(/^#\s*(?:Name:\s*)?(.+)/i);
        if (commentMatch) {
            currentName = commentMatch[1].trim();
            continue;
        }

        const keyMatch = line.match(/^PublicKey\s*=\s*(.+)/);
        if (keyMatch && currentName) {
            map.set(keyMatch[1].trim(), currentName);
            currentName = '';
        }
    }

    return map;
}

/**
 * Extract a field value from wg show output.
 */
function extractField(text: string, field: string): string | undefined {
    const regex = new RegExp(`${field}:\\s*(.+)`, 'i');
    const match = text.match(regex);
    return match ? match[1].trim() : undefined;
}

/**
 * Extract transfer data from wg show output.
 */
function extractTransfer(text: string, direction: string): string | undefined {
    const transferLine = extractField(text, 'transfer');
    if (!transferLine) return undefined;

    const regex = new RegExp(`([\\d.]+\\s*\\w+)\\s*${direction}`, 'i');
    const match = transferLine.match(regex);
    return match ? match[1] : undefined;
}

/**
 * Find the next available IP in the WireGuard subnet.
 */
async function findNextAvailableIp(subnet: string, configContent: string): Promise<string> {
    // Extract all used IPs from config
    const usedIps = new Set<number>();
    const regex = /AllowedIPs\s*=\s*(\d+\.\d+\.\d+\.)(\d+)/gi;
    let match;

    while ((match = regex.exec(configContent)) !== null) {
        usedIps.add(parseInt(match[2], 10));
    }

    // Server usually uses .1
    usedIps.add(1);

    // Find next available (start from .2)
    for (let i = 2; i < 255; i++) {
        if (!usedIps.has(i)) {
            return `${subnet}.${i}`;
        }
    }

    throw new Error('No available IPs in the subnet');
}

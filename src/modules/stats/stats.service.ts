import os from 'os';
import { exec } from 'child_process';
import { promisify } from 'util';
import axios from 'axios';
import type { ServerStats } from '../../types/index.js';
import { getConfig } from '../../config/config.js';
import { getEnvConfig } from '../../config/env.js';

const execAsync = promisify(exec);

/**
 * Gather comprehensive server statistics.
 */
export async function getServerStats(): Promise<ServerStats> {
    const hostname = os.hostname();
    const cpuCores = os.cpus().length;
    const cpuModel = os.cpus()[0]?.model || 'Unknown';
    const memTotal = os.totalmem();
    const memFree = os.freemem();
    const memUsed = memTotal - memFree;
    const memPercent = (memUsed / memTotal) * 100;
    const uptime = os.uptime();
    const loadAvg = os.loadavg();
    const platform = `${os.type()} ${os.release()} (${os.arch()})`;

    // Get CPU usage via sampling
    const cpuUsage = await getCpuUsage();

    // Get disk usage
    const disk = await getDiskUsage();

    // Get network interfaces
    const networkInterfaces = getNetworkInterfaces();

    return {
        hostname,
        cpuUsage,
        cpuCores,
        cpuModel,
        memTotal,
        memUsed,
        memPercent,
        diskTotal: disk.total,
        diskUsed: disk.used,
        diskPercent: disk.percent,
        uptime,
        loadAvg,
        platform,
        networkInterfaces,
    };
}

/**
 * Get CPU usage by sampling over a short interval.
 */
async function getCpuUsage(): Promise<number> {
    const cpus1 = os.cpus();
    await new Promise(resolve => setTimeout(resolve, 500));
    const cpus2 = os.cpus();

    let totalDiff = 0;
    let idleDiff = 0;

    for (let i = 0; i < cpus1.length; i++) {
        const c1 = cpus1[i];
        const c2 = cpus2[i];

        const total1 = c1.times.user + c1.times.nice + c1.times.sys + c1.times.idle + c1.times.irq;
        const total2 = c2.times.user + c2.times.nice + c2.times.sys + c2.times.idle + c2.times.irq;

        totalDiff += total2 - total1;
        idleDiff += c2.times.idle - c1.times.idle;
    }

    if (totalDiff === 0) return 0;
    return ((totalDiff - idleDiff) / totalDiff) * 100;
}

/**
 * Get disk usage of the root partition.
 */
async function getDiskUsage(): Promise<{ total: string; used: string; percent: string }> {
    try {
        const { stdout } = await execAsync("df -h / | tail -1 | awk '{print $2, $3, $5}'");
        const parts = stdout.trim().split(/\s+/);
        return {
            total: parts[0] || 'N/A',
            used: parts[1] || 'N/A',
            percent: parts[2] || 'N/A',
        };
    } catch {
        return { total: 'N/A', used: 'N/A', percent: 'N/A' };
    }
}

/**
 * Get non-internal network interfaces with their IPs.
 */
function getNetworkInterfaces(): { name: string; address: string }[] {
    const interfaces = os.networkInterfaces();
    const result: { name: string; address: string }[] = [];

    for (const [name, addrs] of Object.entries(interfaces)) {
        if (!addrs) continue;
        for (const addr of addrs) {
            if (!addr.internal && addr.family === 'IPv4') {
                result.push({ name, address: addr.address });
            }
        }
    }

    return result;
}

/**
 * Fetch stats from a configured external server (e.g. Raspberry Pi, HP Server).
 */
export async function getExternalServerStats(serverName: string): Promise<ServerStats> {
    const envConfig = getEnvConfig();
    const server = envConfig.externalServers?.find((s: any) => s.name.toLowerCase() === serverName.toLowerCase());
    
    if (!server) {
        throw new Error(`External server '${serverName}' not found in configuration.`);
    }

    try {
        const response = await fetch(server.url, {
            method: 'GET',
            headers: {
                'X-API-Key': server.apiKey,
                'Content-Type': 'application/json'
            },
            // Adding a small timeout just in case
            signal: AbortSignal.timeout(10000)
        });

        if (!response.ok) {
            throw new Error(`API returned ${response.status} ${response.statusText}`);
        }

        return await response.json();
    } catch (err: any) {
        throw new Error(`Failed to fetch stats for ${serverName}: ${err.message}`);
    }
}

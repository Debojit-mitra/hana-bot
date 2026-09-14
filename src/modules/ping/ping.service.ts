import axios from 'axios';
import type { PingResult, SiteConfig } from '../../types/index.js';
import logger from '../../utils/logger.js';

/**
 * Ping a single site and return the result.
 */
export async function pingSite(site: SiteConfig, timeoutMs: number): Promise<PingResult> {
    const start = Date.now();

    try {
        const response = await axios.get(site.url, {
            timeout: timeoutMs,
            validateStatus: () => true, // Don't throw on non-2xx
            maxRedirects: 5,
            headers: {
                'User-Agent': 'HanaBot/1.0 HealthCheck',
            },
        });

        const responseTime = Date.now() - start;
        const isUp = response.status >= 200 && response.status < 500;

        return {
            name: site.name,
            url: site.url,
            status: isUp ? 'up' : 'down',
            responseTime,
            statusCode: response.status,
        };
    } catch (err: any) {
        const responseTime = Date.now() - start;
        let error = 'Unknown error';

        if (err.code === 'ECONNABORTED' || err.code === 'ETIMEDOUT') {
            error = `Timeout (${timeoutMs}ms)`;
        } else if (err.code === 'ECONNREFUSED') {
            error = 'Connection refused';
        } else if (err.code === 'ENOTFOUND') {
            error = 'DNS lookup failed';
        } else if (err.code === 'ERR_TLS_CERT_ALTNAME_INVALID') {
            error = 'SSL certificate error';
        } else if (err.message) {
            error = err.message.substring(0, 100);
        }

        logger.debug({ site: site.name, error }, 'Ping failed');

        return {
            name: site.name,
            url: site.url,
            status: 'down',
            responseTime: responseTime > timeoutMs ? null : responseTime,
            statusCode: null,
            error,
        };
    }
}

/**
 * Ping all configured sites in parallel.
 */
export async function pingAll(sites: SiteConfig[], timeoutMs: number): Promise<PingResult[]> {
    const results = await Promise.all(
        sites.map(site => pingSite(site, timeoutMs))
    );
    return results;
}

/**
 * Quick ping a URL (for ad-hoc pings via command).
 */
export async function pingUrl(url: string, timeoutMs: number = 10000): Promise<PingResult> {
    // Ensure URL has a protocol
    if (!url.startsWith('http://') && !url.startsWith('https://')) {
        url = `https://${url}`;
    }

    const site: SiteConfig = {
        name: new URL(url).hostname,
        url,
    };

    return pingSite(site, timeoutMs);
}

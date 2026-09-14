import type { AlertState, PingResult } from '../../types/index.js';
import { getConfig } from '../../config/config.js';
import { formatAlertDown, formatAlertUp } from '../../utils/format.js';
import logger from '../../utils/logger.js';

// In-memory state tracker for each monitored site
const alertStates = new Map<string, AlertState>();

/**
 * Initialize alert states from config.
 */
export function initAlertStates(): void {
    const config = getConfig();
    for (const site of config.ping.sites) {
        if (!alertStates.has(site.url)) {
            alertStates.set(site.url, {
                url: site.url,
                name: site.name,
                status: 'unknown',
                consecutiveFailures: 0,
                lastChecked: null,
                lastStatusChange: null,
            });
        }
    }
}

/**
 * Process ping results and return alert messages for any state changes.
 * Uses a failure threshold (default 2) to avoid flaky alerts.
 */
export function processResults(results: PingResult[]): string[] {
    const config = getConfig();
    const threshold = config.alerts.failureThreshold;
    const messages: string[] = [];

    for (const result of results) {
        let state = alertStates.get(result.url);

        if (!state) {
            state = {
                url: result.url,
                name: result.name,
                status: 'unknown',
                consecutiveFailures: 0,
                lastChecked: null,
                lastStatusChange: null,
            };
            alertStates.set(result.url, state);
        }

        state.lastChecked = new Date();

        if (result.status === 'down') {
            state.consecutiveFailures++;

            // Only alert when crossing the failure threshold (not on every check)
            if (state.consecutiveFailures === threshold && state.status !== 'down') {
                state.status = 'down';
                state.lastStatusChange = new Date();
                messages.push(formatAlertDown(
                    result.name,
                    result.url,
                    result.error || 'No response'
                ));
                logger.warn({ name: result.name, url: result.url }, 'Site went DOWN');
            }
        } else {
            // Site is up
            if (state.status === 'down') {
                // Recovery!
                state.status = 'up';
                state.lastStatusChange = new Date();
                messages.push(formatAlertUp(
                    result.name,
                    result.url,
                    result.responseTime || 0
                ));
                logger.info({ name: result.name, url: result.url }, 'Site RECOVERED');
            } else if (state.status === 'unknown') {
                state.status = 'up';
            }

            state.consecutiveFailures = 0;
        }
    }

    return messages;
}

/**
 * Get current alert states for status display.
 */
export function getAlertStates(): Map<string, AlertState> {
    return alertStates;
}

/**
 * Sync alert states when sites are added/removed from config.
 */
export function syncAlertStates(): void {
    const config = getConfig();
    const currentUrls = new Set(config.ping.sites.map(s => s.url));

    // Add new sites
    for (const site of config.ping.sites) {
        if (!alertStates.has(site.url)) {
            alertStates.set(site.url, {
                url: site.url,
                name: site.name,
                status: 'unknown',
                consecutiveFailures: 0,
                lastChecked: null,
                lastStatusChange: null,
            });
        }
    }

    // Remove stale sites
    for (const url of alertStates.keys()) {
        if (!currentUrls.has(url)) {
            alertStates.delete(url);
        }
    }
}

import { getConfig, updateConfig } from '../../config/config.js';
import { getEnvConfig } from '../../config/env.js';
import { pingAll, pingUrl } from './ping.service.js';
import { formatPingResults, formatPingResult } from '../../utils/format.js';
import { isAdmin } from '../../core/auth.js';
import type { CommandHandler, ModuleRegistration } from '../../types/index.js';

// ─── Command Handlers ───────────────────────────────────────────────────────

const handlePing: CommandHandler = async (ctx) => {
    const config = getConfig();

    if (ctx.args.length > 0) {
        // Ping a specific URL
        const url = ctx.args[0];
        await ctx.react('⏳');
        const result = await pingUrl(url, config.ping.timeoutMs);
        await ctx.react(result.status === 'up' ? '✅' : '❌');
        await ctx.reply(formatPingResult(result));
        return;
    }

    const envConfig = getEnvConfig();
    const allSites = [...envConfig.pingSites, ...config.ping.sites];

    // Ping all configured sites
    if (allSites.length === 0) {
        await ctx.reply('📡 No sites configured.\nUse `!addsite <name> <url>` to add one.');
        return;
    }

    await ctx.react('⏳');
    const results = await pingAll(allSites, config.ping.timeoutMs);
    const allUp = results.every(r => r.status === 'up');
    await ctx.react(allUp ? '✅' : '⚠️');
    await ctx.reply(formatPingResults(results));
};

const handleSites: CommandHandler = async (ctx) => {
    const config = getConfig();
    const envConfig = getEnvConfig();
    const sites = [...envConfig.pingSites, ...config.ping.sites];

    if (sites.length === 0) {
        await ctx.reply('📋 No sites configured.\nUse `!addsite <name> <url>` to add one.');
        return;
    }

    const lines = sites.map((s, i) => `${i + 1}. *${s.name}*\n   ${s.url}`);
    await ctx.reply([
        '📋 *Monitored Sites*',
        '━━━━━━━━━━━━━━━━━━',
        ...lines,
        '━━━━━━━━━━━━━━━━━━',
        `Total: ${sites.length} site(s)`,
    ].join('\n'));
};

const handleAddSite: CommandHandler = async (ctx) => {
    if (!isAdmin(ctx.sender)) {
        await ctx.reply('❌ This command is restricted to admins only.');
        return;
    }

    if (ctx.args.length < 2) {
        await ctx.reply('Usage: `!addsite <name> <url>`\nExample: `!addsite Google https://google.com`');
        return;
    }

    const name = ctx.args[0];
    let url = ctx.args[1];

    // Ensure URL has protocol
    if (!url.startsWith('http://') && !url.startsWith('https://')) {
        url = `https://${url}`;
    }

    // Validate URL
    try {
        new URL(url);
    } catch {
        await ctx.reply('❌ Invalid URL. Make sure it includes the protocol (https://).');
        return;
    }

    const config = getConfig();

    // Check for duplicates
    if (config.ping.sites.some(s => s.name.toLowerCase() === name.toLowerCase())) {
        await ctx.reply(`❌ Site "${name}" already exists.`);
        return;
    }

    config.ping.sites.push({ name, url });
    updateConfig({ ping: config.ping });

    await ctx.react('✅');
    await ctx.reply(`✅ Added *${name}* (${url}) to monitoring.`);
};

const handleRemoveSite: CommandHandler = async (ctx) => {
    if (!isAdmin(ctx.sender)) {
        await ctx.reply('❌ This command is restricted to admins only.');
        return;
    }

    if (ctx.args.length < 1) {
        await ctx.reply('Usage: `!rmsite <name>`\nExample: `!rmsite Google`');
        return;
    }

    const name = ctx.args[0];
    const config = getConfig();
    const idx = config.ping.sites.findIndex(s => s.name.toLowerCase() === name.toLowerCase());

    if (idx === -1) {
        await ctx.reply(`❌ Site "${name}" not found.\nUse \`!sites\` to see all sites.`);
        return;
    }

    const removed = config.ping.sites.splice(idx, 1)[0];
    updateConfig({ ping: config.ping });

    await ctx.react('✅');
    await ctx.reply(`🗑️ Removed *${removed.name}* (${removed.url}) from monitoring.`);
};

// ─── Module Registration ────────────────────────────────────────────────────

export function createPingModule(): ModuleRegistration {
    const commands = new Map<string, CommandHandler>();
    commands.set('ping', handlePing);
    commands.set('sites', handleSites);
    commands.set('addsite', handleAddSite);
    commands.set('rmsite', handleRemoveSite);

    return {
        name: 'Ping',
        commands,
        description: 'Website uptime monitoring',
    };
}

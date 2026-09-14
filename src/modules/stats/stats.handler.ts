import { getServerStats, getExternalServerStats } from './stats.service.js';
import { formatServerStats, formatExternalServerStats } from '../../utils/format.js';
import { getConfig } from '../../config/config.js';
import { getEnvConfig } from '../../config/env.js';
import type { CommandHandler, ModuleRegistration } from '../../types/index.js';

const handleStats: CommandHandler = async (ctx) => {
    await ctx.react('⏳');

    try {
        if (ctx.args.length > 0) {
            const serverName = ctx.args[0];
            const stats = await getExternalServerStats(serverName);
            const formatted = formatExternalServerStats(stats);
            await ctx.react('✅');
            await ctx.reply(formatted);
        } else {
            const stats = await getServerStats();
            const formatted = formatServerStats(stats);
            await ctx.react('✅');
            await ctx.reply(formatted);
        }
    } catch (err: any) {
        await ctx.react('❌');
        await ctx.reply(`Error: ${err.message}`);
    }
};

const handleServers: CommandHandler = async (ctx) => {
    const envConfig = getEnvConfig();
    const servers = envConfig.externalServers || [];
    
    if (servers.length === 0) {
        await ctx.reply('No external servers configured.');
        return;
    }

    const names = servers.map((s: any) => `• *${s.name}*`).join('\n');
    await ctx.reply(`🖥️ *Available External Servers:*\n\n${names}\n\nUse \`!stats <name>\` to view stats for a specific server.`);
};

export function createStatsModule(): ModuleRegistration {
    const commands = new Map<string, CommandHandler>();
    commands.set('stats', handleStats);
    commands.set('servers', handleServers);

    return {
        name: 'Stats',
        commands,
        description: 'Server statistics',
    };
}

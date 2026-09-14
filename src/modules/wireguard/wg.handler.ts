import { listPeers, addPeer, revokePeer, getInterfaceStatus } from './wg.service.js';
import { formatWireGuardPeers } from '../../utils/format.js';
import { isAdmin } from '../../core/auth.js';
import type { CommandHandler, ModuleRegistration } from '../../types/index.js';

const handleWg: CommandHandler = async (ctx) => {
    const subcommand = ctx.args[0]?.toLowerCase();

    if (!subcommand || subcommand === 'list') {
        await handleWgList(ctx);
        return;
    }

    if (subcommand === 'help') {
        await ctx.reply(
            '🔒 *WireGuard VPN*\n' +
            '━━━━━━━━━━━━━━━━━━\n' +
            'Usage:\n' +
            '  `!wg` or `!wg list` — List all peers\n' +
            '  `!wg add <name>` — Add new peer (Admin Only)\n' +
            '  `!wg revoke <name>` — Revoke a peer (Admin Only)\n' +
            '  `!wg status` — Interface raw status'
        );
        return;
    }

    switch (subcommand) {
        case 'add':
            await handleWgAdd(ctx);
            break;
        case 'revoke':
            await handleWgRevoke(ctx);
            break;
        case 'status':
            await handleWgStatus(ctx);
            break;
        default:
            await ctx.reply(`❓ Unknown subcommand: \`${subcommand}\`\nUse \`!wg\` for usage.`);
    }
};

const handleWgList: CommandHandler = async (ctx) => {
    await ctx.react('⏳');
    try {
        const peers = await listPeers();
        await ctx.react('✅');
        await ctx.reply(formatWireGuardPeers(peers));
    } catch (err: any) {
        await ctx.react('❌');
        await ctx.reply(`❌ Failed to list peers:\n${err.message}`);
    }
};

const handleWgAdd: CommandHandler = async (ctx) => {
    if (!isAdmin(ctx.sender)) {
        await ctx.reply('❌ This command is restricted to admins only.');
        return;
    }

    const name = ctx.args.slice(1).join(' ');

    if (!name) {
        await ctx.reply('Usage: `!wg add <name>`\nExample: `!wg add phone`');
        return;
    }

    // Validate name (alphanumeric + dashes/underscores)
    if (!/^[a-zA-Z0-9_-]+$/.test(name)) {
        await ctx.reply('❌ Name must be alphanumeric (dashes and underscores allowed).');
        return;
    }

    await ctx.react('⏳');

    try {
        const result = await addPeer(name);

        await ctx.react('✅');

        // Send config as text message
        await ctx.reply(
            `✅ *WireGuard Peer Added*\n` +
            `━━━━━━━━━━━━━━━━━━\n` +
            `Name: *${name}*\n` +
            `IP: \`${result.ip}\`\n` +
            `Key: \`${result.publicKey.substring(0, 16)}...\`\n` +
            `━━━━━━━━━━━━━━━━━━\n\n` +
            `\`\`\`\n${result.config}\n\`\`\``
        );

        // Also send as a .conf file
        const configBuffer = Buffer.from(result.config, 'utf-8');
        await ctx.replyWithFile(
            configBuffer,
            `${name}.conf`,
            'application/octet-stream',
            `📎 WireGuard config for *${name}*\nImport this file in your WireGuard client.`
        );
    } catch (err: any) {
        await ctx.react('❌');
        await ctx.reply(`❌ Failed to add peer:\n${err.message}`);
    }
};

const handleWgRevoke: CommandHandler = async (ctx) => {
    if (!isAdmin(ctx.sender)) {
        await ctx.reply('❌ This command is restricted to admins only.');
        return;
    }

    const name = ctx.args.slice(1).join(' ');

    if (!name) {
        await ctx.reply('Usage: `!wg revoke <name>`');
        return;
    }

    await ctx.react('⏳');

    try {
        await revokePeer(name);
        await ctx.react('✅');
        await ctx.reply(`🗑️ Peer *${name}* has been revoked and removed from WireGuard.`);
    } catch (err: any) {
        await ctx.react('❌');
        await ctx.reply(`❌ Failed to revoke peer:\n${err.message}`);
    }
};

const handleWgStatus: CommandHandler = async (ctx) => {
    await ctx.react('⏳');

    try {
        const status = await getInterfaceStatus();
        await ctx.react('✅');
        await ctx.reply(`🔒 *WireGuard Status*\n━━━━━━━━━━━━━━━━━━\n\`\`\`\n${status}\n\`\`\``);
    } catch (err: any) {
        await ctx.react('❌');
        await ctx.reply(`❌ Failed to get WG status:\n${err.message}`);
    }
};

export function createWireGuardModule(): ModuleRegistration {
    const commands = new Map<string, CommandHandler>();
    commands.set('wg', handleWg);

    return {
        name: 'WireGuard',
        commands,
        description: 'WireGuard VPN management',
    };
}

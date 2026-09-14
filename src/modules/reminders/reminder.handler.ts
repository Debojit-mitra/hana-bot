import { ReminderModel } from '../../db/models/Reminder.js';
import { scheduleReminderJob, stopReminderJob } from './reminder.scheduler.js';
import type { CommandContext, ModuleRegistration } from '../../types/index.js';

function parseManualTime(timeStr: string): { cron: string, isOneOff: boolean, expiresAt?: Date } | null {
    // Check if it's a raw 5-part cron expression
    const parts = timeStr.split(' ');
    if (parts.length === 5) {
        return { cron: timeStr, isOneOff: false };
    }

    // Try parsing shorthand (e.g., 5m, 2h, 1d) as a one-off reminder in the future
    const match = timeStr.match(/^(\d+)([mhd])$/i);
    if (match) {
        const val = parseInt(match[1], 10);
        const unit = match[2].toLowerCase();
        
        const date = new Date();
        if (unit === 'm') date.setMinutes(date.getMinutes() + val);
        else if (unit === 'h') date.setHours(date.getHours() + val);
        else if (unit === 'd') date.setDate(date.getDate() + val);

        // Convert precise date to a specific one-off cron expression
        const cron = `${date.getMinutes()} ${date.getHours()} ${date.getDate()} ${date.getMonth() + 1} *`;
        return { cron, isOneOff: true, expiresAt: date };
    }

    return null;
}

export function createRemindersModule(): ModuleRegistration {
    const commands = new Map();

    commands.set('remind', async (ctx: CommandContext) => {
        if (ctx.args.length < 2) {
            await ctx.reply('❌ Usage: `!remind <time> <message>`\nTime can be shorthand (5m, 2h, 1d) or a cron expression ("0 */2 * * *")');
            return;
        }

        // Handle multi-part cron by grouping the first 5 args if they look like a cron
        let timeStr = ctx.args[0];
        let messageIdx = 1;
        
        if (ctx.args.length >= 6 && ctx.args.slice(0, 5).join(' ').match(/^[\*\d,\-\/]+ [\*\d,\-\/]+ [\*\d,\-\/]+ [\*\d,\-\/]+ [\*\d,\-\/]+$/)) {
            timeStr = ctx.args.slice(0, 5).join(' ');
            messageIdx = 5;
        }

        const parsed = parseManualTime(timeStr);
        if (!parsed) {
            await ctx.reply('❌ Invalid time format. Use something like `5m`, `2h`, `1d` or a valid 5-part cron expression.');
            return;
        }

        const content = ctx.args.slice(messageIdx).join(' ');
        
        try {
            const reminder = new ReminderModel({
                chatId: ctx.jid,
                creatorJid: ctx.sender,
                targetJids: [ctx.sender], // default tag the creator
                content,
                cronExpression: parsed.cron,
                isOneOff: parsed.isOneOff,
                expiresAt: parsed.expiresAt
            });

            await reminder.save();
            scheduleReminderJob(reminder);

            await ctx.reply(`✅ Reminder set! ID: \`${reminder.id}\`\nIt will run on schedule: \`${parsed.cron}\``);
        } catch (err: any) {
            await ctx.reply(`❌ Failed to set reminder: ${err.message}`);
        }
    });

    commands.set('reminders', async (ctx: CommandContext) => {
        const reminders = await ReminderModel.find({ chatId: ctx.jid });
        if (reminders.length === 0) {
            await ctx.reply('No active reminders in this chat.');
            return;
        }

        const lines = reminders.map(r => {
            let info = `\`${r.id}\`: ${r.content} (${r.cronExpression})`;
            if (r.isOneOff) info += ' [One-off]';
            if (r.expiresAt) info += ` [Expires: ${r.expiresAt.toLocaleString()}]`;
            return info;
        });

        await ctx.reply(`*Active Reminders:*\n\n${lines.join('\n')}`);
    });

    commands.set('delremind', async (ctx: CommandContext) => {
        if (ctx.args.length < 1) {
            await ctx.reply('❌ Usage: `!delremind <id>`');
            return;
        }

        const id = ctx.args[0];
        const reminder = await ReminderModel.findOne({ _id: id, chatId: ctx.jid });
        
        if (!reminder) {
            await ctx.reply('❌ Reminder not found or does not belong to this chat.');
            return;
        }

        // Only creator or admin should delete ideally, but for now we allow anyone in chat to delete chat reminders
        // Or we restrict to creator:
        if (reminder.creatorJid !== ctx.sender) {
            // Check if admin... for simplicity, let's just let the creator delete it
            // (In a full prod system we'd use `isAdmin(ctx.sender)` too)
            await ctx.reply('❌ Only the creator of the reminder can delete it.');
            return;
        }

        await ReminderModel.findByIdAndDelete(id);
        stopReminderJob(id);

        await ctx.reply('✅ Reminder deleted.');
    });

    return {
        name: 'Reminders',
        description: 'Set manual time-based reminders',
        commands
    };
}

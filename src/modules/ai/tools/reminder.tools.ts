import { ReminderModel } from '../../../db/models/Reminder.js';
import { scheduleReminderJob, stopReminderJob } from '../../reminders/reminder.scheduler.js';
import type { CommandContext } from '../../../types/index.js';

export const reminderTools = [
    {
        name: "create_reminder",
        description: "Create a reminder that will send a message at a specific time or on a repeating schedule. You MUST write the cronExpression yourself based on the user's request. Always confirm the time and timezone with the user in your message.",
        parameters: {
            type: "OBJECT",
            properties: {
                content: {
                    type: "STRING",
                    description: "The message to send when the reminder fires. Be friendly! DO NOT include any prefix like '⏰ REMINDER' or 'Reminder:' in your content string, as the system automatically adds the title.",
                },
                cronExpression: {
                    type: "STRING",
                    description: "A standard 5-part cron expression (minute hour day month dayOfWeek). E.g. '0 */2 * * *' for every 2 hours, or '30 14 * * *' for 2:30 PM daily.",
                },
                isOneOff: {
                    type: "BOOLEAN",
                    description: "Set to true if this is a one-time reminder that should be deleted after it fires (e.g. 'remind me in 5 minutes'). Set to false for repeating reminders.",
                },
                expiresAt: {
                    type: "STRING",
                    description: "Optional ISO date string for when this repeating reminder should automatically expire and be deleted (e.g. '2026-09-15T22:00:00Z'). Use only if the user specifies an end time for a repeating schedule.",
                },
                mentions: {
                    type: "ARRAY",
                    description: "Optional array of phone numbers (JIDs) to @mention when the reminder fires. Use this if the user asks to remind specific people in a group.",
                    items: {
                        type: "STRING",
                    },
                },
            },
            required: ["content", "cronExpression", "isOneOff"],
        },
        execute: async (args: any, ctx?: CommandContext) => {
            if (!ctx) return { error: "No context available" };

            try {
                // If the user wants to mention themselves, they don't explicitly pass their JID unless instructed,
                // but default behavior: if no mentions are passed, we mention the sender.
                let targetJids = args.mentions || [];
                if (targetJids.length === 0) {
                    targetJids = [ctx.sender];
                } else {
                    // Ensure proper JID formatting
                    targetJids = targetJids.map((j: string) => j.includes('@s.whatsapp.net') ? j : `${j.replace(/[^0-9]/g, '')}@s.whatsapp.net`);
                }

                const reminder = new ReminderModel({
                    chatId: ctx.jid,
                    creatorJid: ctx.sender,
                    targetJids,
                    content: args.content,
                    cronExpression: args.cronExpression,
                    isOneOff: args.isOneOff,
                    expiresAt: args.expiresAt ? new Date(args.expiresAt) : undefined
                });

                await reminder.save();
                scheduleReminderJob(reminder);

                return { 
                    result: `Reminder successfully scheduled!`, 
                    id: reminder.id,
                    cron: args.cronExpression,
                    expiresAt: args.expiresAt || null
                };
            } catch (err: any) {
                return { error: `Failed to create reminder: ${err.message}` };
            }
        },
    },
    {
        name: "list_reminders",
        description: "List all active reminders in the current chat. Use this if the user asks what reminders are set, or if they ask you to simulate/show exactly what a reminder message will look like. If simulating a message, make sure to append the target JIDs at the bottom (e.g. '@919864729098') so they render as WhatsApp tags.",
        parameters: {
            type: "OBJECT",
            properties: {},
        },
        execute: async (args: any, ctx?: CommandContext) => {
            if (!ctx) return { error: "No context available" };

            const reminders = await ReminderModel.find({ chatId: ctx.jid });
            if (reminders.length === 0) {
                return { result: "No active reminders in this chat." };
            }

            return {
                reminders: reminders.map(r => ({
                    id: r.id,
                    content: r.content,
                    cronExpression: r.cronExpression,
                    isOneOff: r.isOneOff,
                    expiresAt: r.expiresAt,
                    targets: r.targetJids
                }))
            };
        },
    },
    {
        name: "delete_reminder",
        description: "Delete a reminder by its ID. Use list_reminders first to find the correct ID if the user asks you to cancel a reminder.",
        parameters: {
            type: "OBJECT",
            properties: {
                id: {
                    type: "STRING",
                    description: "The database ID of the reminder to delete.",
                }
            },
            required: ["id"],
        },
        execute: async (args: any, ctx?: CommandContext) => {
            if (!ctx) return { error: "No context available" };

            const reminder = await ReminderModel.findOne({ _id: args.id, chatId: ctx.jid });
            if (!reminder) {
                return { error: "Reminder not found in this chat." };
            }

            await ReminderModel.findByIdAndDelete(args.id);
            stopReminderJob(args.id);

            return { result: `Reminder ${args.id} deleted successfully.` };
        },
    }
];

import { schedule as cronSchedule, type ScheduledTask } from 'node-cron';
import type { WASocket, AnyMessageContent } from '@whiskeysockets/baileys';
import { ReminderModel, type IReminder } from '../../db/models/Reminder.js';
import { getEnvConfig } from '../../config/env.js';
import logger from '../../utils/logger.js';

let socketRef: WASocket | null = null;
const activeJobs = new Map<string, ScheduledTask>();

/**
 * Start the reminder scheduler.
 */
export async function startReminderScheduler(sock: WASocket): Promise<void> {
    socketRef = sock;
    
    try {
        const reminders = await ReminderModel.find();
        
        // Clear any existing jobs just in case
        for (const job of activeJobs.values()) {
            job.stop();
        }
        activeJobs.clear();

        for (const reminder of reminders) {
            scheduleReminderJob(reminder);
        }
        
        logger.info(`Loaded ${reminders.length} active reminders`);
    } catch (err) {
        logger.error({ err }, 'Failed to start reminder scheduler');
    }
}

/**
 * Schedule a single reminder job.
 */
export function scheduleReminderJob(reminder: IReminder): void {
    const config = getEnvConfig();
    const timezone = config.timezone;
    
    // Stop existing job if updating
    if (activeJobs.has(reminder.id)) {
        activeJobs.get(reminder.id)?.stop();
        activeJobs.delete(reminder.id);
    }

    try {
        const job = cronSchedule(reminder.cronExpression, async () => {
            await executeReminder(reminder.id);
        }, {
            timezone
        });
        
        activeJobs.set(reminder.id, job);
    } catch (err) {
        logger.error({ err, reminderId: reminder.id, cron: reminder.cronExpression }, 'Failed to schedule reminder (invalid cron?)');
    }
}

/**
 * Stop a scheduled reminder job.
 */
export function stopReminderJob(id: string): void {
    if (activeJobs.has(id)) {
        activeJobs.get(id)?.stop();
        activeJobs.delete(id);
    }
}

/**
 * Execute the reminder when the cron fires.
 */
async function executeReminder(id: string): Promise<void> {
    if (!socketRef) return;

    try {
        const reminder = await ReminderModel.findById(id);
        if (!reminder) {
            stopReminderJob(id);
            return;
        }

        const now = new Date();

        // Check if one-off or expired
        let shouldDelete = reminder.isOneOff;
        if (reminder.expiresAt && now >= reminder.expiresAt) {
            shouldDelete = true;
        }

        // If it's expired and not a one-off that just fired, don't send message, just delete
        if (reminder.expiresAt && now > reminder.expiresAt && !reminder.isOneOff) {
            await ReminderModel.findByIdAndDelete(id);
            stopReminderJob(id);
            return;
        }

        // Prepare message content with mentions
        let text = `⏰ *REMINDER*\n\n${reminder.content}`;
        const mentions = reminder.targetJids || [];
        
        // If there are mentions, append them nicely at the bottom
        if (mentions.length > 0) {
            const mentionsText = mentions.map(j => `@${j.split('@')[0]}`).join(' ');
            text += `\n\n${mentionsText}`;
        }

        const messageContent: AnyMessageContent = { 
            text,
            mentions: mentions.length > 0 ? mentions : undefined
        };

        await socketRef.sendMessage(reminder.chatId, messageContent);

        if (shouldDelete) {
            await ReminderModel.findByIdAndDelete(id);
            stopReminderJob(id);
        }

    } catch (err) {
        logger.error({ err, reminderId: id }, 'Error executing reminder');
    }
}

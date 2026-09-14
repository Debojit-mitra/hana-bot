import mongoose, { Document, Schema } from 'mongoose';

export interface IReminder extends Document {
    id: string;
    chatId: string;
    creatorJid: string;
    targetJids: string[];
    content: string;
    cronExpression: string;
    isOneOff: boolean;
    expiresAt?: Date;
    createdAt: Date;
}

const ReminderSchema = new Schema<IReminder>({
    chatId: { type: String, required: true },
    creatorJid: { type: String, required: true },
    targetJids: { type: [String], default: [] },
    content: { type: String, required: true },
    cronExpression: { type: String, required: true },
    isOneOff: { type: Boolean, default: false },
    expiresAt: { type: Date },
    createdAt: { type: Date, default: Date.now },
});

export const ReminderModel = mongoose.model<IReminder>('Reminder', ReminderSchema);

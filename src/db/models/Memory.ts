import mongoose, { Schema, Document } from 'mongoose';

export interface IMemoryDoc extends Document {
    userJid: string;       // sender JID for user memories, or "global" for shared memories
    content: string;       // the memory text (concise factual statement)
    category: string;      // 'preference' | 'fact' | 'instruction' | 'general'
    source: string;        // 'explicit' (user asked) | 'auto' (AI decided)
    createdAt: Date;
    updatedAt: Date;
}

const MemorySchema = new Schema<IMemoryDoc>({
    userJid: { type: String, required: true, index: true },
    content: { type: String, required: true },
    category: { type: String, default: 'general' },
    source: { type: String, default: 'explicit', enum: ['explicit', 'auto'] },
}, {
    timestamps: true
});

// Compound index for efficient queries: fetch all memories for a user
MemorySchema.index({ userJid: 1, createdAt: -1 });

export const MemoryModel = mongoose.model<IMemoryDoc>('Memory', MemorySchema);

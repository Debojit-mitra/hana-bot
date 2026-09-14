import mongoose, { Schema, Document } from 'mongoose';
import { getEnvConfig } from '../../config/env.js';

export interface IAIChatDoc extends Document {
    sessionId: string;
    messages: any[];
    updatedAt: Date;
}

const AIChatSchema = new Schema<IAIChatDoc>({
    sessionId: { type: String, required: true, unique: true, index: true },
    messages: { type: Schema.Types.Mixed, required: true, default: [] },
}, {
    timestamps: true // Automatically manages createdAt and updatedAt
});

// We create an index on updatedAt with expireAfterSeconds.
// The value of expireAfterSeconds will be dynamically configured, but Mongoose
// schema indexes are usually static. We can use a trick to read it from config.
// However, a simpler approach is to set it to a large default and manage it in code,
// or just use the config value at startup time.
// For dynamic TTL, it's better to update the index manually if it changes, 
// but here we will create it once using the config's default.

let ttlSeconds = 3 * 24 * 60 * 60; // default 3 days
try {
    const config = getEnvConfig();
    if (config?.ai?.historyExpirationDays) {
        ttlSeconds = config.ai.historyExpirationDays * 24 * 60 * 60;
    }
} catch (err) {
    // config might not be fully loaded yet during import, that's okay.
}

AIChatSchema.index({ updatedAt: 1 }, { expireAfterSeconds: ttlSeconds });

export const AIChatModel = mongoose.model<IAIChatDoc>('AIChat', AIChatSchema);

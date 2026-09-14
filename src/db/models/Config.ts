import mongoose, { Schema, Document } from 'mongoose';
import type { BotConfig } from '../../types/index.js';

export interface IConfigDoc extends Document {
    config: BotConfig;
}

const ConfigSchema = new Schema<IConfigDoc>({
    config: { type: Schema.Types.Mixed, required: true },
});

export const ConfigModel = mongoose.model<IConfigDoc>('Config', ConfigSchema);

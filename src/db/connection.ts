import mongoose from 'mongoose';
import logger from '../utils/logger.js';

export async function connectDB(): Promise<void> {
    const uri = process.env.MONGO_URI;
    if (!uri) {
        logger.error('MONGO_URI is not defined in .env');
        process.exit(1);
    }

    try {
        await mongoose.connect(uri);
        logger.info('📦 Connected to MongoDB');
    } catch (err) {
        logger.error({ err }, 'Failed to connect to MongoDB');
        process.exit(1);
    }
}

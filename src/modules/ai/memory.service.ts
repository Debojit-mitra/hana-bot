import { MemoryModel, type IMemoryDoc } from '../../db/models/Memory.js';
import { getEnvConfig } from '../../config/env.js';
import logger from '../../utils/logger.js';

const GLOBAL_KEY = 'global';

/**
 * Get all memories for a user + all global memories, formatted for system prompt injection.
 */
export async function getMemoriesForPrompt(userJid: string): Promise<string> {
    const [userMemories, globalMemories] = await Promise.all([
        MemoryModel.find({ userJid }).sort({ createdAt: -1 }).lean(),
        MemoryModel.find({ userJid: GLOBAL_KEY }).sort({ createdAt: -1 }).lean(),
    ]);

    if (userMemories.length === 0 && globalMemories.length === 0) {
        return '';
    }

    const lines: string[] = ['## Things you remember'];

    if (userMemories.length > 0) {
        lines.push('### About this user:');
        for (const m of userMemories) {
            lines.push(`- ${m.content}`);
        }
    }

    if (globalMemories.length > 0) {
        lines.push('### General knowledge:');
        for (const m of globalMemories) {
            lines.push(`- ${m.content}`);
        }
    }

    return lines.join('\n');
}

/**
 * Save a memory. Performs a basic dedup check before saving.
 * Returns the saved memory or null if it was a duplicate.
 */
export async function saveMemory(
    userJid: string,
    content: string,
    category: string = 'general',
    source: 'explicit' | 'auto' = 'explicit',
    isGlobal: boolean = false,
): Promise<IMemoryDoc | null> {
    const key = isGlobal ? GLOBAL_KEY : userJid;
    const envConfig = getEnvConfig();
    const maxMemories = envConfig.ai.memoryMaxPerUser || 50;

    // Dedup: check if a very similar memory already exists
    const existing = await MemoryModel.find({ userJid: key }).lean();

    const contentLower = content.toLowerCase().trim();
    const isDuplicate = existing.some(m => {
        const existingLower = m.content.toLowerCase().trim();
        // Exact match or one is a substring of the other
        return existingLower === contentLower ||
               existingLower.includes(contentLower) ||
               contentLower.includes(existingLower);
    });

    if (isDuplicate) {
        logger.debug({ key, content }, 'Duplicate memory, skipping save');
        return null;
    }

    // Check memory cap
    if (existing.length >= maxMemories) {
        logger.warn({ key, count: existing.length, max: maxMemories }, 'Memory cap reached');
        throw new Error(`Memory limit reached (${maxMemories}). Delete some old memories first.`);
    }

    const memory = await MemoryModel.create({
        userJid: key,
        content: content.trim(),
        category,
        source,
    });

    logger.info({ key, content: content.trim(), category, source }, 'Memory saved');
    return memory;
}

/**
 * List all memories for a user (personal + global).
 */
export async function listMemories(userJid: string): Promise<{ user: IMemoryDoc[]; global: IMemoryDoc[] }> {
    const [userMemories, globalMemories] = await Promise.all([
        MemoryModel.find({ userJid }).sort({ createdAt: -1 }).lean() as Promise<IMemoryDoc[]>,
        MemoryModel.find({ userJid: GLOBAL_KEY }).sort({ createdAt: -1 }).lean() as Promise<IMemoryDoc[]>,
    ]);

    return { user: userMemories, global: globalMemories };
}

/**
 * Delete a memory by matching content (case-insensitive substring match).
 * Returns the number of deleted documents.
 */
export async function deleteMemoryByContent(
    userJid: string,
    searchText: string,
    isGlobal: boolean = false,
): Promise<number> {
    const key = isGlobal ? GLOBAL_KEY : userJid;
    const searchLower = searchText.toLowerCase().trim();

    // Find matching memories
    const candidates = await MemoryModel.find({ userJid: key }).lean();
    const toDelete = candidates.filter(m =>
        m.content.toLowerCase().includes(searchLower)
    );

    if (toDelete.length === 0) {
        return 0;
    }

    const ids = toDelete.map(m => m._id);
    const result = await MemoryModel.deleteMany({ _id: { $in: ids } });

    logger.info({ key, searchText, deleted: result.deletedCount }, 'Memories deleted by content');
    return result.deletedCount;
}

/**
 * Clear all personal memories for a user.
 */
export async function clearUserMemories(userJid: string): Promise<number> {
    const result = await MemoryModel.deleteMany({ userJid });
    logger.info({ userJid, deleted: result.deletedCount }, 'User memories cleared');
    return result.deletedCount;
}

/**
 * Clear all global memories.
 */
export async function clearGlobalMemories(): Promise<number> {
    const result = await MemoryModel.deleteMany({ userJid: GLOBAL_KEY });
    logger.info({ deleted: result.deletedCount }, 'Global memories cleared');
    return result.deletedCount;
}

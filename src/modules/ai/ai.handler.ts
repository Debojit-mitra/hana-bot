import { getAIProvider } from './ai.provider.js';
import { getConfig } from '../../config/config.js';
import { getAlias } from '../../core/auth.js';
import { AIChatModel } from '../../db/models/AIChat.js';
import { clearUserMemories } from './memory.service.js';
import type { CommandHandler, ModuleRegistration } from '../../types/index.js';

const handleAi: CommandHandler = async (ctx) => {
    let question = ctx.command === 'hana'
        ? ctx.args.join(' ')
        : ctx.rawMessage; // fallback from non-command messages

    if (question) {
        // Resolve @mentions to their aliases so the AI understands who is being talked about
        // WhatsApp sometimes uses internal LIDs (e.g. @280774...) in the text instead of the actual phone number.
        // We use the mentionedJid array + Baileys' LID mapping to reliably resolve them.
        const mentionedJids: string[] = ctx.rawMsg?.message?.extendedTextMessage?.contextInfo?.mentionedJid || [];
        let mentionIndex = 0;

        const matches = [...question.matchAll(/@(\d+)/g)];
        
        for (const match of matches) {
            const rawNumber = match[1];
            const fullMatch = match[0];
            
            // Try direct lookup first
            let alias = getAlias(`${rawNumber}@s.whatsapp.net`);

            // If not found, use the corresponding JID from the mentionedJid array
            if (!alias && mentionIndex < mentionedJids.length) {
                let actualJid = mentionedJids[mentionIndex];
                
                // If the JID is a LID, attempt to resolve it to a phone number using the socket
                if (actualJid.endsWith('@lid') && ctx.sock?.signalRepository?.lidMapping?.getPNForLID) {
                    try {
                        const resolvedPn = await ctx.sock.signalRepository.lidMapping.getPNForLID(actualJid);
                        if (resolvedPn) {
                            actualJid = `${resolvedPn.split('@')[0]}@s.whatsapp.net`;
                        }
                    } catch {
                        // ignore
                    }
                }
                
                alias = getAlias(actualJid);
            }
            
            if (alias) {
                question = question.replace(fullMatch, `@${alias}`);
            }
            
            mentionIndex++;
        }
    }

    if (!question || question.trim().length === 0) {
        await ctx.reply('Usage: `!hana <question>`\nExample: `!hana how do I check disk space on linux?`\n\nOther commands:\n`!hana clear` - Wipe your AI conversation history\n`!hana clear memories` - Wipe your saved memories\n`!hana clear all` - Wipe both history and memories');
        return;
    }

    const trimmedQ = question.trim().toLowerCase();

    if (trimmedQ === 'clear' || trimmedQ === 'clear history') {
        await ctx.react('⏳');
        await AIChatModel.deleteOne({ sessionId: ctx.jid });
        await ctx.react('✅');
        await ctx.reply('🧹 Your AI conversation history has been cleared! We are starting fresh.');
        return;
    }

    if (trimmedQ === 'clear memories') {
        await ctx.react('⏳');
        const deleted = await clearUserMemories(ctx.sender);
        await ctx.react('✅');
        await ctx.reply(`🧹 Cleared ${deleted} personal memory/memories. Your global memories are untouched.`);
        return;
    }

    if (trimmedQ === 'clear all') {
        await ctx.react('⏳');
        await AIChatModel.deleteOne({ sessionId: ctx.jid });
        const deleted = await clearUserMemories(ctx.sender);
        await ctx.react('✅');
        await ctx.reply(`🧹 All cleared! Wiped conversation history and ${deleted} personal memory/memories.`);
        return;
    }

    await ctx.react('🤔');

    const config = getConfig();
    let role = 'User';
    if (ctx.sender === config.ownerJid) {
        role = 'Owner';
    } else if (config.admins.includes(ctx.sender)) {
        role = 'Admin';
    } else if (config.whitelist.includes(ctx.sender)) {
        role = 'Whitelisted User';
    }

    let finalQuestion = `[Sender: ${ctx.pushName} (Role: ${role}) - JID: ${ctx.sender}]\n`;

    if (ctx.quotedMessage) {
        finalQuestion += `[The user is replying to the following message:\n"${ctx.quotedMessage}"]\n\n`;
    }
    
    finalQuestion += `Question/Reply: ${question}`;

    const provider = getAIProvider();
    const answer = await provider.ask(finalQuestion, undefined, ctx.jid, ctx);

    await ctx.react('');
    if (answer && answer.trim().length > 0) {
        await ctx.reply(answer);
    }
};

export function createAIModule(): ModuleRegistration {
    const commands = new Map<string, CommandHandler>();
    commands.set('hana', handleAi);

    return {
        name: 'AI',
        commands,
        description: 'AI-powered Q&A',
    };
}

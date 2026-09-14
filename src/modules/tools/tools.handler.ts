import type { CommandHandler, ModuleRegistration } from '../../types/index.js';
import { handleRmExif, processExifRemoval } from './rmexif.tool.js';
import { handleConvert, processImageConversion } from './convert.tool.js';
import { getConfig } from '../../config/config.js';

export { processExifRemoval, processImageConversion };

export const handleToolsHelp: CommandHandler = async (ctx) => {
    const config = getConfig();
    const prefix = config.commandPrefix;

    const menu = [
        '🧰 *Utility Tools*',
        '━━━━━━━━━━━━━━━━━━',
        `  \`${prefix}rmexif\` — Strip EXIF metadata from an image/video`,
        `  \`${prefix}convert <format>\` — Convert an image to png, webp, jpg, avif, etc.`,
        '━━━━━━━━━━━━━━━━━━',
        '💡 *Tip:* Reply to an image or document with these commands to use them.',
    ].join('\n');

    await ctx.reply(menu);
};

export function createToolsModule(): ModuleRegistration {
    const commands = new Map<string, CommandHandler>();
    commands.set('tools', handleToolsHelp);
    commands.set('rmexif', handleRmExif);
    commands.set('convert', handleConvert);

    return {
        name: 'Tools',
        commands,
        description: 'Utility tools',
    };
}

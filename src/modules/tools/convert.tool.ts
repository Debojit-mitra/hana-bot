import fs from 'fs';
import path from 'path';
import os from 'os';
import { randomBytes } from 'crypto';
import { downloadContentFromMessage } from '@whiskeysockets/baileys';
import sharp from 'sharp';
import { pipeline } from 'stream/promises';
import { exec } from 'child_process';
import { promisify } from 'util';
import type { CommandContext, CommandHandler } from '../../types/index.js';
import logger from '../../utils/logger.js';

const execAsync = promisify(exec);
const MAX_IMAGE_SIZE = 20 * 1024 * 1024; // 20 MB

export interface ConvertOptions {
    targetFormat: string;
    width?: number;
    height?: number;
    quality?: number;
    scale?: number;
}

export const handleConvert: CommandHandler = async (ctx) => {
    const targetFormat = ctx.args[0]?.toLowerCase();
    if (!targetFormat) {
        await ctx.reply('Usage: `!convert <format> [width=<w>] [height=<h>] [quality=<q>] [scale=<%>]`\nExample: `!convert webp scale=50 quality=80` or `!convert webp 50%`');
        return;
    }
    
    const opts: ConvertOptions = { targetFormat };
    for (const arg of ctx.args.slice(1)) {
        if (arg.startsWith('width=')) opts.width = parseInt(arg.split('=')[1], 10);
        if (arg.startsWith('height=')) opts.height = parseInt(arg.split('=')[1], 10);
        if (arg.startsWith('quality=')) opts.quality = parseInt(arg.split('=')[1], 10);
        if (arg.startsWith('scale=')) opts.scale = parseInt(arg.split('=')[1], 10);
        if (arg.endsWith('%')) {
            const val = parseInt(arg.replace('%', ''), 10);
            if (!isNaN(val)) opts.scale = val;
        }
        if (arg.includes('x') && !arg.includes('=')) {
            const [w, h] = arg.split('x');
            if (parseInt(w, 10)) opts.width = parseInt(w, 10);
            if (parseInt(h, 10)) opts.height = parseInt(h, 10);
        }
    }
    
    if (opts.scale !== undefined && (opts.width !== undefined || opts.height !== undefined)) {
        await ctx.reply('❌ You cannot specify both a scale percentage and explicit width/height dimensions. Please use one or the other.');
        return;
    }
    
    await processImageConversion(ctx, opts);
};

export const processImageConversion = async (ctx: CommandContext, opts: ConvertOptions): Promise<boolean> => {
    try {
        const supportedFormats = ['jpeg', 'jpg', 'png', 'webp', 'avif', 'tiff', 'gif'];
        if (!supportedFormats.includes(opts.targetFormat)) {
            await ctx.reply(`❌ Unsupported target format. Supported formats: ${supportedFormats.join(', ')}`);
            return false;
        }

        const msg = ctx.rawMsg;
        let mediaMessage: any = null;
        let originalMimetype = '';
        let fileSize = 0;

        if (msg.message?.imageMessage) {
            mediaMessage = msg.message.imageMessage;
        } else if (msg.message?.documentMessage && msg.message.documentMessage.mimetype?.startsWith('image/')) {
            mediaMessage = msg.message.documentMessage;
        } else if (msg.message?.documentWithCaptionMessage?.message?.documentMessage && msg.message.documentWithCaptionMessage.message.documentMessage.mimetype?.startsWith('image/')) {
            mediaMessage = msg.message.documentWithCaptionMessage.message.documentMessage;
        } else if (msg.message?.extendedTextMessage?.contextInfo?.quotedMessage) {
            const quoted = msg.message.extendedTextMessage.contextInfo.quotedMessage;
            if (quoted.imageMessage) {
                mediaMessage = quoted.imageMessage;
            } else if (quoted.documentMessage && quoted.documentMessage.mimetype?.startsWith('image/')) {
                mediaMessage = quoted.documentMessage;
            }
        }

        if (!mediaMessage) {
            await ctx.reply('Please reply to an image with this command.');
            return false;
        }

        fileSize = typeof mediaMessage.fileLength === 'number' ? mediaMessage.fileLength : 
                  (mediaMessage.fileLength?.low ? mediaMessage.fileLength.low : 0);

        if (fileSize > MAX_IMAGE_SIZE) {
            await ctx.reply(`❌ Image is too large! Maximum allowed size is 20MB.`);
            return false;
        }

        await ctx.react('⏳');

        originalMimetype = mediaMessage.mimetype || 'image/jpeg';
        const tempId = randomBytes(8).toString('hex');
        
        // Output format mapping
        const outExt = opts.targetFormat === 'jpeg' ? 'jpg' : opts.targetFormat;
        const outMime = `image/${opts.targetFormat === 'jpg' ? 'jpeg' : opts.targetFormat}`;
        
        let fileName = '';
        if (msg.message?.documentMessage?.fileName) fileName = msg.message.documentMessage.fileName;
        else if (msg.message?.extendedTextMessage?.contextInfo?.quotedMessage?.documentMessage?.fileName) {
            fileName = msg.message.extendedTextMessage.contextInfo.quotedMessage.documentMessage.fileName;
        }

        const fileExt = fileName.includes('.') ? fileName.split('.').pop()?.toLowerCase() : null;
        const ext = fileExt || originalMimetype.split('/')[1]?.split(';')[0] || 'bin';
        
        const inputPath = path.join(os.tmpdir(), `hana_convert_in_${tempId}.${ext}`);
        const outputPath = path.join(os.tmpdir(), `hana_convert_out_${tempId}.${outExt}`);
        const midPath = path.join(os.tmpdir(), `hana_convert_mid_${tempId}.png`);

        const isDocument = mediaMessage === msg.message?.documentMessage || 
                           mediaMessage === msg.message?.documentWithCaptionMessage?.message?.documentMessage ||
                           mediaMessage === msg.message?.extendedTextMessage?.contextInfo?.quotedMessage?.documentMessage;
                           
        const stream = await downloadContentFromMessage(mediaMessage, isDocument ? 'document' : 'image');
        await pipeline(stream, fs.createWriteStream(inputPath));

        let finalInputPath = inputPath;

        // Use ffmpeg for HEIC/HEIF to decode to PNG first, as sharp prebuilts lack HEVC support
        if (ext === 'heic' || ext === 'heif' || originalMimetype.includes('heic') || originalMimetype.includes('heif')) {
            await execAsync(`ffmpeg -y -i ${inputPath} -vframes 1 ${midPath}`);
            finalInputPath = midPath;
        }

        if (opts.scale && opts.scale > 0) {
            const meta = await sharp(finalInputPath).metadata();
            if (meta.width && meta.height) {
                opts.width = Math.round(meta.width * (opts.scale / 100));
                opts.height = Math.round(meta.height * (opts.scale / 100));
            }
        }

        // Run sharp conversion
        let s = sharp(finalInputPath, { sequentialRead: false });
        
        if (opts.width || opts.height) {
            s = s.resize(opts.width || null, opts.height || null, { fit: 'inside', withoutEnlargement: true });
        }
        
        let formatOpts: any = {};
        if (opts.quality && opts.quality >= 1 && opts.quality <= 100) {
            formatOpts.quality = opts.quality;
        }
        
        await s.toFormat(opts.targetFormat as any, formatOpts).toFile(outputPath);

        // Send converted file
        const baseName = fileName ? (fileName.substring(0, fileName.lastIndexOf('.')) || fileName) : 'image';
        const outFilename = `${baseName}_converted_${Date.now()}.${outExt}`;
        await ctx.replyWithFile({ url: outputPath }, outFilename, outMime, `✅ Successfully converted to ${opts.targetFormat.toUpperCase()}`);
        await ctx.react('✅');

        // Cleanup
        setTimeout(() => {
            if (fs.existsSync(inputPath)) fs.unlinkSync(inputPath);
            if (fs.existsSync(midPath)) fs.unlinkSync(midPath);
            if (fs.existsSync(outputPath)) fs.unlinkSync(outputPath);
        }, 10000);

        return true;

    } catch (err: any) {
        logger.error({ err }, 'convert handler error');
        await ctx.react('❌');
        await ctx.reply(`Error: ${err.message || 'Failed to convert image.'}`);
        throw err;
    }
};

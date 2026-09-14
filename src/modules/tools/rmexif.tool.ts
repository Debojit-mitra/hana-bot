import fs from 'fs';
import path from 'path';
import os from 'os';
import { randomBytes } from 'crypto';
import { downloadContentFromMessage } from '@whiskeysockets/baileys';
import { exiftool } from 'exiftool-vendored';
import type { CommandHandler } from '../../types/index.js';
import logger from '../../utils/logger.js';

const MAX_IMAGE_SIZE = 20 * 1024 * 1024; // 20 MB
const MAX_VIDEO_SIZE = 100 * 1024 * 1024; // 100 MB

export const handleRmExif: CommandHandler = async (ctx) => {
    await processExifRemoval(ctx);
};

export const processExifRemoval = async (ctx: any): Promise<boolean> => {
    try {
        const msg = ctx.rawMsg;
        let mediaMessage: any = null;
        let mediaType: 'image' | 'video' | 'document' | null = null;
        let originalMimetype = '';
        let fileSize = 0;

        // Check if the command itself has media
        if (msg.message?.imageMessage) {
            mediaMessage = msg.message.imageMessage;
            mediaType = 'image';
        } else if (msg.message?.videoMessage) {
            mediaMessage = msg.message.videoMessage;
            mediaType = 'video';
        } else if (msg.message?.documentMessage) {
            mediaMessage = msg.message.documentMessage;
            mediaType = 'document';
        } else if (msg.message?.documentWithCaptionMessage?.message?.documentMessage) {
            mediaMessage = msg.message.documentWithCaptionMessage.message.documentMessage;
            mediaType = 'document';
        } 
        // Check if it's replying to a media message
        else if (msg.message?.extendedTextMessage?.contextInfo?.quotedMessage) {
            const quoted = msg.message.extendedTextMessage.contextInfo.quotedMessage;
            if (quoted.imageMessage) {
                mediaMessage = quoted.imageMessage;
                mediaType = 'image';
            } else if (quoted.videoMessage) {
                mediaMessage = quoted.videoMessage;
                mediaType = 'video';
            } else if (quoted.documentMessage) {
                mediaMessage = quoted.documentMessage;
                mediaType = 'document';
            }
        }

        if (!mediaMessage || !mediaType) {
            await ctx.reply('Please send this command with an image/video, or reply to an image/video with `!rmexif`.');
            return false;
        }

        originalMimetype = mediaMessage.mimetype || 'application/octet-stream';
        fileSize = typeof mediaMessage.fileLength === 'number' ? mediaMessage.fileLength : 
                  (mediaMessage.fileLength?.low ? mediaMessage.fileLength.low : 0);

        if (mediaType === 'video' && fileSize > MAX_VIDEO_SIZE) {
            await ctx.reply(`❌ Video is too large! Maximum allowed size is 100MB.`);
            return false;
        }
        if ((mediaType === 'image' || mediaType === 'document') && fileSize > MAX_IMAGE_SIZE) {
            await ctx.reply(`❌ Image/Document is too large! Maximum allowed size is 20MB.`);
            return false;
        }

        await ctx.react('⏳');

        originalMimetype = mediaMessage.mimetype || 'application/octet-stream';
        
        let fileName = '';
        if (msg.message?.documentMessage?.fileName) fileName = msg.message.documentMessage.fileName;
        else if (msg.message?.extendedTextMessage?.contextInfo?.quotedMessage?.documentMessage?.fileName) {
            fileName = msg.message.extendedTextMessage.contextInfo.quotedMessage.documentMessage.fileName;
        }

        const fileExt = fileName.includes('.') ? fileName.split('.').pop()?.toLowerCase() : null;
        const ext = fileExt || originalMimetype.split('/')[1]?.split(';')[0] || 'bin';
        
        const tempId = randomBytes(8).toString('hex');
        const inputPath = path.join(os.tmpdir(), `hana_exif_in_${tempId}.${ext}`);

        // Download stream to disk
        const stream = await downloadContentFromMessage(mediaMessage, mediaType);
        const outStream = fs.createWriteStream(inputPath);
        
        for await (const chunk of stream) {
            outStream.write(chunk);
        }
        outStream.end();

        // Wait for write stream to close
        await new Promise((resolve) => outStream.on('finish', () => resolve(true)));

        // Remove EXIF data using exiftool
        try {
            await exiftool.deleteAllTags(inputPath);
        } catch (exifErr) {
            logger.error({ err: exifErr }, 'Exiftool failed');
            await ctx.reply('❌ Failed to strip EXIF data from this file. It might be corrupted or in an unsupported format.');
            fs.unlinkSync(inputPath);
            return false;
        }

        // Exiftool creates an "_original" backup file, the stripped file keeps the original name
        const backupPath = `${inputPath}_original`;

        // Send cleaned file back as a document
        const baseName = fileName ? (fileName.substring(0, fileName.lastIndexOf('.')) || fileName) : 'media';
        const outFilename = `${baseName}_cleaned_${Date.now()}.${ext}`;
        await ctx.replyWithFile({ url: inputPath }, outFilename, originalMimetype, '✅ EXIF metadata successfully removed.');
        await ctx.react('✅');

        // Cleanup temp files
        setTimeout(() => {
            if (fs.existsSync(inputPath)) fs.unlinkSync(inputPath);
            if (fs.existsSync(backupPath)) fs.unlinkSync(backupPath);
        }, 10000);

        return true;

    } catch (err: any) {
        logger.error({ err }, 'rmexif handler error');
        await ctx.react('❌');
        await ctx.reply(`Error: ${err.message}`);
        return false;
    }
};

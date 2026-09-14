import fs from 'fs/promises';
import path from 'path';
import os from 'os';
import { downloadMediaMessage, type WAMessage } from '@whiskeysockets/baileys';
import type { CommandHandler } from '../../types/index.js';
import { convertOfficeToPdf, compressPdf, convertImagesToPdf } from './docs.service.js';
import logger from '../../utils/logger.js';
import { randomUUID } from 'crypto';

export const OFFICE_MIMES = [
    'application/vnd.openxmlformats-officedocument.wordprocessingml.document', // docx
    'application/msword', // doc
    'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', // xlsx
    'application/vnd.ms-excel', // xls
    'application/vnd.openxmlformats-officedocument.presentationml.presentation', // pptx
    'application/vnd.ms-powerpoint', // ppt
    'application/vnd.oasis.opendocument.text' // odt
];

export const IMAGE_MIMES = ['image/jpeg', 'image/png', 'image/webp'];

async function cleanupFiles(files: string[]) {
    for (const file of files) {
        try {
            await fs.unlink(file);
        } catch (e) {
            // Ignore missing files
        }
    }
}

export function getQuotedMessage(msg: WAMessage): WAMessage | null {
    const contextInfo = msg.message?.extendedTextMessage?.contextInfo;
    if (!contextInfo?.quotedMessage) return null;
    return {
        key: {
            remoteJid: msg.key.remoteJid,
            id: contextInfo.stanzaId,
            participant: contextInfo.participant
        },
        message: contextInfo.quotedMessage
    } as WAMessage;
}

export const handleToPdf: CommandHandler = async (ctx) => {
    const msg = ctx.rawMsg;
    const quotedMsg = getQuotedMessage(msg);
    const targetMsg = quotedMsg || msg;

    // Check for document
    const docMessage = targetMsg.message?.documentMessage || targetMsg.message?.documentWithCaptionMessage?.message?.documentMessage;
    // Check for image
    const imgMessage = targetMsg.message?.imageMessage;

    if (!docMessage && !imgMessage) {
        await ctx.reply('❌ Please reply to a document (Word, Excel, PPT) or an Image with `!topdf`');
        return;
    }

    const mimeType = docMessage?.mimetype || imgMessage?.mimetype || '';
    
    // Validate mime type
    const isOffice = OFFICE_MIMES.includes(mimeType);
    const isImage = IMAGE_MIMES.includes(mimeType);
    const isAlreadyPdf = mimeType === 'application/pdf';

    if (isAlreadyPdf) {
        await ctx.reply('⚠️ This file is already a PDF.');
        return;
    }

    if (!isOffice && !isImage) {
        await ctx.reply(`❌ Unsupported file format for \`!topdf\`.\nSupported: Word, Excel, PPT, JPG, PNG`);
        return;
    }

    // Check size limit (e.g. 20MB max to prevent server OOM)
    const fileSize = docMessage?.fileLength || imgMessage?.fileLength || 0;
    const sizeInMB = Number(fileSize) / (1024 * 1024);
    if (sizeInMB > 20) {
        await ctx.reply(`❌ File too large (${sizeInMB.toFixed(1)}MB). Max size is 20MB to prevent server overload.`);
        return;
    }

    await ctx.react('⏳');
    
    const tmpDir = path.join(os.tmpdir(), `hana_topdf_${randomUUID()}`);
    await fs.mkdir(tmpDir, { recursive: true });
    
    // Download media
    let inputPath = '';
    let outputPath = '';

    try {
        const buffer = await downloadMediaMessage(targetMsg, 'buffer', {}, { 
            logger: logger as any,
            reuploadRequest: (msg) => new Promise((resolve) => resolve(msg))
        });
        
        let ext = '.bin';
        if (isImage) {
            ext = mimeType === 'image/png' ? '.png' : mimeType === 'image/webp' ? '.webp' : '.jpg';
        } else if (docMessage?.fileName) {
            ext = path.extname(docMessage.fileName);
        }

        inputPath = path.join(tmpDir, `input${ext}`);
        await fs.writeFile(inputPath, buffer as Buffer);

        let finalPdfPath = '';

        if (isImage) {
            outputPath = path.join(tmpDir, 'output.pdf');
            await convertImagesToPdf([inputPath], outputPath);
            finalPdfPath = outputPath;
        } else {
            // Office
            await ctx.reply('🔄 Converting document to PDF...\n_Note: This might take a few seconds._');
            finalPdfPath = await convertOfficeToPdf(inputPath, tmpDir);
        }

        const pdfBuffer = await fs.readFile(finalPdfPath);
        
        const originalName = docMessage?.fileName || 'image';
        const baseName = path.parse(originalName).name;

        await ctx.react('✅');
        await ctx.replyWithFile(pdfBuffer, `${baseName}.pdf`, 'application/pdf', `📄 Here is your converted PDF.`);

    } catch (err: any) {
        logger.error({ err }, 'Topdf failed');
        await ctx.react('❌');
        await ctx.reply(`❌ Conversion failed: ${err.message}`);
    } finally {
        // Cleanup temp dir
        try {
            await fs.rm(tmpDir, { recursive: true, force: true });
        } catch (e) {}
    }
};

export const handleCompressPdf: CommandHandler = async (ctx) => {
    const msg = ctx.rawMsg;
    const quotedMsg = getQuotedMessage(msg);
    const targetMsg = quotedMsg || msg;

    const docMessage = targetMsg.message?.documentMessage || targetMsg.message?.documentWithCaptionMessage?.message?.documentMessage;

    if (!docMessage || docMessage.mimetype !== 'application/pdf') {
        await ctx.reply('❌ Please reply to a *PDF document* with `!compresspdf [low|medium|high]`\nDefault is `low` (max compression).');
        return;
    }

    let level: 'low' | 'medium' | 'high' = 'low';
    const arg = ctx.args[0]?.toLowerCase();
    if (arg === 'medium' || arg === 'high' || arg === 'low') {
        level = arg;
    }

    // Check size limit (e.g. 50MB max for compression)
    const fileSize = docMessage?.fileLength || 0;
    const sizeInMB = Number(fileSize) / (1024 * 1024);
    if (sizeInMB > 50) {
        await ctx.reply(`❌ File too large (${sizeInMB.toFixed(1)}MB). Max size is 50MB.`);
        return;
    }

    await ctx.react('⏳');
    
    const tmpDir = path.join(os.tmpdir(), `hana_compress_${randomUUID()}`);
    await fs.mkdir(tmpDir, { recursive: true });
    
    try {
        const buffer = await downloadMediaMessage(targetMsg, 'buffer', {}, { 
            logger: logger as any,
            reuploadRequest: (msg) => new Promise((resolve) => resolve(msg))
        });
        
        const inputPath = path.join(tmpDir, `input.pdf`);
        const outputPath = path.join(tmpDir, `compressed.pdf`);
        
        await fs.writeFile(inputPath, buffer as Buffer);

        await ctx.reply(`🗜️ Compressing PDF (${level} quality)...`);
        
        await compressPdf(inputPath, outputPath, level);

        const compressedBuffer = await fs.readFile(outputPath);
        
        const originalName = docMessage.fileName || 'document.pdf';
        const oldSize = sizeInMB.toFixed(2);
        const newSize = (compressedBuffer.length / (1024 * 1024)).toFixed(2);
        
        await ctx.react('✅');
        await ctx.replyWithFile(
            compressedBuffer, 
            originalName, 
            'application/pdf', 
            `🗜️ *Compression Complete*\nOld Size: ${oldSize}MB\nNew Size: ${newSize}MB`
        );

    } catch (err: any) {
        logger.error({ err }, 'CompressPdf failed');
        await ctx.react('❌');
        await ctx.reply(`❌ Compression failed: ${err.message}`);
    } finally {
        try {
            await fs.rm(tmpDir, { recursive: true, force: true });
        } catch (e) {}
    }
};

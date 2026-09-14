import fs from "fs/promises";
import path from "path";
import os from "os";
import { downloadMediaMessage } from "@whiskeysockets/baileys";
import type { AITool } from "../ai.tools.js";
import {
  convertOfficeToPdf,
  compressPdf,
  convertImagesToPdf,
} from "../../tools/docs.service.js";
import {
  OFFICE_MIMES,
  IMAGE_MIMES,
  getQuotedMessage,
} from "../../tools/docs.tool.js";
import {
  startMediaSession,
  finishMediaSession,
  cancelMediaSession,
  cleanupMediaSession,
} from "../../../core/media-session.js";
import logger from "../../../utils/logger.js";
import { randomUUID } from "crypto";

export const docsTools: AITool[] = [
  {
    name: "convert_to_pdf",
    description:
      "Convert a Word, Excel, PPT, JPG, or PNG file to PDF. The user MUST reply to the document they want to convert. Do NOT use this tool if they haven't replied to a document.",
    parameters: { type: "OBJECT", properties: {} },
    execute: async (args: any, ctx: any) => {
      if (!ctx?.rawMsg) return { error: "No message context available." };

      const quotedMsg = getQuotedMessage(ctx.rawMsg);
      const targetMsg = quotedMsg || ctx.rawMsg;

      const docMessage =
        targetMsg.message?.documentMessage ||
        targetMsg.message?.documentWithCaptionMessage?.message?.documentMessage;
      const imgMessage = targetMsg.message?.imageMessage;

      if (!docMessage && !imgMessage) {
        return {
          error:
            "No document or image found. Please tell the user they must reply to the document or image they want to convert.",
        };
      }

      const mimeType = docMessage?.mimetype || imgMessage?.mimetype || "";
      const isOffice = OFFICE_MIMES.includes(mimeType);
      const isImage = IMAGE_MIMES.includes(mimeType);
      const isAlreadyPdf = mimeType === "application/pdf";

      if (isAlreadyPdf) return { error: "The file is already a PDF." };
      if (!isOffice && !isImage)
        return {
          error:
            "Unsupported file format. Supported: Word, Excel, PPT, JPG, PNG.",
        };

      const fileSize = docMessage?.fileLength || imgMessage?.fileLength || 0;
      const sizeInMB = Number(fileSize) / (1024 * 1024);
      if (sizeInMB > 20)
        return {
          error: `File too large (${sizeInMB.toFixed(1)}MB). Max size is 20MB.`,
        };

      const tmpDir = path.join(os.tmpdir(), `hana_ai_topdf_${randomUUID()}`);
      await fs.mkdir(tmpDir, { recursive: true });

      try {
        if (ctx.react) await ctx.react("⏳");

        const buffer = await downloadMediaMessage(
          targetMsg,
          "buffer",
          {},
          {
            logger: logger as any,
            reuploadRequest: (msg) => new Promise((resolve) => resolve(msg)),
          },
        );

        let ext = ".bin";
        if (isImage) {
          ext =
            mimeType === "image/png"
              ? ".png"
              : mimeType === "image/webp"
                ? ".webp"
                : ".jpg";
        } else if (docMessage?.fileName) {
          ext = path.extname(docMessage.fileName);
        }

        const inputPath = path.join(tmpDir, `input${ext}`);
        await fs.writeFile(inputPath, buffer as Buffer);

        let finalPdfPath = "";
        if (isImage) {
          const outputPath = path.join(tmpDir, "output.pdf");
          await convertImagesToPdf([inputPath], outputPath);
          finalPdfPath = outputPath;
        } else {
          finalPdfPath = await convertOfficeToPdf(inputPath, tmpDir);
        }

        const pdfBuffer = await fs.readFile(finalPdfPath);
        const originalName = docMessage?.fileName || "image";
        const baseName = path.parse(originalName).name;

        if (ctx.replyWithFile) {
          await ctx.replyWithFile(
            pdfBuffer,
            `${baseName}.pdf`,
            "application/pdf",
          );
        }

        if (ctx.react) await ctx.react("✅");
        return {
          success: true,
          message: "PDF successfully generated and sent to the user.",
        };
      } catch (err: any) {
        logger.error({ err }, "AI topdf failed");
        if (ctx.react) await ctx.react("❌");
        return { error: `Conversion failed: ${err.message}` };
      } finally {
        try {
          await fs.rm(tmpDir, { recursive: true, force: true });
        } catch (e) {}
      }
    },
  },
  {
    name: "compress_pdf",
    description:
      "Compress a large PDF document to reduce its file size. The user MUST reply to the PDF document they want to compress.",
    parameters: {
      type: "OBJECT",
      properties: {
        level: {
          type: "STRING",
          description:
            "The compression level: 'low' (max compression, lowest quality), 'medium', or 'high' (lowest compression, highest quality). If the user doesn't specify, ask them for the level.",
        },
      },
    },
    execute: async (args: any, ctx: any) => {
      if (!ctx?.rawMsg) return { error: "No message context available." };

      const quotedMsg = getQuotedMessage(ctx.rawMsg);
      const targetMsg = quotedMsg || ctx.rawMsg;
      const docMessage =
        targetMsg.message?.documentMessage ||
        targetMsg.message?.documentWithCaptionMessage?.message?.documentMessage;

      if (!docMessage || docMessage.mimetype !== "application/pdf") {
        return {
          error:
            "No PDF found. Please tell the user they must reply to a PDF document.",
        };
      }

      const fileSize = docMessage?.fileLength || 0;
      const sizeInMB = Number(fileSize) / (1024 * 1024);
      if (sizeInMB > 50)
        return {
          error: `File too large (${sizeInMB.toFixed(1)}MB). Max size is 50MB.`,
        };

      const tmpDir = path.join(os.tmpdir(), `hana_ai_compress_${randomUUID()}`);
      await fs.mkdir(tmpDir, { recursive: true });

      try {
        if (ctx.react) await ctx.react("⏳");

        const buffer = await downloadMediaMessage(
          targetMsg,
          "buffer",
          {},
          {
            logger: logger as any,
            reuploadRequest: (msg) => new Promise((resolve) => resolve(msg)),
          },
        );

        const inputPath = path.join(tmpDir, `input.pdf`);
        const outputPath = path.join(tmpDir, `compressed.pdf`);
        await fs.writeFile(inputPath, buffer as Buffer);

        let level: "low" | "medium" | "high" = "low";
        if (args.level === "medium" || args.level === "high") {
          level = args.level;
        }

        await compressPdf(inputPath, outputPath, level);
        const compressedBuffer = await fs.readFile(outputPath);

        const originalName = docMessage.fileName || "document.pdf";
        const oldSize = sizeInMB.toFixed(2);
        const newSize = (compressedBuffer.length / (1024 * 1024)).toFixed(2);

        if (ctx.replyWithFile) {
          await ctx.replyWithFile(
            compressedBuffer,
            originalName,
            "application/pdf",
            `🗜️ *AI Compression Complete*\nOld Size: ${oldSize}MB\nNew Size: ${newSize}MB`,
          );
        }

        if (ctx.react) await ctx.react("✅");
        return {
          success: true,
          message: `PDF successfully compressed from ${oldSize}MB to ${newSize}MB and sent to the user.`,
        };
      } catch (err: any) {
        logger.error({ err }, "AI compressPdf failed");
        if (ctx.react) await ctx.react("❌");
        return { error: `Compression failed: ${err.message}` };
      } finally {
        try {
          await fs.rm(tmpDir, { recursive: true, force: true });
        } catch (e) {}
      }
    },
  },
  {
    name: "start_pdf_session",
    description: "Start a session to convert MULTIPLE images into a single PDF. The user will be prompted to send the images.",
    parameters: { type: "OBJECT", properties: {} },
    execute: async (args: any, ctx: any) => {
        if (!ctx?.sender) return { error: "No context." };
        await startMediaSession(ctx.sender, {
            toolName: 'pdf',
            maxFiles: 30,
            allowedMimeTypes: /^image\/.*/,
            timeoutMs: 10 * 60 * 1000 // 10 mins
        });
        return { success: true, message: "Session started. Instruct the user to send the images one by one. VERY IMPORTANT: You must tell the user that they MUST explicitly say 'Hana compile' or 'Hana done' when they are finished sending images." };
    }
  },
  {
    name: "finish_pdf_session",
    description: "Compile all the images the user just sent during the active PDF session into a single PDF and send it to them.",
    parameters: { type: "OBJECT", properties: {} },
    execute: async (args: any, ctx: any) => {
        if (!ctx?.sender) return { error: "No context." };
        
        try {
            if (ctx.react) await ctx.react('⏳');
            
            const imagePaths = await finishMediaSession(ctx.sender);
            
            if (imagePaths.length === 0) {
                return { error: "No images were collected in the session." };
            }

            const tmpDir = path.dirname(imagePaths[0]);
            const pdfPath = path.join(tmpDir, 'output.pdf');
            
            await convertImagesToPdf(imagePaths, pdfPath);
            const pdfBuffer = await fs.readFile(pdfPath);
            
            if (ctx.replyWithFile) {
                await ctx.replyWithFile(pdfBuffer, 'compiled_images.pdf', 'application/pdf', `📄 Here is your compiled PDF.`);
            }
            
            await cleanupMediaSession(tmpDir);
            if (ctx.react) await ctx.react('✅');
            return { success: true, message: "Successfully compiled and sent the PDF to the user." };
        } catch (err: any) {
            if (ctx.react) await ctx.react('❌');
            return { error: `Failed to compile PDF: ${err.message}` };
        }
    }
  },
  {
    name: "cancel_pdf_session",
    description: "Cancel an active PDF session if the user changed their mind or made a mistake.",
    parameters: { type: "OBJECT", properties: {} },
    execute: async (args: any, ctx: any) => {
        if (!ctx?.sender) return { error: "No context." };
        await cancelMediaSession(ctx.sender);
        return { success: true, message: "PDF session cancelled successfully." };
    }
  }
];

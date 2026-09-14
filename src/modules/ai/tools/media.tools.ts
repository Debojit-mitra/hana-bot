import { processExifRemoval, processImageConversion } from "../../tools/tools.handler.js";
import { convertImageFile } from "../../tools/convert.tool.js";
import { exiftool } from "exiftool-vendored";
import { startMediaSession, finishMediaSession, cancelMediaSession, cleanupMediaSession } from "../../../core/media-session.js";
import type { AITool } from "../ai.tools.js";
import type { CommandContext } from "../../../types/index.js";
import fs from "fs/promises";
import path from "path";
import os from "os";

export const mediaTools: AITool[] = [
  {
    name: "remove_exif_metadata",
    description: "Remove EXIF metadata from an image or video to protect privacy. ONLY use this when the user specifically asks you to strip metadata from a media file they just sent.",
    parameters: {
      type: "OBJECT",
      properties: {}
    },
    execute: async (args: any, ctx?: CommandContext) => {
      if (!ctx) return { error: "No context" };
      try {
        await processExifRemoval(ctx);
        return { result: "Metadata removal initiated. The system will handle the response directly." };
      } catch (err: any) {
        return { error: err.message };
      }
    }
  },
  {
    name: "convert_image",
    description: "Convert an image to a different format (PNG, WEBP, JPEG). Use this when the user asks you to convert an image they sent.",
    parameters: {
      type: "OBJECT",
      properties: {
        format: {
          type: "STRING",
          description: "Target format",
          enum: ["png", "webp", "jpeg", "jpg"]
        }
      },
      required: ["format"]
    },
    execute: async (args: any, ctx?: CommandContext) => {
      if (!ctx) return { error: "No context" };
      try {
        await processImageConversion(ctx, args.format);
        return { result: `Conversion to ${args.format} initiated. The system will handle the response directly.` };
      } catch (err: any) {
        return { error: err.message };
      }
    }
  },
  {
    name: "start_rmexif_session",
    description: "Start a session to remove EXIF metadata from MULTIPLE images or videos in bulk. The user will be prompted to send the media.",
    parameters: { type: "OBJECT", properties: {} },
    execute: async (args: any, ctx: any) => {
        if (!ctx?.sender) return { error: "No context." };
        await startMediaSession(ctx.sender, {
            toolName: 'rmexif',
            maxFiles: 50,
            allowedMimeTypes: /^(image|video)\/.*/,
            timeoutMs: 15 * 60 * 1000 // 15 mins
        });
        return { success: true, message: "Session started. Instruct the user to send the media files one by one. VERY IMPORTANT: You must explicitly tell the user they MUST say 'Hana done' or 'Hana strip them' when they are finished." };
    }
  },
  {
    name: "finish_rmexif_session",
    description: "Strip EXIF metadata from all the media files the user just sent in the active session and send them back.",
    parameters: { type: "OBJECT", properties: {} },
    execute: async (args: any, ctx: any) => {
        if (!ctx?.sender) return { error: "No context." };
        
        try {
            if (ctx.react) await ctx.react('⏳');
            const filePaths = await finishMediaSession(ctx.sender);
            
            let successCount = 0;
            for (const filePath of filePaths) {
                try {
                    await exiftool.deleteAllTags(filePath);
                    const mime = filePath.endsWith('.mp4') ? 'video/mp4' : 'image/jpeg';
                    const outFilename = `stripped_${path.basename(filePath)}`;
                    if (ctx.replyWithFile) {
                        await ctx.replyWithFile({ url: filePath }, outFilename, mime);
                    }
                    successCount++;
                } catch (e) {
                    // Skip failed ones
                }
            }
            
            if (filePaths.length > 0) {
                await cleanupMediaSession(path.dirname(filePaths[0]));
            }
            
            if (ctx.react) await ctx.react('✅');
            return { success: true, message: `Successfully stripped metadata from ${successCount} files and sent them to the user.` };
        } catch (err: any) {
            if (ctx.react) await ctx.react('❌');
            return { error: `Failed to process session: ${err.message}` };
        }
    }
  },
  {
    name: "cancel_rmexif_session",
    description: "Cancel an active EXIF removal session if the user changed their mind.",
    parameters: { type: "OBJECT", properties: {} },
    execute: async (args: any, ctx: any) => {
        if (!ctx?.sender) return { error: "No context." };
        await cancelMediaSession(ctx.sender);
        return { success: true, message: "Session cancelled." };
    }
  },
  {
    name: "start_convert_session",
    description: "Start a session to convert MULTIPLE images to a specific format in bulk. The user will be prompted to send the images.",
    parameters: { type: "OBJECT", properties: {} },
    execute: async (args: any, ctx: any) => {
        if (!ctx?.sender) return { error: "No context." };
        await startMediaSession(ctx.sender, {
            toolName: 'convert',
            maxFiles: 50,
            allowedMimeTypes: /^image\/.*/,
            timeoutMs: 15 * 60 * 1000 // 15 mins
        });
        return { success: true, message: "Session started. Instruct the user to send the images one by one. VERY IMPORTANT: You must explicitly tell the user they MUST specify the format (e.g. 'Hana convert to png' or 'Hana done, make them webp') when they are finished." };
    }
  },
  {
    name: "finish_convert_session",
    description: "Convert all the images the user just sent in the active session to the requested format and send them back.",
    parameters: { 
        type: "OBJECT", 
        properties: {
            format: {
                type: "STRING",
                description: "The target format to convert all images to.",
                enum: ["png", "webp", "jpeg", "jpg"]
            }
        },
        required: ["format"]
    },
    execute: async (args: any, ctx: any) => {
        if (!ctx?.sender) return { error: "No context." };
        
        try {
            if (ctx.react) await ctx.react('⏳');
            const filePaths = await finishMediaSession(ctx.sender);
            
            const targetFormat = args.format === 'jpeg' ? 'jpg' : args.format;
            const targetMime = `image/${args.format === 'jpg' ? 'jpeg' : args.format}`;

            let successCount = 0;
            for (const filePath of filePaths) {
                try {
                    const outPath = path.join(path.dirname(filePath), `out_${path.basename(filePath)}.${targetFormat}`);
                    await convertImageFile(filePath, outPath, { targetFormat });
                    
                    const outFilename = `converted_${Date.now()}.${targetFormat}`;
                    if (ctx.replyWithFile) {
                        await ctx.replyWithFile({ url: outPath }, outFilename, targetMime);
                    }
                    successCount++;
                } catch (e) {
                    // Skip failed ones
                }
            }
            
            if (filePaths.length > 0) {
                await cleanupMediaSession(path.dirname(filePaths[0]));
            }
            
            if (ctx.react) await ctx.react('✅');
            return { success: true, message: `Successfully converted ${successCount} images to ${args.format} and sent them to the user.` };
        } catch (err: any) {
            if (ctx.react) await ctx.react('❌');
            return { error: `Failed to process session: ${err.message}` };
        }
    }
  },
  {
    name: "cancel_convert_session",
    description: "Cancel an active image conversion session if the user changed their mind.",
    parameters: { type: "OBJECT", properties: {} },
    execute: async (args: any, ctx: any) => {
        if (!ctx?.sender) return { error: "No context." };
        await cancelMediaSession(ctx.sender);
        return { success: true, message: "Session cancelled." };
    }
  }
];

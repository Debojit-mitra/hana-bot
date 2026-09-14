import { processExifRemoval, processImageConversion } from "../../tools/tools.handler.js";
import type { AITool } from "../ai.tools.js";
import type { CommandContext } from "../../../types/index.js";

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
  }
];

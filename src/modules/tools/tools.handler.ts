import type { CommandHandler, ModuleRegistration } from "../../types/index.js";
import { handleRmExif, processExifRemoval } from "./rmexif.tool.js";
import { handleConvert, processImageConversion } from "./convert.tool.js";
import { handleToPdf, handleCompressPdf } from "./docs.tool.js";
import { getConfig } from "../../config/config.js";

export { processExifRemoval, processImageConversion };

export const handleToolsHelp: CommandHandler = async (ctx) => {
  const config = getConfig();
  const prefix = config.commandPrefix;

  const menu = [
    "🧰 *Utility Tools*",
    "━━━━━━━━━━━━━━",
    `- \`${prefix}rmexif\` : Strip EXIF metadata from an image/video`,
    `- \`${prefix}convert\` _<format>_ : Convert an image to png, webp, jpg, avif, etc.`,
    `- \`${prefix}topdf\` : Convert Word/Excel/PPT/Image to PDF`,
    `- \`${prefix}compresspdf\` _[low|medium|high]_ : Compress a PDF document`,
    "💡 _Tip: Reply to an image or document with these commands to use them._",
    "",
    "🤖 *AI Bulk Processing*",
    "━━━━━━━━━━━━━━",
    "Want to process 10, 20, or 30 files at once?",
    "Just ask Hana! Try saying:",
    `_\"Hana, I want to combine 10 images into a PDF\"_`,
    `_\"Hana, strip EXIF metadata from the photos I send\"_`,
    `_\"Hana, I need to convert a bunch of images to PNG\"_`,
    "",
    "━━━━━━━━━━━━━━",
  ].join("\n");

  await ctx.reply(menu);
};

export function createToolsModule(): ModuleRegistration {
  const commands = new Map<string, CommandHandler>();
  commands.set("tools", handleToolsHelp);
  commands.set("rmexif", handleRmExif);
  commands.set("convert", handleConvert);
  commands.set("topdf", handleToPdf);
  commands.set("compresspdf", handleCompressPdf);

  return {
    name: "Tools",
    commands,
    description: "Utility tools",
  };
}

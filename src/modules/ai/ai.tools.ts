import type { CommandContext } from "../../types/index.js";

// Import tool groups
import { systemTools } from "./tools/system.tools.js";
import { networkTools } from "./tools/network.tools.js";
import { adminTools } from "./tools/admin.tools.js";
import { memoryTools } from "./tools/memory.tools.js";
import { mediaTools } from "./tools/media.tools.js";
import { jenkinsTools } from "./tools/jenkins.tools.js";
import { reminderTools } from "./tools/reminder.tools.js";
import { weatherTools } from "./tools/weather.tools.js";

export interface AITool {
  name: string;
  description: string;
  parameters: any;
  execute: (args: any, ctx?: CommandContext) => Promise<any>;
}

export const aiTools: AITool[] = [
  ...systemTools,
  ...networkTools,
  ...adminTools,
  ...memoryTools,
  ...mediaTools,
  ...jenkinsTools,
  ...reminderTools,
  ...weatherTools
];

/**
 * Find a tool by name and execute it with the provided arguments.
 */
export async function executeTool(
  name: string,
  args: any,
  ctx?: CommandContext,
): Promise<any> {
  const tool = aiTools.find((t) => t.name === name);
  if (!tool) {
    throw new Error(`Tool ${name} not found`);
  }
  return tool.execute(args, ctx);
}

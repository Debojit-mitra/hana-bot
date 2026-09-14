import { getServerStats, getExternalServerStats } from "../../stats/stats.service.js";
import { getEnvConfig } from "../../../config/env.js";
import type { AITool } from "../ai.tools.js";

export const systemTools: AITool[] = [
  {
    name: "get_system_stats",
    description: "Get the current system statistics of the server running the bot (CPU, RAM, Disk, Uptime, Load). Use this when the user asks for server status.",
    parameters: {
      type: "OBJECT",
      properties: {}
    },
    execute: async () => {
      const stats = await getServerStats();
      return stats;
    }
  },
  {
    name: "list_external_servers",
    description: "List all configured external servers that can be monitored.",
    parameters: {
      type: "OBJECT",
      properties: {}
    },
    execute: async () => {
      const envConfig = getEnvConfig();
      if (!envConfig.externalServers || envConfig.externalServers.length === 0) {
        return { message: "No external servers configured." };
      }
      return {
        servers: envConfig.externalServers.map(s => ({ name: s.name, url: s.url }))
      };
    }
  },
  {
    name: "get_external_server_stats",
    description: "Get the system stats of an external server by name.",
    parameters: {
      type: "OBJECT",
      properties: {
        serverName: { type: "STRING", description: "Name of the server to check" }
      },
      required: ["serverName"]
    },
    execute: async (args: any) => {
      const envConfig = getEnvConfig();
      const server = envConfig.externalServers?.find(
        s => s.name.toLowerCase() === args.serverName.toLowerCase()
      );
      if (!server) {
        return { error: `Server ${args.serverName} not found in configuration.` };
      }
      return await getExternalServerStats(server.name);
    }
  }
];

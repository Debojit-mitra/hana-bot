import { listPeers, getInterfaceStatus, addPeer, revokePeer } from "../../wireguard/wg.service.js";
import { pingAll } from "../../ping/ping.service.js";
import { getConfig, updateConfig } from "../../../config/config.js";
import { getEnvConfig } from "../../../config/env.js";
import { isAdmin } from "../../../core/auth.js";
import type { AITool } from "../ai.tools.js";
import type { CommandContext } from "../../../types/index.js";

export const networkTools: AITool[] = [
  {
    name: "ping_all_sites",
    description: "Ping all monitored websites to check if they are up or down. Also returns response times.",
    parameters: {
      type: "OBJECT",
      properties: {}
    },
    execute: async () => {
      const config = getConfig();
      const envConfig = getEnvConfig();
      const allSites = [...envConfig.pingSites, ...config.ping.sites];
      
      if (allSites.length === 0) {
        return { message: "No sites configured for monitoring." };
      }
      return await pingAll(allSites, config.ping.timeoutMs);
    }
  },
  {
    name: "add_ping_site",
    description: "Add a new website to the ping monitoring list. Only admins can use this.",
    parameters: {
      type: "OBJECT",
      properties: {
        name: { type: "STRING", description: "Name of the site (e.g. Google)" },
        url: { type: "STRING", description: "URL of the site (e.g. https://google.com)" }
      },
      required: ["name", "url"]
    },
    execute: async (args: any, ctx?: CommandContext) => {
      if (!ctx) return { error: "No context" };
      if (!isAdmin(ctx.sender)) return { error: "Only admins can add ping sites. Tell the user politely." };
      
      let url = args.url;
      if (!url.startsWith('http://') && !url.startsWith('https://')) url = `https://${url}`;
      
      const config = getConfig();
      if (config.ping.sites.some(s => s.name.toLowerCase() === args.name.toLowerCase())) {
        return { error: `Site ${args.name} already exists in the ping list.` };
      }
      
      config.ping.sites.push({ name: args.name, url });
      await updateConfig({ ping: config.ping });
      return { result: `Successfully added ${args.name} (${url}) to the ping monitor list.` };
    }
  },
  {
    name: "remove_ping_site",
    description: "Remove a website from the ping monitoring list. Only admins can use this.",
    parameters: {
      type: "OBJECT",
      properties: {
        name: { type: "STRING", description: "Name of the site to remove" }
      },
      required: ["name"]
    },
    execute: async (args: any, ctx?: CommandContext) => {
      if (!ctx) return { error: "No context" };
      if (!isAdmin(ctx.sender)) return { error: "Only admins can remove ping sites. Tell the user politely." };
      
      const config = getConfig();
      const idx = config.ping.sites.findIndex(s => s.name.toLowerCase() === args.name.toLowerCase());
      if (idx === -1) return { error: `Site ${args.name} not found in the ping list.` };
      
      config.ping.sites.splice(idx, 1);
      await updateConfig({ ping: config.ping });
      return { result: `Successfully removed ${args.name} from the ping monitor list.` };
    }
  },
  {
    name: "list_wireguard_peers",
    description: "Get a list of all WireGuard VPN peers, their IP addresses, handshakes, and bandwidth usage.",
    parameters: {
      type: "OBJECT",
      properties: {}
    },
    execute: async () => {
      try {
        const peers = await listPeers();
        return { peers };
      } catch (err: any) {
        return { error: err.message };
      }
    }
  },
  {
    name: "get_wireguard_status",
    description: "Get the WireGuard interface status, IP address, and total bandwidth.",
    parameters: {
      type: "OBJECT",
      properties: {}
    },
    execute: async () => {
      try {
        const status = await getInterfaceStatus();
        return status;
      } catch (err: any) {
        return { error: err.message };
      }
    }
  },
  {
    name: "add_wireguard_peer",
    description: "Add a new WireGuard VPN peer. This generates keys and provisions them on the server. Returns the client configuration. Only admins can use this. ALWAYS ask the user what the name of the new peer should be before executing this tool, unless they explicitly provided a name.",
    parameters: {
      type: "OBJECT",
      properties: {
        name: { type: "STRING", description: "Name of the new peer (no spaces, alphanumeric)" }
      },
      required: ["name"]
    },
    execute: async (args: any, ctx?: CommandContext) => {
      if (!ctx) return { error: "No context" };
      if (!isAdmin(ctx.sender)) return { error: "Only admins can add VPN peers. Tell the user politely." };
      
      try {
        const { config, ip, publicKey } = await addPeer(args.name);
        
        // Send the sensitive config directly to the user's DM
        if (ctx.sock) {
          await ctx.sock.sendMessage(ctx.sender, {
            text: `🔒 *Your WireGuard Configuration for ${args.name}*\n\nAssigned IP: ${ip}\nPublic Key: ${publicKey}\n\n\`\`\`ini\n${config}\n\`\`\``
          });
        }

        return { 
          result: `Successfully added WireGuard peer "${args.name}". The sensitive configuration has been sent directly to the user's DM. Tell the user to check their personal messages for the config!` 
        };
      } catch (err: any) {
        return { error: `Failed to add peer: ${err.message}` };
      }
    }
  },
  {
    name: "remove_wireguard_peer",
    description: "Revoke and remove a WireGuard VPN peer by its name. Only admins can use this.",
    parameters: {
      type: "OBJECT",
      properties: {
        name: { type: "STRING", description: "Name of the peer to remove" }
      },
      required: ["name"]
    },
    execute: async (args: any, ctx?: CommandContext) => {
      if (!ctx) return { error: "No context" };
      if (!isAdmin(ctx.sender)) return { error: "Only admins can remove VPN peers. Tell the user politely." };
      
      try {
        const success = await revokePeer(args.name);
        if (success) {
          return { result: `Successfully removed and revoked WireGuard peer "${args.name}".` };
        }
        return { error: "Failed to remove peer (unknown error)." };
      } catch (err: any) {
        return { error: `Failed to remove peer: ${err.message}` };
      }
    }
  }
];

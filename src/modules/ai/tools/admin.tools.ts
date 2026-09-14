import { getConfig, updateConfig } from "../../../config/config.js";
import { getAlias, isAdmin, addToWhitelist, removeFromWhitelist } from "../../../core/auth.js";
import type { AITool } from "../ai.tools.js";
import type { CommandContext } from "../../../types/index.js";

export const adminTools: AITool[] = [
  {
    name: "get_bot_access_list",
    description: "Get the list of all users who have access to the bot, including the owner, admins, and whitelisted users. Use this when the user asks who is allowed to talk to you.",
    parameters: {
      type: "OBJECT",
      properties: {}
    },
    execute: async () => {
      const config = getConfig();
      const formatJid = (jid: string) => {
        const number = jid.split('@')[0];
        const alias = getAlias(jid);
        return alias ? `${alias} (+${number})` : `+${number}`;
      };
      return {
        owner: formatJid(config.ownerJid),
        admins: config.admins.map(formatJid),
        whitelist: config.whitelist.map(formatJid)
      };
    }
  },
  {
    name: "add_whitelist_user",
    description: "Add a WhatsApp phone number to the bot's whitelist so they can use it. Optionally save their name. Only admins can use this.",
    parameters: {
      type: "OBJECT",
      properties: {
        phoneNumber: { type: "STRING", description: "Phone number with country code (e.g. 919876543210)" },
        name: { type: "STRING", description: "Optional name/alias for the user" }
      },
      required: ["phoneNumber"]
    },
    execute: async (args: any, ctx?: CommandContext) => {
      if (!ctx) return { error: "No context" };
      if (!isAdmin(ctx.sender)) return { error: "Only admins can add users to the whitelist. Tell the user politely." };
      
      const success = await addToWhitelist(args.phoneNumber, args.name);
      if (!success) return { error: "User is already in the whitelist or invalid number." };
      return { result: `Successfully added ${args.name || args.phoneNumber} to the whitelist.` };
    }
  },
  {
    name: "remove_whitelist_user",
    description: "Remove a user from the bot's whitelist so they can no longer use it. Only admins can use this.",
    parameters: {
      type: "OBJECT",
      properties: {
        phoneNumber: { type: "STRING", description: "Phone number to remove" }
      },
      required: ["phoneNumber"]
    },
    execute: async (args: any, ctx?: CommandContext) => {
      if (!ctx) return { error: "No context" };
      if (!isAdmin(ctx.sender)) return { error: "Only admins can remove users from the whitelist. Tell the user politely." };
      
      const success = await removeFromWhitelist(args.phoneNumber);
      if (!success) return { error: "User not found in the whitelist, or cannot remove the owner." };
      return { result: `Successfully removed ${args.phoneNumber} from the whitelist.` };
    }
  },
  {
    name: "toggle_alerts",
    description: "Enable or disable global system/ping alerts, or Jenkins alerts. Only admins can use this.",
    parameters: {
      type: "OBJECT",
      properties: {
        type: { type: "STRING", description: "Which alert type to toggle", enum: ["uptime", "jenkins"] },
        enabled: { type: "BOOLEAN", description: "True to enable, false to disable" }
      },
      required: ["type", "enabled"]
    },
    execute: async (args: any, ctx?: CommandContext) => {
      if (!ctx) return { error: "No context" };
      if (!isAdmin(ctx.sender)) return { error: "Only admins can toggle alerts. Tell the user politely." };
      
      const config = getConfig();
      if (args.type === "uptime") {
        config.alerts.enabled = args.enabled;
        await updateConfig({ alerts: config.alerts });
      } else if (args.type === "jenkins") {
        config.jenkins.enabled = args.enabled;
        await updateConfig({ jenkins: config.jenkins });
      }
      return { result: `Successfully turned ${args.enabled ? 'ON' : 'OFF'} ${args.type} alerts.` };
    }
  },
  {
    name: "subscribe_chat_to_alerts",
    description: "Subscribe the current WhatsApp chat/group to receive alerts. Only admins can use this.",
    parameters: {
      type: "OBJECT",
      properties: {
        events: { 
          type: "ARRAY", 
          items: { type: "STRING" },
          description: "List of events to subscribe to (e.g. 'uptime', 'jenkins')"
        }
      },
      required: ["events"]
    },
    execute: async (args: any, ctx?: CommandContext) => {
      if (!ctx) return { error: "No context" };
      if (!isAdmin(ctx.sender)) return { error: "Only admins can manage subscriptions. Tell the user politely." };
      
      const config = getConfig();
      const existingSub = config.alerts.channels.find((s: any) => s.jid === ctx.jid);
      
      if (existingSub) {
        // Merge events
        const newEvents = new Set([...existingSub.events, ...args.events]);
        existingSub.events = Array.from(newEvents);
      } else {
        config.alerts.channels.push({ jid: ctx.jid, events: args.events });
      }
      
      await updateConfig({ alerts: config.alerts });
      return { result: `Successfully subscribed this chat to ${args.events.join(", ")} alerts.` };
    }
  },
  {
    name: "unsubscribe_chat_from_alerts",
    description: "Unsubscribe the current WhatsApp chat/group from receiving alerts. Only admins can use this.",
    parameters: {
      type: "OBJECT",
      properties: {}
    },
    execute: async (args: any, ctx?: CommandContext) => {
      if (!ctx) return { error: "No context" };
      if (!isAdmin(ctx.sender)) return { error: "Only admins can manage subscriptions. Tell the user politely." };
      
      const config = getConfig();
      const idx = config.alerts.channels.findIndex((s: any) => s.jid === ctx.jid);
      
      if (idx === -1) {
        return { error: "This chat is not subscribed to any alerts." };
      }
      
      config.alerts.channels.splice(idx, 1);
      await updateConfig({ alerts: config.alerts });
      return { result: "Successfully unsubscribed this chat from all alerts." };
    }
  }
];

import { schedule as cronSchedule, type ScheduledTask } from "node-cron";
import type { WASocket } from "@whiskeysockets/baileys";
import { getConfig, updateConfig } from "../../config/config.js";
import { getEnvConfig } from "../../config/env.js";
import { pingAll } from "../ping/ping.service.js";
import {
  initAlertStates,
  processResults,
  syncAlertStates,
  getAlertStates,
} from "./alert.service.js";
import { formatTimestamp } from "../../utils/format.js";
import { isAdmin } from "../../core/auth.js";
import type { CommandHandler, ModuleRegistration } from "../../types/index.js";
import logger from "../../utils/logger.js";

let cronJob: ScheduledTask | null = null;
let socketRef: WASocket | null = null;

/**
 * Start the alert scheduler with cron-based periodic checks.
 */
export function startAlertScheduler(sock: WASocket): void {
  socketRef = sock;
  const config = getConfig();

  if (!config.alerts.enabled) {
    logger.info("Alerts are disabled, skipping scheduler start");
    return;
  }

  // Initialize alert states from configured sites
  initAlertStates();

  // Stop existing job if any
  stopAlertScheduler();

  const intervalMinutes = config.alerts.checkIntervalMinutes;
  const cronExpr = `*/${intervalMinutes} * * * *`;

  cronJob = cronSchedule(cronExpr, async () => {
    await runAlertCheck();
  });

  logger.info({ intervalMinutes, cronExpr }, "🔔 Alert scheduler started");
}

/**
 * Stop the alert scheduler.
 */
export function stopAlertScheduler(): void {
  if (cronJob) {
    cronJob.stop();
    cronJob = null;
    logger.info("Alert scheduler stopped");
  }
}

/**
 * Run a single alert check cycle.
 */
async function runAlertCheck(): Promise<void> {
  const config = getConfig();
  const envConfig = getEnvConfig();
  const allSites = [...envConfig.pingSites, ...config.ping.sites];

  if (!config.alerts.enabled || !socketRef) return;
  if (allSites.length === 0) return;

  try {
    // Sync states in case sites were added/removed
    syncAlertStates();

    // Ping all sites
    const results = await pingAll(allSites, config.ping.timeoutMs);

    // Process results and get alert messages
    const alertMessages = processResults(results);

    // Send alert messages
    for (const message of alertMessages) {
      const uptimeChannels = config.alerts.channels.filter((c) =>
        c.events.includes("uptime"),
      );
      for (const channel of uptimeChannels) {
        if (socketRef) {
          try {
            await socketRef.sendMessage(channel.jid, { text: message });
          } catch (err) {
            logger.error({ err }, "Failed to send alert message to channel");
          }
        }
      }
    }

    const upCount = results.filter((r) => r.status === "up").length;
    logger.debug(
      { total: results.length, up: upCount, alerts: alertMessages.length },
      "Alert check completed",
    );
  } catch (err) {
    logger.error({ err }, "Alert check failed");
  }
}

/**
 * Update the socket reference (on reconnect).
 */
export function updateAlertSocket(sock: WASocket): void {
  socketRef = sock;
}

// ─── Command Handlers ───────────────────────────────────────────────────────

const handleAlerts: CommandHandler = async (ctx) => {
  if (!isAdmin(ctx.sender)) {
    await ctx.reply("❌ This command is restricted to admins only.");
    return;
  }

  const subcommand = ctx.args[0]?.toLowerCase();
  const config = getConfig();

  switch (subcommand) {
    case "on": {
      config.alerts.enabled = true;
      updateConfig({ alerts: config.alerts });
      if (socketRef) {
        startAlertScheduler(socketRef);
      }
      await ctx.react("✅");
      await ctx.reply(
        `🔔 Alerts *enabled*.\nChecking every ${config.alerts.checkIntervalMinutes} minutes.`,
      );
      break;
    }

    case "off": {
      config.alerts.enabled = false;
      updateConfig({ alerts: config.alerts });
      stopAlertScheduler();
      await ctx.react("✅");
      await ctx.reply("🔕 Alerts *disabled*.");
      break;
    }

    case "sub": {
      const eventsStr = ctx.args[1];
      if (!eventsStr) {
        await ctx.reply(
          "Usage: `!alerts sub <events>`\nEvents can be: `uptime`, `jenkins` (comma separated)\nExample: `!alerts sub uptime,jenkins`",
        );
        return;
      }
      const requestedEvents = eventsStr
        .split(",")
        .map((e) => e.trim().toLowerCase());
      const validEvents = requestedEvents.filter(
        (e) => e === "uptime" || e === "jenkins",
      ) as ("uptime" | "jenkins")[];

      if (validEvents.length === 0) {
        await ctx.reply(
          "❌ Invalid events specified. Use `uptime` or `jenkins`.",
        );
        return;
      }

      const channelIndex = config.alerts.channels.findIndex(
        (c) => c.jid === ctx.jid,
      );
      if (channelIndex > -1) {
        // Update existing
        const existingEvents = new Set(
          config.alerts.channels[channelIndex].events,
        );
        validEvents.forEach((e) => existingEvents.add(e));
        config.alerts.channels[channelIndex].events =
          Array.from(existingEvents);
      } else {
        config.alerts.channels.push({ jid: ctx.jid, events: validEvents });
      }
      await updateConfig({ alerts: config.alerts });
      await ctx.react("✅");
      await ctx.reply(
        `🔔 Subscribed this chat to alerts: ${validEvents.join(", ")}`,
      );
      break;
    }

    case "unsub": {
      const channelIndex = config.alerts.channels.findIndex(
        (c) => c.jid === ctx.jid,
      );
      if (channelIndex > -1) {
        config.alerts.channels.splice(channelIndex, 1);
        await updateConfig({ alerts: config.alerts });
        await ctx.react("✅");
        await ctx.reply("🔕 Unsubscribed this chat from all alerts.");
      } else {
        await ctx.reply("ℹ️ This chat is not subscribed to any alerts.");
      }
      break;
    }

    case "status": {
      const states = getAlertStates();
      const lines = [...states.values()].map((s) => {
        const icon =
          s.status === "up" ? "✅" : s.status === "down" ? "❌" : "❓";
        const lastCheck = s.lastChecked
          ? formatTimestamp(s.lastChecked)
          : "never";
        return `${icon} *${s.name}*\n   Last check: ${lastCheck}\n   Failures: ${s.consecutiveFailures}`;
      });

      const channelsStr =
        config.alerts.channels
          .map((c) => `- \`${c.jid.split("@")[0]}\`: ${c.events.join(", ")}`)
          .join("\n") || "None configured";

      await ctx.reply(
        [
          `🔔 *Alert Status* (${config.alerts.enabled ? "enabled" : "disabled"})`,
          "━━━━━━━━━━━━━━",
          `- *Interval:* ${config.alerts.checkIntervalMinutes}min`,
          `- *Threshold:* ${config.alerts.failureThreshold} failures`,
          "",
          "*Subscribed Channels:*",
          channelsStr,
          "",
          "*Monitored Sites:*",
          ...(lines.length > 0 ? lines : ["- _No sites being monitored._"]),
          "━━━━━━━━━━━━━━",
        ].join("\n"),
      );
      break;
    }

    default:
      await ctx.reply(
        "🔔 *Alerts* (Admin Only)\n" +
          "━━━━━━━━━━━━━━\n" +
          "Usage:\n" +
          "  - `!alerts on` : Enable alerts\n" +
          "  - `!alerts off` : Disable alerts\n" +
          "  - `!alerts sub` _<events>_ : Subscribe this chat (uptime, jenkins)\n" +
          "  - `!alerts unsub` : Unsubscribe this chat\n" +
          "  - `!alerts status` : Show status",
      );
  }
};

export function createAlertsModule(): ModuleRegistration {
  const commands = new Map<string, CommandHandler>();
  commands.set("alerts", handleAlerts);

  return {
    name: "Alerts",
    commands,
    description: "Automated uptime monitoring alerts",
  };
}

import "dotenv/config";
import fs from "fs";
import path from "path";
import type { WASocket } from "@whiskeysockets/baileys";
import { loadConfig, getConfig } from "./config/config.js";
import { getEnvConfig } from "./config/env.js";
import { connectDB } from "./db/connection.js";
import { createSocket } from "./core/socket.js";
import {
  registerModule,
  handleIncomingMessages,
} from "./core/command-router.js";
import {
  isAdmin,
  addToWhitelist,
  removeFromWhitelist,
  getWhitelist,
  addAdmin,
  removeAdmin,
  getAdmins,
  normalizeJid,
  getAlias,
  setAlias,
} from "./core/auth.js";
import { createPingModule } from "./modules/ping/ping.handler.js";
import { createStatsModule } from "./modules/stats/stats.handler.js";
import { createWireGuardModule } from "./modules/wireguard/wg.handler.js";
import {
  createAlertsModule,
  startAlertScheduler,
  updateAlertSocket,
} from "./modules/alerts/alert.scheduler.js";
import { createAIModule } from "./modules/ai/ai.handler.js";
import { initAIProvider } from "./modules/ai/ai.provider.js";
import {
  createJenkinsModule,
  updateJenkinsSocket,
} from "./modules/jenkins/jenkins.handler.js";
import { startJenkinsServer } from "./modules/jenkins/jenkins.service.js";
import { createRemindersModule } from "./modules/reminders/reminder.handler.js";
import { startReminderScheduler } from "./modules/reminders/reminder.scheduler.js";
import { createWeatherModule } from "./modules/weather/weather.handler.js";
import { startWeatherScheduler } from "./modules/weather/weather.scheduler.js";
import { createToolsModule } from "./modules/tools/tools.handler.js";
import { formatHelp } from "./utils/format.js";
import type { CommandHandler, ModuleRegistration } from "./types/index.js";
import logger from "./utils/logger.js";

// ─── Main Boot Sequence ─────────────────────────────────────────────────────

async function main(): Promise<void> {
  let version = "1.0";
  try {
    const pkg = JSON.parse(
      fs.readFileSync(path.join(process.cwd(), "package.json"), "utf8"),
    );
    if (pkg.version) version = pkg.version;
  } catch (err) {
    // ignore
  }

  const rightSpaces = " ".repeat(Math.max(0, 14 - version.length));

  console.log(`
╔════════════════════════════════════╗
║         🤖 Hana Bot v${version}${rightSpaces}║
║   WhatsApp Server Management Bot   ║
╚════════════════════════════════════╝
`);

  // Connect to MongoDB
  await connectDB();

  // Load configuration
  const config = await loadConfig();
  const envConfig = getEnvConfig();
  logger.info("Configuration loaded");

  // Initialize AI provider
  initAIProvider(
    envConfig.ai.provider,
    envConfig.ai.apiKey,
    envConfig.ai.model,
    envConfig.ai.baseUrl,
  );

  // Register all modules
  registerModule(createPingModule());
  registerModule(createStatsModule());
  registerModule(createWireGuardModule());
  registerModule(createAlertsModule());
  registerModule(createAIModule());
  registerModule(createJenkinsModule());
  registerModule(createCoreModule());
  registerModule(createToolsModule());
  registerModule(createRemindersModule());
  registerModule(createWeatherModule());

  logger.info("All modules registered");

  // Connect to WhatsApp
  await createSocket({
    onConnected: (sock: WASocket) => {
      logger.info("Bot is online and ready");

      // Start schedulers
      startAlertScheduler(sock);
      startReminderScheduler(sock);
      startWeatherScheduler();

      // Start Jenkins webhook server
      updateJenkinsSocket(sock);
      startJenkinsServer(sock);

      // Notify owner and any channels subscribed to uptime that bot is online
      const notifyList = new Set<string>();
      if (config.ownerJid) notifyList.add(config.ownerJid);

      const uptimeChannels =
        config.alerts.channels?.filter((c) => c.events.includes("uptime")) ||
        [];
      uptimeChannels.forEach((c) => notifyList.add(c.jid));

      if (process.env.DEV_MODE !== "true") {
        for (const jid of notifyList) {
          sock
            .sendMessage(jid, {
              text: "*🌸 Hana is online!*\nSay hi, ask me anything, or type `!help` to see what I can do.",
            })
            .catch(() => {
              /* ignore if user hasn't messaged bot yet */
            });
        }
      } else {
        logger.info("DEV_MODE is enabled, skipping notifications to channels");
      }
    },

    onDisconnected: () => {
      logger.warn("Bot disconnected");
    },

    onMessage: (sock: WASocket, upsert: any) => {
      handleIncomingMessages(sock, upsert);
    },
  });
}

// ─── Core Module (help, whitelist) ──────────────────────────────────────────

function createCoreModule(): ModuleRegistration {
  const commands = new Map<string, CommandHandler>();

  // Help command
  commands.set("help", async (ctx) => {
    const config = getConfig();
    await ctx.reply(formatHelp(config.commandPrefix));
  });

  // Whitelist management (admin only)
  commands.set("whitelist", async (ctx) => {
    if (!isAdmin(ctx.sender)) {
      await ctx.reply("❌ Only an admin can manage the whitelist.");
      return;
    }

    const subcommand = ctx.args[0]?.toLowerCase();

    switch (subcommand) {
      case "add": {
        const number = ctx.args[1];
        if (!number) {
          await ctx.reply(
            "Usage: `!whitelist add <phone_number> [name] [admin]`\nExample: `!whitelist add 1234567890 John admin`",
          );
          return;
        }

        const lastArg = ctx.args[ctx.args.length - 1]?.toLowerCase();
        const isMakeAdmin = lastArg === "admin";

        // Extract name from args (everything between number and 'admin' if present, or end)
        const nameArgsEnd = isMakeAdmin ? ctx.args.length - 1 : ctx.args.length;
        const name = ctx.args.slice(2, nameArgsEnd).join(" ").trim();

        let added = false;

        // If the user is already whitelisted, but a name was provided, we just update the alias
        const config = getConfig();
        const jid = normalizeJid(number);
        if (config.whitelist.includes(jid) && name) {
          await setAlias(number, name);
          added = true;
        } else {
          added = await addToWhitelist(number, name || undefined);
        }

        let msg = added
          ? `✅ Added/Updated ${name || number} in whitelist.`
          : `ℹ️ ${number} is already whitelisted.`;

        if (isMakeAdmin) {
          const adminAdded = await addAdmin(number, name || undefined);
          if (adminAdded) {
            msg += `\n👑 Promoted to Admin.`;
          } else {
            msg += `\nℹ️ Already an Admin.`;
          }
        }

        await ctx.react("✅");
        await ctx.reply(msg);
        break;
      }

      case "remove": {
        const number = ctx.args[1];
        if (!number) {
          await ctx.reply("Usage: `!whitelist remove <phone_number>`");
          return;
        }
        // Removing from whitelist should also remove from admin to be safe
        await removeAdmin(number);
        const removed = await removeFromWhitelist(number);

        if (removed) {
          await ctx.react("✅");
          await ctx.reply(`🗑️ Removed ${number} from whitelist and admins.`);
        } else {
          await ctx.reply(`❌ Cannot remove (not found or is owner).`);
        }
        break;
      }

      case "admin": {
        const number = ctx.args[1];
        if (!number) {
          await ctx.reply(
            "Usage: `!whitelist admin <phone_number>` (Promotes user to Admin)",
          );
          return;
        }
        const adminAdded = await addAdmin(number);
        if (adminAdded) {
          await ctx.react("✅");
          await ctx.reply(`👑 Promoted ${number} to Admin.`);
        } else {
          await ctx.reply(`ℹ️ ${number} is already an Admin.`);
        }
        break;
      }

      case "unadmin": {
        const number = ctx.args[1];
        if (!number) {
          await ctx.reply(
            "Usage: `!whitelist unadmin <phone_number>` (Demotes Admin to normal user)",
          );
          return;
        }
        const adminRemoved = await removeAdmin(number);
        if (adminRemoved) {
          await ctx.react("✅");
          await ctx.reply(`👤 Demoted ${number} to normal user.`);
        } else {
          await ctx.reply(`❌ Cannot demote (not found or is owner).`);
        }
        break;
      }

      case "list": {
        const list = getWhitelist();
        const admins = getAdmins();
        const config = getConfig();

        const lines = list.map((jid, i) => {
          const number = jid.replace("@s.whatsapp.net", "");
          const alias = getAlias(jid);
          const displayName = alias ? `${alias} (+${number})` : `+${number}`;

          const isOwner = normalizeJid(jid) === normalizeJid(config.ownerJid);
          const isAdm = admins.some(
            (a) => normalizeJid(a) === normalizeJid(jid),
          );

          let role = "";
          if (isOwner) role = " 👑 *(owner)*";
          else if (isAdm) role = " 🛡️ *(admin)*";

          return `${i + 1}. \`${displayName}\`${role}`;
        });

        await ctx.reply(
          [
            "👥 *Whitelist*",
            "━━━━━━━━━━━━━━",
            ...lines,
            "━━━━━━━━━━━━━━",
            `Total: ${list.length} user(s)`,
          ].join("\n"),
        );
        break;
      }

      default:
        await ctx.reply(
          "👥 *Whitelist* (Admin Only)\n" +
            "━━━━━━━━━━━━━━\n" +
            "Usage:\n" +
            "  `!whitelist add <number> [name] [admin]` — Add user (optionally with name and as admin)\n" +
            "  `!whitelist remove <number>` — Remove user\n" +
            "  `!whitelist admin <number>` — Promote user to admin\n" +
            "  `!whitelist unadmin <number>` — Demote admin to normal user\n" +
            "  `!whitelist list` — Show all",
        );
    }
  });

  return {
    name: "Core",
    commands,
    description: "Help and whitelist management",
  };
}

// ─── Graceful Shutdown ──────────────────────────────────────────────────────

process.on("SIGINT", () => {
  logger.info("Received SIGINT, shutting down...");
  process.exit(0);
});

process.on("SIGTERM", () => {
  logger.info("Received SIGTERM, shutting down...");
  process.exit(0);
});

process.on("uncaughtException", (err) => {
  logger.error({ err }, "Uncaught exception");
});

process.on("unhandledRejection", (reason) => {
  logger.error({ reason }, "Unhandled rejection");
});

// ─── Start ──────────────────────────────────────────────────────────────────

main().catch((err) => {
  logger.error({ err }, "Fatal error");
  process.exit(1);
});

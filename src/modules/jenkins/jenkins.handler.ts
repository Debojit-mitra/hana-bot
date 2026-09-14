import { getConfig, updateConfig } from "../../config/config.js";
import { getEnvConfig } from "../../config/env.js";
import { pingUrl } from "../ping/ping.service.js";
import { isAdmin } from "../../core/auth.js";
import { startJenkinsServer, stopJenkinsServer } from "./jenkins.service.js";
import type { CommandHandler, ModuleRegistration } from "../../types/index.js";
import type { WASocket } from "@whiskeysockets/baileys";

let socketRef: WASocket | null = null;

export function updateJenkinsSocket(sock: WASocket): void {
  socketRef = sock;
}

const handleJenkins: CommandHandler = async (ctx) => {
  if (!isAdmin(ctx.sender)) {
    await ctx.reply("❌ This command is restricted to admins only.");
    return;
  }

  const subcommand = ctx.args[0]?.toLowerCase();
  const config = getConfig();
  const envConfig = getEnvConfig();

  switch (subcommand) {
    case "on": {
      config.jenkins.enabled = true;
      await updateConfig({ jenkins: config.jenkins });
      if (socketRef) {
        startJenkinsServer(socketRef);
      }
      await ctx.react("✅");
      await ctx.reply(
        `🏗️ Jenkins integration *enabled*.\nListening on port ${envConfig.jenkins.port}.`,
      );
      break;
    }

    case "off": {
      config.jenkins.enabled = false;
      await updateConfig({ jenkins: config.jenkins });
      stopJenkinsServer();
      await ctx.react("✅");
      await ctx.reply("🔕 Jenkins integration *disabled*.");
      break;
    }

    case "status": {
      const baseUrl = envConfig.jenkins.webhookBaseUrl
        ? envConfig.jenkins.webhookBaseUrl
        : `http://<bot-ip>:${envConfig.jenkins.port}`;
      const fullUrl = `${baseUrl.replace(/\/$/, "")}/webhook/jenkins`;

      let serverStatus = "⚠️ Server URL not configured (`JENKINS_SERVER_URL`)";
      if (envConfig.jenkins.serverUrl) {
        await ctx.react("⏳");
        const result = await pingUrl(envConfig.jenkins.serverUrl, 5000);
        serverStatus =
          result.status === "up"
            ? `✅ Online (${result.responseTime}ms)`
            : `❌ Offline (${result.error || "Unknown Error"})`;
        await ctx.react(result.status === "up" ? "✅" : "⚠️");
      }

      await ctx.reply(
        [
          `🏗️ *Jenkins Status* (${config.jenkins.enabled ? "enabled" : "disabled"})`,
          "━━━━━━━━━━━━━━",
          `- *Server:* ${serverStatus}`,
          `- *Port:* ${envConfig.jenkins.port}`,
          `- *Webhook URL:* \`${fullUrl}\``,
          "━━━━━━━━━━━━━━",
        ].join("\n"),
      );
      break;
    }

    default:
      await ctx.reply(
        "🏗️ *Jenkins* (Admin Only)\n" +
          "━━━━━━━━━━━━━━\n" +
          "Usage:\n" +
          "  - `!jenkins on` : Enable Jenkins webhooks\n" +
          "  - `!jenkins off` : Disable Jenkins webhooks\n" +
          "  - `!jenkins status` : Show configuration",
      );
  }
};

export function createJenkinsModule(): ModuleRegistration {
  const commands = new Map<string, CommandHandler>();
  commands.set("jenkins", handleJenkins);

  return {
    name: "Jenkins",
    commands,
    description: "Jenkins CI/CD Integration",
  };
}

import express from "express";
import type { WASocket } from "@whiskeysockets/baileys";
import { getConfig } from "../../config/config.js";
import { getEnvConfig } from "../../config/env.js";
import logger from "../../utils/logger.js";
import { formatTimestamp } from "../../utils/format.js";

let server: any = null;

export function startJenkinsServer(sock: WASocket): void {
  const envConfig = getEnvConfig();
  const config = getConfig();

  if (!config.jenkins.enabled) {
    logger.info("Jenkins listener is disabled");
    return;
  }

  if (server) {
    logger.info("Jenkins server already running");
    return;
  }

  const app = express();
  app.use(express.json());

  app.post("/webhook/jenkins", async (req, res) => {
    try {
      const payload = req.body;
      logger.debug({ payload }, "Received Jenkins webhook");

      // Support both our custom curl payload and the official Jenkins Notification Plugin payload
      const job = payload.job || payload.name;
      const buildNumber = payload.buildNumber || payload.build?.number;
      const status =
        payload.status || payload.build?.status || payload.build?.phase;
      const url = payload.build?.full_url || payload.build?.url || payload.url;
      const error = payload.error || "";

      if (!job || !status) {
        // Return explicitly to satisfy TypeScript
        res.status(400).send("Missing job or status");
        return;
      }

      // Determine icon
      let icon = "📌";
      if (status.toLowerCase() === "success") icon = "✅";
      else if (status.toLowerCase() === "failure") icon = "❌";
      else if (status.toLowerCase() === "unstable") icon = "⚠️";
      else if (status.toLowerCase() === "aborted") icon = "🛑";
      else if (
        status.toLowerCase() === "started" ||
        status.toLowerCase() === "running"
      )
        icon = "🚀";

      // Format message
      const lines = [
        `*Build ${status.charAt(0).toUpperCase() + status.slice(1).toLowerCase()}*`,
        "━━━━━━━━━━━━━━",
        `*Job:* ${job} ${icon}`,
        `*Build:* #${buildNumber || "Unknown"}`,
        `*Time:* ${formatTimestamp(new Date())}`,
      ];

      if (url) {
        lines.push(`*URL:* ${url}`);
      }

      if (error) {
        lines.push(`🚨 *Error:* ${error}`);
      }

      lines.push("━━━━━━━━━━━━━━");
      const message = lines.join("\n");

      // Send to subscribed channels
      const jenkinsChannels =
        config.alerts.channels?.filter((c) => c.events.includes("jenkins")) ||
        [];

      for (const channel of jenkinsChannels) {
        try {
          await sock.sendMessage(channel.jid, { text: message });
        } catch (err) {
          logger.error(
            { err },
            "Failed to send Jenkins alert message to channel",
          );
        }
      }

      res.status(200).send("OK");
    } catch (err) {
      logger.error({ err }, "Error processing Jenkins webhook");
      res.status(500).send("Internal Server Error");
    }
  });

  server = app.listen(envConfig.jenkins.port, () => {
    logger.info(
      `Jenkins webhook server listening on port ${envConfig.jenkins.port}`,
    );
  });
}

export function stopJenkinsServer(): void {
  if (server) {
    server.close();
    server = null;
    logger.info("Jenkins webhook server stopped");
  }
}

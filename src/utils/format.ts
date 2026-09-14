import type { PingResult, ServerStats, WireGuardPeer } from "../types/index.js";

// ─── General Formatters ─────────────────────────────────────────────────────

export function formatBytes(bytes: number): string {
  if (bytes === 0) return "0 B";
  const k = 1024;
  const sizes = ["B", "KB", "MB", "GB", "TB"];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return `${(bytes / Math.pow(k, i)).toFixed(1)} ${sizes[i]}`;
}

export function formatUptime(seconds: number): string {
  const days = Math.floor(seconds / 86400);
  const hours = Math.floor((seconds % 86400) / 3600);
  const minutes = Math.floor((seconds % 3600) / 60);

  const parts: string[] = [];
  if (days > 0) parts.push(`${days}d`);
  if (hours > 0) parts.push(`${hours}h`);
  parts.push(`${minutes}m`);

  return parts.join(" ");
}

export function formatTimestamp(date: Date): string {
  return date.toLocaleString("en-IN", {
    timeZone: "Asia/Kolkata",
    day: "2-digit",
    month: "short",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: true,
  });
}

// ─── Ping Formatters ────────────────────────────────────────────────────────

export function formatPingResult(result: PingResult): string {
  const icon = result.status === "up" ? "✅" : "❌";
  const timing =
    result.responseTime !== null ? `(${result.responseTime}ms)` : "(timeout)";
  const code =
    result.statusCode !== null
      ? `→ ${result.statusCode}`
      : `→ ${result.error || "ERR"}`;

  return `${icon} *${result.name}* ${timing}\n   ${result.url} ${code}`;
}

export function formatPingResults(results: PingResult[]): string {
  const upCount = results.filter((r) => r.status === "up").length;
  const lines = results.map(formatPingResult);

  return [
    "📡 *Ping Results*",
    "━━━━━━━━━━━━━━",
    ...lines,
    "━━━━━━━━━━━━━━",
    `${upCount}/${results.length} sites UP`,
  ].join("\n");
}

// ─── Server Stats Formatter ─────────────────────────────────────────────────

export function formatServerStats(stats: ServerStats): string {
  const memPercent = stats.memPercent.toFixed(0);
  const cpuPercent = stats.cpuUsage.toFixed(0);

  return [
    `🖥️ *Server Stats — ${stats.hostname}*`,
    "━━━━━━━━━━━━━━",
    `⚡ *CPU:* ${cpuPercent}% (${stats.cpuCores} cores)`,
    `   ${stats.cpuModel}`,
    `🧠 *RAM:* ${formatBytes(stats.memUsed)} / ${formatBytes(stats.memTotal)} (${memPercent}%)`,
    `💾 *Disk:* ${stats.diskUsed} / ${stats.diskTotal} (${stats.diskPercent})`,
    `⏱️ *Uptime:* ${formatUptime(stats.uptime)}`,
    `📊 *Load:* ${stats.loadAvg.map((l) => l.toFixed(2)).join(", ")}`,
    `🖧 *Platform:* ${stats.platform}`,
    "",
    ...stats.networkInterfaces.map((n) => `🌐 ${n.name}: ${n.address}`),
    "━━━━━━━━━━━━━━",
  ].join("\n");
}

// ─── WireGuard Formatters ───────────────────────────────────────────────────

export function formatWireGuardPeers(peers: WireGuardPeer[]): string {
  if (peers.length === 0) {
    return "🔒 *WireGuard Peers*\n━━━━━━━━━━━━━━━━━━━━━━━━━\nNo peers configured.\n━━━━━━━━━━━━━━━━━━━━━━━━━";
  }

  const shortenHandshake = (hs: string) => {
    if (!hs || hs === "never") return "Never";
    return hs
      .replace(/ seconds?/g, "s")
      .replace(/ minutes?/g, "m")
      .replace(/ hours?/g, "h")
      .replace(/ days?/g, "d")
      .replace(/, /g, " ")
      .replace(/ ago/g, "");
  };

  const peerLines = peers.map((peer, i) => {
    const handshake = shortenHandshake(peer.latestHandshake || "never");
    const transfer =
      peer.transferRx && peer.transferTx
        ? `↓${peer.transferRx.replace(" ", "")} ↑${peer.transferTx.replace(" ", "")}`
        : "None";

    return [
      `*${i + 1}. ${peer.name}*`,
      `IP: ${peer.allowedIps} | ⏱️ ${handshake}`,
      `Data: ${transfer}`,
      `🔑 \`${peer.publicKey.substring(0, 8)}\``,
    ].join("\n");
  });

  return [
    "🔒 *WireGuard Peers*",
    "━━━━━━━━━━━━━━",
    peerLines.join("\n\n"),
    "━━━━━━━━━━━━━━",
    `Total: ${peers.length} peer(s)`,
    "",
    "💡 *Tip:* Use `!wg help` to see management commands.",
  ].join("\n");
}

// ─── Alert Formatters ───────────────────────────────────────────────────────

export function formatAlertDown(
  name: string,
  url: string,
  error: string,
): string {
  return [
    "🚨 *ALERT: Site DOWN*",
    "━━━━━━━━━━━━━━",
    `❌ *${name}*`,
    `   ${url}`,
    `   Error: ${error}`,
    `   Time: ${formatTimestamp(new Date())}`,
    "━━━━━━━━━━━━━━",
  ].join("\n");
}

export function formatAlertUp(
  name: string,
  url: string,
  responseTime: number,
): string {
  return [
    "✅ *RECOVERED: Site UP*",
    "━━━━━━━━━━━━━━",
    `✅ *${name}*`,
    `   ${url}`,
    `   Response: ${responseTime}ms`,
    `   Time: ${formatTimestamp(new Date())}`,
    "━━━━━━━━━━━━━━",
  ].join("\n");
}

// ─── Help Formatter ─────────────────────────────────────────────────────────

export function formatHelp(prefix: string): string {
  return [
    "🤖 *Hana — Commands*",
    "━━━━━━━━━━━━━━",
    "",
    "📡 *Monitoring*",
    `- \`${prefix}ping\` _[url]_ : Ping sites`,
    `- \`${prefix}sites\` : List monitored sites`,
    `- \`${prefix}addsite\` / \`${prefix}rmsite\` : Manage sites (Admin)`,
    "",
    "🖥️ *Server*",
    `- \`${prefix}servers\` : List external servers`,
    `- \`${prefix}stats\` : Local server stats`,
    `- \`${prefix}stats\` _[name]_ : External server stats (e.g. pi5)`,
    "",
    "🌤️ *Weather*",
    `- \`${prefix}weather\` : Show local weather & AQI`,
    "",
    "🔒 *WireGuard VPN*",
    `- \`${prefix}wg\` : Manage peers (& more)`,
    "",
    "🔔 *Alerts* (Admin Only)",
    `- \`${prefix}alerts\` : Manage alerts (& more)`,
    "",
    "👥 *Whitelist & Admins* (Admin Only)",
    `- \`${prefix}whitelist\` : Manage users (& more)`,
    "",
    "🏗️ *Jenkins CI/CD* (Admin Only)",
    `- \`${prefix}jenkins\` : Manage Jenkins webhooks (& more)`,
    "",
    "🧰 *Tools*",
    `- \`${prefix}tools\` : Show all available utility tools`,
    "",
    "⏰ *Reminders*",
    `- \`${prefix}remind\` _<time>_ _<msg>_ : Set a manual reminder`,
    `- \`${prefix}reminders\` : List or delete reminders`,
    "",
    "🤖 *AI*",
    `- \`${prefix}hana\` _<question>_ : Ask AI a question`,
    "💡 _Tip: Hana can also process bulk files (PDFs, images). See_ `!tools`",
    "",
    `- \`${prefix}help\` : Show this message`,
    "━━━━━━━━━━━━━━",
  ].join("\n");
}

/**
 * Format external server stats from the custom API format.
 */
export function formatExternalServerStats(data: any): string {
  const lines = [
    `🖥️ *External Server: ${data.hostname || "Unknown"}*`,
    "━━━━━━━━━━━━━━",
    `⏱️ *Uptime:* ${formatUptime(data.uptime_seconds || 0)}`,
    `🌡️ *Temp:* ${data.temperature ? data.temperature + "°C" : "N/A"}`,
    `📈 *Load:* ${data.load ? data.load.map((l: number) => l.toFixed(2)).join(", ") : "N/A"}`,
    "",
    "📊 *Resource Usage*",
    `CPU: ${data.cpu_percent || 0}%`,
    `RAM: ${formatBytes(data.ram_used || 0)} / ${formatBytes(data.ram_total || 0)} (${data.ram_percent || 0}%)`,
    `Disk: ${formatBytes(data.disk_used || 0)} / ${formatBytes(data.disk_total || 0)} (${data.disk_percent || 0}%)`,
    "",
  ];

  if (data.services?.docker && data.services.docker.length > 0) {
    lines.push("🐳 *Docker Containers*");
    const running = data.services.docker.filter(
      (c: any) => c.State === "running",
    ).length;
    const total = data.services.docker.length;
    lines.push(`Running: ${running}/${total}`);
    lines.push("");
  }

  if (data.services?.pm2 && data.services.pm2.length > 0) {
    lines.push("🚀 *PM2 Processes*");
    const online = data.services.pm2.filter(
      (p: any) => p.status === "online",
    ).length;
    const total = data.services.pm2.length;
    lines.push(`Online: ${online}/${total}`);
  }

  return lines.join("\n");
}

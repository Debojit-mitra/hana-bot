import {
  searchLocation,
  getWeatherData,
  getAirQuality,
} from "../../weather/weather.service.js";
import { WeatherProfileModel } from "../../../db/models/WeatherProfile.js";
import type { AITool } from "../ai.tools.js";

/**
 * Helper: resolve location from args or the user's saved weather profile.
 * Returns { lat, lon, name, timezone } or an error string.
 */
async function resolveLocation(args: any, ctx: any) {
  // If the user explicitly provided a location, geocode it
  if (args.location) {
    const loc = await searchLocation(args.location);
    if (!loc)
      return { error: `Could not find location matching '${args.location}'` };
    const name = loc.admin1
      ? `${loc.name}, ${loc.admin1}, ${loc.country}`
      : `${loc.name}, ${loc.country}`;
    return {
      lat: loc.latitude,
      lon: loc.longitude,
      name,
      timezone: loc.timezone,
    };
  }

  // No location provided — check the user's saved weather profile
  if (ctx?.jid) {
    const profile = await WeatherProfileModel.findOne({ jid: ctx.jid });
    if (profile) {
      return {
        lat: profile.latitude,
        lon: profile.longitude,
        name: profile.locationName,
        timezone: profile.timezone,
      };
    }
  }

  // No location and no profile — tell the AI to ask the user
  return {
    error:
      "NO_LOCATION_SET: The user has not specified a location and has no saved weather profile. You MUST ask the user which city they want the weather for. Do NOT guess or assume any location.",
  };
}

export const weatherTools: AITool[] = [
  {
    name: "get_weather",
    description: `Get the current weather, today's forecast, and Air Quality (AQI) all at once. If the user specifies a city, pass it as 'location'. If they don't specify a city, omit 'location' and the tool will check their saved profile. NEVER guess or assume a location yourself. CRITICAL: Use the returned weather and AQI data to provide a comprehensive daily forecast and relevant, actionable recommendations when warranted. UV index > 6 requires sun-protection advice; rain probability > 50% requires rain-preparation advice; AQI > 100 requires mask advice. 

CRITICAL FORMATTING RULE: You MUST always output weather/briefings EXACTLY in this format (do not use markdown tables or pipes '|' for layout borders, use the exact blockquotes as shown):

*☀️ Good Morning!*
Your our daily weather briefing for today:

> Temperature: [Temp]°C (Feels like [Feels Like]°C)
> [Weather Condition]
> Humidity: [Humidity]%
> Wind: [Wind Speed] km/h

*📅 Today's Forecast:*
> High: [High]°C / Low: [Low]°C
> Rain Probability: [Rain]%
> UV Index: [UV]
> Sunrise / Sunset: [Sunrise] / [Sunset]

*🍃 Air Quality:*
> US AQI: [AQI] ([Category])
> PM2.5: [PM2.5] / PM10: [PM10]

*📢 Smart Recommendations:*
> UV: [Short, punchy advice, e.g. "Wear sunscreen!"]
> Rain: [Short, punchy advice, e.g. "Grab an umbrella!"]
> Air: [Short, punchy advice, e.g. "Wear a mask!"]
(CRITICAL: Omit alerts for safe conditions. Do NOT repeat the exact data values here, just provide the advice).`,
    parameters: {
      type: "OBJECT",
      properties: {
        location: {
          type: "STRING",
          description:
            "OPTIONAL. The city or location name. Only provide this if the user explicitly mentioned a city. Do NOT guess.",
        },
      },
    },
    execute: async (args: any, ctx: any) => {
      const resolved = await resolveLocation(args, ctx);
      if ("error" in resolved) return resolved;

      const [weather, aqi] = await Promise.all([
        getWeatherData(resolved.lat, resolved.lon, resolved.timezone),
        getAirQuality(resolved.lat, resolved.lon, resolved.timezone),
      ]);

      if (!weather) return { error: "Failed to fetch weather data." };

      return {
        location_found: resolved.name,
        timezone: resolved.timezone,
        current_weather: weather.current,
        daily_forecast: weather.daily,
        air_quality: aqi || "Failed to fetch AQI",
      };
    },
  },
  {
    name: "get_air_quality",
    description:
      "Get the current Air Quality Index (AQI), PM2.5, PM10, and ozone levels. Use this if the user specifically asks ONLY for air quality. (Note: get_weather already includes AQI).",
    parameters: {
      type: "OBJECT",
      properties: {
        location: {
          type: "STRING",
          description:
            "OPTIONAL. The city or location name. Only provide this if the user explicitly mentioned a city. Do NOT guess.",
        },
      },
    },
    execute: async (args: any, ctx: any) => {
      const resolved = await resolveLocation(args, ctx);
      if ("error" in resolved) return resolved;

      const aqi = await getAirQuality(
        resolved.lat,
        resolved.lon,
        resolved.timezone,
      );
      if (!aqi) return { error: "Failed to fetch AQI data." };

      return {
        location_found: resolved.name,
        air_quality: aqi,
      };
    },
  },
  {
    name: "get_weather_config",
    description: `Check the current weather configuration for this chat. Use this when the user asks if weather alerts, briefings, or a location are set up. Always call this tool FIRST before answering questions about weather settings.

IMPORTANT CONTEXT about weather features (use this knowledge when answering user questions):

1. *Daily Briefings*: Sent automatically at the user's configured hour (default 8 AM). Uses the full weather briefing format with forecast, AQI, and recommendations.

2. *Smart Weather Alerts*: These are DIFFERENT from briefings. They run automatically every 3 hours in the background and ONLY fire when dangerous conditions are detected. They have a 12-hour cooldown to prevent spam. The triggers are:
   - 🌧️ Rain probability >= 70% in the next 12 hours (only if it's not already raining)
   - ☀️ UV Index >= 8 (Very High) expected today (only before 3 PM)
   - ⚠️ AQI > 150 (Unhealthy)

When an alert fires, the message format looks EXACTLY like this (NO blockquotes, NO '>' prefix — just plain text with emojis). You MUST reproduce this EXACTLY when asked to show an example:

🚨 *Smart Weather Alert: [Location]*

🌧️ *Rain*: High chance of rain around *[time]* — grab an umbrella!
☀️ *UV*: Index will hit *[value]* (Very High) — wear sunscreen!
⚠️ *Air Quality*: AQI is *[value]* (Unhealthy) — consider staying indoors or wearing a mask.

(Only the relevant alerts appear — if only rain is detected, only the rain line shows.)

If the user asks what alerts look like or how they work, show the example like this:
1. Start with a brief intro, e.g. "Here is an example of what a *Smart Weather Alert* looks like when dangerous conditions are automatically detected in *[Location]*:"
2. Then reproduce the EXACT alert format above (with real or example values). Do NOT use blockquotes (>) for the alert content.
3. End with a note: "(Note: Only the relevant alerts appear depending on what is triggered — if only rain is detected, only the rain line shows.)"

Do NOT send a normal weather briefing as an example of an alert.`,
    parameters: {
      type: "OBJECT",
      properties: {},
    },
    execute: async (_args: any, ctx: any) => {
      if (!ctx?.jid) return { error: "No chat context available." };

      const profile = await WeatherProfileModel.findOne({ jid: ctx.jid });
      if (!profile) {
        return {
          configured: false,
          message:
            "No weather profile is set up for this chat. Ask the user if they'd like to configure one.",
        };
      }

      const hour = profile.briefingHour ?? 8;
      const timeStr = `${hour === 0 ? "12" : hour > 12 ? hour - 12 : hour}:00 ${hour < 12 ? "AM" : "PM"}`;
      return {
        configured: true,
        location: profile.locationName,
        daily_briefing: profile.dailyBriefing ?? false,
        smart_alerts: profile.smartAlerts ?? false,
        briefing_time: timeStr,
      };
    },
  },
  {
    name: "configure_weather_profile",
    description:
      "Set or update the user's weather profile for this chat. A location MUST be set before alerts can be enabled — if no profile exists yet, always ask the user for their city first. Once a profile exists, you can toggle alerts/briefings without re-specifying the location.",
    parameters: {
      type: "OBJECT",
      properties: {
        location: {
          type: "STRING",
          description:
            "The city or location name. REQUIRED when creating a new profile. Can be omitted when only toggling alerts on an existing profile.",
        },
        enable_alerts: {
          type: "BOOLEAN",
          description:
            "Set to true to enable daily briefings and smart alerts, false to disable. Only set if the user explicitly requests it.",
        },
        briefing_hour: {
          type: "NUMBER",
          description:
            "OPTIONAL. The hour (0-23) at which to send the daily briefing. Only set if the user specifies a time. Defaults to 8 (8 AM).",
        },
      },
    },
    execute: async (args: any, ctx: any) => {
      if (!ctx?.jid) return { error: "No chat context available." };

      // If no location given, try to update existing profile
      if (!args.location) {
        const existing = await WeatherProfileModel.findOne({ jid: ctx.jid });
        if (!existing) {
          return {
            error:
              "No weather profile exists for this chat yet. Please provide a location first.",
          };
        }

        const updates: any = {};
        if (args.enable_alerts !== undefined) {
          updates.dailyBriefing = args.enable_alerts;
          updates.smartAlerts = args.enable_alerts;
        }
        if (
          args.briefing_hour !== undefined &&
          args.briefing_hour >= 0 &&
          args.briefing_hour <= 23
        ) {
          updates.briefingHour = Math.floor(args.briefing_hour);
        }

        if (Object.keys(updates).length === 0) {
          return {
            error: "Nothing to update. Provide enable_alerts or briefing_hour.",
          };
        }

        await WeatherProfileModel.findOneAndUpdate({ jid: ctx.jid }, updates);

        const hour = updates.briefingHour ?? existing.briefingHour ?? 8;
        const timeStr = `${hour === 0 ? "12" : hour > 12 ? hour - 12 : hour}:00 ${hour < 12 ? "AM" : "PM"}`;
        const alertsOn =
          updates.dailyBriefing ?? existing.dailyBriefing ?? false;
        return {
          success: true,
          location: existing.locationName,
          alerts_enabled: alertsOn,
          briefing_time: timeStr,
          message: alertsOn
            ? `Settings updated! Daily briefings at ${timeStr} and smart alerts are now *ON* for ${existing.locationName}.`
            : `Settings updated! Alerts and briefings are now *OFF* for ${existing.locationName}.`,
        };
      }

      const loc = await searchLocation(args.location);
      if (!loc)
        return { error: `Could not find location matching '${args.location}'` };

      const fullName = loc.admin1
        ? `${loc.name}, ${loc.admin1}, ${loc.country}`
        : `${loc.name}, ${loc.country}`;
      const enable = args.enable_alerts === true;
      const hour =
        args.briefing_hour !== undefined &&
        args.briefing_hour >= 0 &&
        args.briefing_hour <= 23
          ? Math.floor(args.briefing_hour)
          : 8;

      await WeatherProfileModel.findOneAndUpdate(
        { jid: ctx.jid },
        {
          latitude: loc.latitude,
          longitude: loc.longitude,
          locationName: fullName,
          timezone: loc.timezone || "auto",
          dailyBriefing: enable,
          smartAlerts: enable,
          briefingHour: hour,
        },
        { upsert: true, new: true },
      );

      const timeStr = `${hour === 0 ? "12" : hour > 12 ? hour - 12 : hour}:00 ${hour < 12 ? "AM" : "PM"}`;
      return {
        success: true,
        location: fullName,
        alerts_enabled: enable,
        briefing_time: timeStr,
        message: enable
          ? `Location set to ${fullName}. Daily briefings at ${timeStr} and smart alerts are ON.`
          : `Location set to ${fullName}. Alerts are OFF. Ask the user if they'd like to enable daily weather briefings and smart weather alerts.`,
      };
    },
  },
];

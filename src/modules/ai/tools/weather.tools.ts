import { searchLocation, getWeatherData, getAirQuality } from '../../weather/weather.service.js';
import { WeatherProfileModel } from '../../../db/models/WeatherProfile.js';
import type { AITool } from '../ai.tools.js';

/**
 * Helper: resolve location from args or the user's saved weather profile.
 * Returns { lat, lon, name, timezone } or an error string.
 */
async function resolveLocation(args: any, ctx: any) {
    // If the user explicitly provided a location, geocode it
    if (args.location) {
        const loc = await searchLocation(args.location);
        if (!loc) return { error: `Could not find location matching '${args.location}'` };
        const name = loc.admin1 ? `${loc.name}, ${loc.admin1}, ${loc.country}` : `${loc.name}, ${loc.country}`;
        return { lat: loc.latitude, lon: loc.longitude, name, timezone: loc.timezone };
    }

    // No location provided — check the user's saved weather profile
    if (ctx?.jid) {
        const profile = await WeatherProfileModel.findOne({ jid: ctx.jid });
        if (profile) {
            return { lat: profile.latitude, lon: profile.longitude, name: profile.locationName, timezone: profile.timezone };
        }
    }

    // No location and no profile — tell the AI to ask the user
    return { error: "NO_LOCATION_SET: The user has not specified a location and has no saved weather profile. You MUST ask the user which city they want the weather for. Do NOT guess or assume any location." };
}

export const weatherTools: AITool[] = [
    {
        name: "get_weather",
        description: "Get the current weather and forecast. If the user specifies a city, pass it as 'location'. If they don't specify a city, omit 'location' and the tool will check their saved profile. NEVER guess or assume a location yourself.",
        parameters: {
            type: "OBJECT",
            properties: {
                location: { type: "STRING", description: "OPTIONAL. The city or location name. Only provide this if the user explicitly mentioned a city. Do NOT guess." }
            }
        },
        execute: async (args: any, ctx: any) => {
            const resolved = await resolveLocation(args, ctx);
            if ('error' in resolved) return resolved;

            const weather = await getWeatherData(resolved.lat, resolved.lon, resolved.timezone);
            if (!weather) return { error: "Failed to fetch weather data." };

            return {
                location_found: resolved.name,
                timezone: resolved.timezone,
                current_weather: weather.current,
                daily_forecast: weather.daily
            };
        }
    },
    {
        name: "get_air_quality",
        description: "Get the current Air Quality Index (AQI), PM2.5, PM10, and ozone levels. If the user specifies a city, pass it as 'location'. If they don't, omit 'location' and the tool will check their saved profile. NEVER guess or assume a location yourself.",
        parameters: {
            type: "OBJECT",
            properties: {
                location: { type: "STRING", description: "OPTIONAL. The city or location name. Only provide this if the user explicitly mentioned a city. Do NOT guess." }
            }
        },
        execute: async (args: any, ctx: any) => {
            const resolved = await resolveLocation(args, ctx);
            if ('error' in resolved) return resolved;

            const aqi = await getAirQuality(resolved.lat, resolved.lon, resolved.timezone);
            if (!aqi) return { error: "Failed to fetch AQI data." };

            return {
                location_found: resolved.name,
                air_quality: aqi
            };
        }
    },
    {
        name: "configure_weather_profile",
        description: "Set the user's default location for weather lookups. This ONLY saves the location — it does NOT enable alerts or briefings by default. After saving, ask the user if they would also like to enable daily briefings and smart weather alerts. Only set enable_alerts to true if the user explicitly agrees.",
        parameters: {
            type: "OBJECT",
            properties: {
                location: { type: "STRING", description: "The name of the city to set as their default" },
                enable_alerts: { type: "BOOLEAN", description: "Set to true ONLY if the user explicitly asked for daily briefings / smart alerts. Defaults to false." },
                briefing_hour: { type: "NUMBER", description: "OPTIONAL. The hour (0-23) at which to send the daily briefing. Only set if the user specifies a time. Defaults to 8 (8 AM)." }
            },
            required: ["location"]
        },
        execute: async (args: any, ctx: any) => {
            if (!ctx?.jid) return { error: "No chat context available." };

            const loc = await searchLocation(args.location);
            if (!loc) return { error: `Could not find location matching '${args.location}'` };

            const fullName = loc.admin1 ? `${loc.name}, ${loc.admin1}, ${loc.country}` : `${loc.name}, ${loc.country}`;
            const enable = args.enable_alerts === true;
            const hour = (args.briefing_hour !== undefined && args.briefing_hour >= 0 && args.briefing_hour <= 23) 
                ? Math.floor(args.briefing_hour) 
                : 8;

            await WeatherProfileModel.findOneAndUpdate(
                { jid: ctx.jid },
                { 
                    latitude: loc.latitude, 
                    longitude: loc.longitude,
                    locationName: fullName,
                    timezone: loc.timezone || 'auto',
                    dailyBriefing: enable,
                    smartAlerts: enable,
                    briefingHour: hour
                },
                { upsert: true, new: true }
            );

            const timeStr = `${hour === 0 ? '12' : hour > 12 ? hour - 12 : hour}:00 ${hour < 12 ? 'AM' : 'PM'}`;
            return {
                success: true,
                location: fullName,
                alerts_enabled: enable,
                briefing_time: timeStr,
                message: enable
                    ? `Location set to ${fullName}. Daily briefings at ${timeStr} and smart alerts are ON.`
                    : `Location set to ${fullName}. Alerts are OFF. Ask the user if they'd like to enable daily weather briefings and smart weather alerts.`
            };
        }
    }
];


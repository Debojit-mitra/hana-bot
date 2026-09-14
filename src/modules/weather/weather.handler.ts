import type { CommandContext, ModuleRegistration } from '../../types/index.js';
import { WeatherProfileModel } from '../../db/models/WeatherProfile.js';
import { searchLocation, getWeatherData, getAirQuality, getWeatherDescription, getAqiDescription } from './weather.service.js';

export function createWeatherModule(): ModuleRegistration {
    const commands = new Map();

    commands.set('weather', async (ctx: CommandContext) => {
        if (ctx.args.length === 0) {
            // Check if profile exists
            const profile = await WeatherProfileModel.findOne({ jid: ctx.jid });
            if (!profile) {
                await ctx.reply('❌ No location set for this chat.\nUse `!weather set <city>` or ask Hana to set it up.');
                return;
            }

            await ctx.react('⏳');
            
            const [weather, aqi] = await Promise.all([
                getWeatherData(profile.latitude, profile.longitude, profile.timezone),
                getAirQuality(profile.latitude, profile.longitude, profile.timezone)
            ]);

            if (!weather || !aqi) {
                await ctx.react('❌');
                await ctx.reply('❌ Failed to fetch weather data from Open-Meteo API.');
                return;
            }

            const wDesc = getWeatherDescription(weather.current.weather_code);
            const aqiDesc = getAqiDescription(aqi.us_aqi);

            const msg = [
                `🌤️ *Weather for ${profile.locationName}*`,
                '━━━━━━━━━━━━━━━━━━',
                `${wDesc.emoji} *${wDesc.text}*`,
                `- *Temp:* ${weather.current.temperature}°C (Feels like ${weather.current.feels_like}°C)`,
                `- *Humidity:* ${weather.current.humidity}%`,
                `- *Wind:* ${weather.current.wind_speed} km/h`,
                '',
                `🌬️ *Air Quality (US AQI):* ${aqi.us_aqi} ${aqiDesc.emoji}`,
                `- *Level:* ${aqiDesc.text}`,
                `- *PM2.5:* ${aqi.pm2_5} µg/m³`,
                '━━━━━━━━━━━━━━━━━━',
                `_Alerts: ${profile.smartAlerts ? '✅' : '❌'} | Briefing: ${profile.dailyBriefing ? `✅ ${profile.briefingHour === 0 ? '12' : profile.briefingHour > 12 ? profile.briefingHour - 12 : profile.briefingHour}:00 ${profile.briefingHour < 12 ? 'AM' : 'PM'}` : '❌'}_`
            ].join('\n');

            await ctx.react('');
            await ctx.reply(msg);
            return;
        }

        const subcommand = ctx.args[0].toLowerCase();

        if (subcommand === 'set') {
            const query = ctx.args.slice(1).join(' ');
            if (!query) {
                await ctx.reply('❌ Usage: `!weather set <city name>`');
                return;
            }

            await ctx.react('⏳');
            const loc = await searchLocation(query);
            
            if (!loc) {
                await ctx.react('❌');
                await ctx.reply(`❌ Could not find location: "${query}"`);
                return;
            }

            const fullName = loc.admin1 ? `${loc.name}, ${loc.admin1}, ${loc.country}` : `${loc.name}, ${loc.country}`;

            await WeatherProfileModel.findOneAndUpdate(
                { jid: ctx.jid },
                { 
                    latitude: loc.latitude, 
                    longitude: loc.longitude,
                    locationName: fullName,
                    timezone: loc.timezone || 'auto',
                    dailyBriefing: false,
                    smartAlerts: false
                },
                { upsert: true, new: true }
            );

            await ctx.react('✅');
            await ctx.reply(`✅ Location set to *${fullName}*!\n\nUse \`!weather alerts on\` to enable 8 AM daily briefings and smart weather alerts.`);
            return;
        }

        if (subcommand === 'alerts') {
            const profile = await WeatherProfileModel.findOne({ jid: ctx.jid });
            if (!profile) {
                await ctx.reply('❌ No location set. Use `!weather set <city>` first.');
                return;
            }

            const action = ctx.args[1]?.toLowerCase();
            if (action === 'on' || action === 'off') {
                const state = action === 'on';
                profile.smartAlerts = state;
                profile.dailyBriefing = state;
                await profile.save();
                await ctx.reply(`✅ Weather alerts and briefings have been turned *${action}*.`);
            } else {
                await ctx.reply(
                    '⚙️ *Weather Alerts*\n' +
                    '━━━━━━━━━━━━━━━━━━\n' +
                    'Usage:\n' +
                    '  - `!weather alerts on` : Enable 8 AM briefings & smart alerts\n' +
                    '  - `!weather alerts off` : Disable them'
                );
            }
            return;
        }

        if (subcommand === 'time') {
            const profile = await WeatherProfileModel.findOne({ jid: ctx.jid });
            if (!profile) {
                await ctx.reply('❌ No location set. Use `!weather set <city>` first.');
                return;
            }

            const hourStr = ctx.args[1];
            const hour = parseInt(hourStr, 10);
            if (isNaN(hour) || hour < 0 || hour > 23) {
                await ctx.reply('❌ Usage: `!weather time <0-23>`\nExample: `!weather time 7` for 7:00 AM');
                return;
            }

            profile.briefingHour = hour;
            await profile.save();

            const timeStr = `${hour === 0 ? '12' : hour > 12 ? hour - 12 : hour}:00 ${hour < 12 ? 'AM' : 'PM'}`;
            await ctx.reply(`✅ Daily briefing time set to *${timeStr}*.`);
            return;
        }

        if (subcommand === 'help') {
            await ctx.reply(
                '🌤️ *Weather*\n' +
                '━━━━━━━━━━━━━━━━━━\n' +
                'Usage:\n' +
                '  - `!weather` : Show current weather & AQI\n' +
                '  - `!weather set` _<city>_ : Set default location\n' +
                '  - `!weather alerts on/off` : Toggle automatic alerts\n' +
                '  - `!weather time` _<hour>_ : Set briefing time (e.g. `!weather time 7`)\n' +
                '━━━━━━━━━━━━━━━━━━\n' +
                '_Tip: You can also just ask Hana! (e.g. "Hana, set my weather to London")_'
            );
            return;
        }
    });

    return {
        name: 'Weather',
        description: 'Weather profiles and current conditions',
        commands
    };
}

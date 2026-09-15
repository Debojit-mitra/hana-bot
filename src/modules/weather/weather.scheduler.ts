import { schedule, ScheduledTask } from 'node-cron';
import logger from '../../utils/logger.js';
import { getSocket } from '../../core/socket.js';
import { WeatherProfileModel, IWeatherProfileDoc } from '../../db/models/WeatherProfile.js';
import { getWeatherData, getAirQuality } from './weather.service.js';
import { getAIProvider } from '../ai/ai.provider.js';

let dailyJob: ScheduledTask | null = null;
let alertJob: ScheduledTask | null = null;

async function sendDailyBriefings() {
    const currentHour = new Date().getHours();
    const profiles = await WeatherProfileModel.find({ dailyBriefing: true, briefingHour: currentHour });
    
    if (profiles.length === 0) return;
    
    logger.info({ hour: currentHour, count: profiles.length }, 'Sending daily weather briefings');

    const sock = getSocket();
    if (!sock) {
        logger.error('Cannot send briefings: no WhatsApp socket connection');
        return;
    }

    const aiProvider = getAIProvider();

    for (const profile of profiles) {
        try {
            const [weather, aqi] = await Promise.all([
                getWeatherData(profile.latitude, profile.longitude, profile.timezone),
                getAirQuality(profile.latitude, profile.longitude, profile.timezone)
            ]);

            if (!weather || !aqi) continue;

            const prompt = `
Generate a friendly, concise morning weather briefing for ${profile.locationName}. 
Here is the raw data:
Weather: ${JSON.stringify(weather.current)}
Daily Forecast: ${JSON.stringify({ max: weather.daily.temperature_2m_max[0], min: weather.daily.temperature_2m_min[0], uv: weather.daily.uv_index_max[0], precip: weather.daily.precipitation_probability_max[0] })}
AQI: ${JSON.stringify(aqi)}

Keep it short (3-4 sentences max), engaging, and formatted for WhatsApp (use *bold* and emojis).
CRITICAL: You MUST explicitly include actionable recommendations! If UV is > 6, explicitly remind them to wear sunscreen. If Rain is > 50%, explicitly remind them to take an umbrella. If AQI is > 100, explicitly recommend a mask.
Do not include standard greetings like "Hey there", just jump straight into the briefing!
`;
            
            // Provide a minimal context
            const briefing = await aiProvider.ask(prompt, "You are generating a daily morning weather briefing for a user. Be concise, direct, and witty.", 'weather_cron');
            
            await sock.sendMessage(profile.jid, { text: `🌅 *Morning Briefing: ${profile.locationName}*\n\n${briefing}` });
            
            // Be kind to rate limits
            await new Promise(resolve => setTimeout(resolve, 2000));
        } catch (err) {
            logger.error({ err, jid: profile.jid }, 'Failed to send daily briefing');
        }
    }
}

async function checkSmartAlerts() {
    logger.info('Running smart weather alerts check');
    const profiles = await WeatherProfileModel.find({ smartAlerts: true });
    
    if (profiles.length === 0) return;

    const sock = getSocket();
    if (!sock) return;

    const now = new Date();
    const COOLDOWN_HOURS = 12;

    for (const profile of profiles) {
        try {
            // Check if we recently alerted them (prevent spam)
            if (profile.lastAlertSentAt) {
                const hoursSinceLast = (now.getTime() - profile.lastAlertSentAt.getTime()) / (1000 * 60 * 60);
                if (hoursSinceLast < COOLDOWN_HOURS) {
                    continue;
                }
            }

            const [weather, aqi] = await Promise.all([
                getWeatherData(profile.latitude, profile.longitude, profile.timezone),
                getAirQuality(profile.latitude, profile.longitude, profile.timezone)
            ]);

            if (!weather || !aqi) continue;

            const alerts: string[] = [];

            // Check AQI
            if (aqi.us_aqi > 150) {
                alerts.push(`⚠️ *Air Quality*: AQI is *${aqi.us_aqi}* (Unhealthy) — consider staying indoors or wearing a mask.`);
            }

            // Check next 12 hours for sudden rain or extreme UV
            const hourly = weather.hourly;
            if (hourly && hourly.time && hourly.time.length > 0) {
                let rainTime = '';
                let peakUv = 0;

                // Open-Meteo returns hourly data starting from 00:00 today. We need to find the index for "now".
                // We'll just check the first 12 hours that are in the future based on their timezone
                // A simpler heuristic: look at the next 12 items in the array assuming the API aligns with current time (it usually doesn't perfectly, but this is a simplified version)
                // Actually, Open-Meteo current time can be found in `current.time`. We'll find that index in `hourly.time`.
                const currentTime = weather.current.time;
                let startIndex = hourly.time.findIndex((t: string) => t === currentTime);
                if (startIndex === -1) startIndex = 0;
                
                const endIndex = Math.min(startIndex + 12, hourly.time.length);

                for (let i = startIndex; i < endIndex; i++) {
                    const prob = hourly.precipitation_probability[i];
                    const uv = hourly.uv_index[i];
                    const timeStr = new Date(hourly.time[i]).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });

                    if (prob >= 70 && !rainTime) {
                        rainTime = timeStr;
                    }
                    if (uv > peakUv) {
                        peakUv = uv;
                    }
                }

                if (rainTime && weather.current.precipitation === 0) {
                    alerts.push(`🌧️ *Rain*: High chance of rain around *${rainTime}* — grab an umbrella!`);
                }
                
                if (peakUv >= 8 && (new Date().getHours() < 15)) {
                    alerts.push(`☀️ *UV*: Index will hit *${peakUv}* (Very High) — wear sunscreen!`);
                }
            }

            if (alerts.length > 0) {
                const msg = `🚨 *Smart Weather Alert: ${profile.locationName}*\n\n${alerts.join('\n\n')}`;
                await sock.sendMessage(profile.jid, { text: msg });
                
                profile.lastAlertSentAt = new Date();
                await profile.save();
                
                await new Promise(resolve => setTimeout(resolve, 2000));
            }

        } catch (err) {
            logger.error({ err, jid: profile.jid }, 'Failed to process smart alerts');
        }
    }
}

export function startWeatherScheduler() {
    // Run every hour at :00 — the function itself filters by each user's briefingHour
    dailyJob = schedule('0 * * * *', () => {
        sendDailyBriefings().catch(err => logger.error({ err }, 'Daily briefing job failed'));
    });

    // Run every 3 hours (e.g. 0, 3, 6, 9, 12, 15, 18, 21)
    alertJob = schedule('0 */3 * * *', () => {
        checkSmartAlerts().catch(err => logger.error({ err }, 'Smart alerts job failed'));
    });

    logger.info('Weather scheduler started (Briefings: Hourly check, Alerts: Every 3h)');
}

export function stopWeatherScheduler() {
    if (dailyJob) {
        dailyJob.stop();
        dailyJob = null;
    }
    if (alertJob) {
        alertJob.stop();
        alertJob = null;
    }
    logger.info('Weather scheduler stopped');
}

import logger from '../../utils/logger.js';

const GEO_URL = 'https://geocoding-api.open-meteo.com/v1/search';
const WEATHER_URL = 'https://api.open-meteo.com/v1/forecast';
const AQI_URL = 'https://air-quality-api.open-meteo.com/v1/air-quality';

/**
 * Helper to fetch with exponential backoff for rate limits or 503s on free APIs.
 */
async function fetchWithRetry(url: string, retries = 2): Promise<Response> {
    let lastErr: Error | null = null;
    for (let i = 0; i <= retries; i++) {
        try {
            const res = await fetch(url);
            if (res.ok) return res;
            if (res.status !== 503 && res.status !== 429 && res.status >= 500) {
                // If it's 429 or 503 we definitely want to retry. If it's other 5xx we might also retry.
            }
            lastErr = new Error(`API error: ${res.status}`);
            
            // Wait before retry (500ms, 1000ms...)
            if (i < retries) await new Promise(r => setTimeout(r, 500 * (i + 1)));
        } catch (err: any) {
            lastErr = err;
            if (i < retries) await new Promise(r => setTimeout(r, 500 * (i + 1)));
        }
    }
    throw lastErr;
}

export interface LocationResult {
    id: number;
    name: string;
    latitude: number;
    longitude: number;
    country: string;
    admin1?: string; // State/Province
    timezone: string;
}

export interface CurrentWeather {
    temperature: number;
    feels_like: number;
    humidity: number;
    precipitation: number;
    cloud_cover: number;
    wind_speed: number;
    weather_code: number;
    is_day: number;
    time: string;
}

export interface DailyForecast {
    time: string[];
    weather_code: number[];
    temperature_2m_max: number[];
    temperature_2m_min: number[];
    sunrise: string[];
    sunset: string[];
    uv_index_max: number[];
    precipitation_probability_max: number[];
}

export interface AirQuality {
    pm2_5: number;
    pm10: number;
    carbon_monoxide: number;
    nitrogen_dioxide: number;
    ozone: number;
    european_aqi: number;
    us_aqi: number;
}

/**
 * Maps standard WMO weather codes to emojis and text descriptions.
 */
export function getWeatherDescription(code: number): { emoji: string, text: string } {
    const map: Record<number, { emoji: string, text: string }> = {
        0: { emoji: '☀️', text: 'Clear sky' },
        1: { emoji: '🌤️', text: 'Mainly clear' },
        2: { emoji: '⛅', text: 'Partly cloudy' },
        3: { emoji: '☁️', text: 'Overcast' },
        45: { emoji: '🌫️', text: 'Fog' },
        48: { emoji: '🌫️', text: 'Depositing rime fog' },
        51: { emoji: '🌧️', text: 'Light drizzle' },
        53: { emoji: '🌧️', text: 'Moderate drizzle' },
        55: { emoji: '🌧️', text: 'Dense drizzle' },
        56: { emoji: '🌧️', text: 'Light freezing drizzle' },
        57: { emoji: '🌧️', text: 'Dense freezing drizzle' },
        61: { emoji: '🌧️', text: 'Slight rain' },
        63: { emoji: '🌧️', text: 'Moderate rain' },
        65: { emoji: '🌧️', text: 'Heavy rain' },
        66: { emoji: '🌧️', text: 'Light freezing rain' },
        67: { emoji: '🌧️', text: 'Heavy freezing rain' },
        71: { emoji: '🌨️', text: 'Slight snow fall' },
        73: { emoji: '🌨️', text: 'Moderate snow fall' },
        75: { emoji: '🌨️', text: 'Heavy snow fall' },
        77: { emoji: '❄️', text: 'Snow grains' },
        80: { emoji: '🌧️', text: 'Slight rain showers' },
        81: { emoji: '🌧️', text: 'Moderate rain showers' },
        82: { emoji: '🌧️', text: 'Violent rain showers' },
        85: { emoji: '🌨️', text: 'Slight snow showers' },
        86: { emoji: '🌨️', text: 'Heavy snow showers' },
        95: { emoji: '⛈️', text: 'Thunderstorm' },
        96: { emoji: '⛈️', text: 'Thunderstorm with slight hail' },
        99: { emoji: '⛈️', text: 'Thunderstorm with heavy hail' },
    };
    
    return map[code] || { emoji: '❓', text: 'Unknown' };
}

/**
 * Convert US AQI to a descriptive string.
 */
export function getAqiDescription(aqi: number): { emoji: string, text: string, level: 'Good' | 'Moderate' | 'Unhealthy' | 'Hazardous' } {
    if (aqi <= 50) return { emoji: '🟢', text: 'Good', level: 'Good' };
    if (aqi <= 100) return { emoji: '🟡', text: 'Moderate', level: 'Moderate' };
    if (aqi <= 150) return { emoji: '🟠', text: 'Unhealthy for Sensitive Groups', level: 'Unhealthy' };
    if (aqi <= 200) return { emoji: '🔴', text: 'Unhealthy', level: 'Unhealthy' };
    if (aqi <= 300) return { emoji: '🟣', text: 'Very Unhealthy', level: 'Hazardous' };
    return { emoji: '🟤', text: 'Hazardous', level: 'Hazardous' };
}

/**
 * Search for a location by name using Open-Meteo Geocoding API.
 */
export async function searchLocation(query: string): Promise<LocationResult | null> {
    try {
        const url = new URL(GEO_URL);
        url.searchParams.append('name', query);
        url.searchParams.append('count', '1');
        url.searchParams.append('language', 'en');
        url.searchParams.append('format', 'json');

        const res = await fetchWithRetry(url.toString());
        if (!res.ok) throw new Error(`Geocoding API error: ${res.status}`);

        const data = await res.json() as any;
        if (!data.results || data.results.length === 0) {
            return null;
        }

        const hit = data.results[0];
        return {
            id: hit.id,
            name: hit.name,
            latitude: hit.latitude,
            longitude: hit.longitude,
            country: hit.country,
            admin1: hit.admin1,
            timezone: hit.timezone
        };
    } catch (err: any) {
        logger.warn({ err: err.message, query }, 'Failed to search location (API might be overloaded)');
        return null;
    }
}

/**
 * Get current weather and short-term forecast for a specific location.
 */
export async function getWeatherData(lat: number, lon: number, timezone: string = 'auto') {
    try {
        const url = new URL(WEATHER_URL);
        url.searchParams.append('latitude', lat.toString());
        url.searchParams.append('longitude', lon.toString());
        url.searchParams.append('current', 'temperature_2m,relative_humidity_2m,apparent_temperature,is_day,precipitation,weather_code,cloud_cover,wind_speed_10m');
        url.searchParams.append('daily', 'weather_code,temperature_2m_max,temperature_2m_min,sunrise,sunset,uv_index_max,precipitation_probability_max');
        // Get hourly data for the next 24 hours to fuel the smart alerts
        url.searchParams.append('hourly', 'temperature_2m,precipitation_probability,weather_code,uv_index');
        url.searchParams.append('timezone', timezone);
        url.searchParams.append('forecast_days', '3'); // Get today + next 2 days

        const res = await fetchWithRetry(url.toString());
        if (!res.ok) throw new Error(`Weather API error: ${res.status}`);

        const data = await res.json() as any;
        
        const current: CurrentWeather = {
            temperature: data.current.temperature_2m,
            feels_like: data.current.apparent_temperature,
            humidity: data.current.relative_humidity_2m,
            precipitation: data.current.precipitation,
            cloud_cover: data.current.cloud_cover,
            wind_speed: data.current.wind_speed_10m,
            weather_code: data.current.weather_code,
            is_day: data.current.is_day,
            time: data.current.time
        };

        const daily: DailyForecast = {
            time: data.daily.time,
            weather_code: data.daily.weather_code,
            temperature_2m_max: data.daily.temperature_2m_max,
            temperature_2m_min: data.daily.temperature_2m_min,
            sunrise: data.daily.sunrise,
            sunset: data.daily.sunset,
            uv_index_max: data.daily.uv_index_max,
            precipitation_probability_max: data.daily.precipitation_probability_max
        };

        return { current, daily, hourly: data.hourly };
    } catch (err: any) {
        logger.warn({ err: err.message, lat, lon }, 'Failed to fetch weather data (API might be overloaded)');
        return null;
    }
}

/**
 * Get current air quality for a specific location.
 */
export async function getAirQuality(lat: number, lon: number, timezone: string = 'auto') {
    try {
        const url = new URL(AQI_URL);
        url.searchParams.append('latitude', lat.toString());
        url.searchParams.append('longitude', lon.toString());
        url.searchParams.append('current', 'european_aqi,us_aqi,pm10,pm2_5,carbon_monoxide,nitrogen_dioxide,ozone');
        url.searchParams.append('timezone', timezone);

        const res = await fetchWithRetry(url.toString());
        if (!res.ok) throw new Error(`AQI API error: ${res.status}`);

        const data = await res.json() as any;
        
        const aqi: AirQuality = {
            pm2_5: data.current.pm2_5,
            pm10: data.current.pm10,
            carbon_monoxide: data.current.carbon_monoxide,
            nitrogen_dioxide: data.current.nitrogen_dioxide,
            ozone: data.current.ozone,
            european_aqi: data.current.european_aqi,
            us_aqi: data.current.us_aqi
        };

        return aqi;
    } catch (err: any) {
        logger.warn({ err: err.message, lat, lon }, 'Failed to fetch AQI data (API might be overloaded)');
        return null;
    }
}

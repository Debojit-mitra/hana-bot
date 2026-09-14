import mongoose, { Document, Schema } from 'mongoose';

export interface IWeatherProfile {
    jid: string;           // WhatsApp JID (User or Group)
    latitude: number;
    longitude: number;
    locationName: string;
    timezone: string;
    dailyBriefing: boolean; // Opt-in for daily briefing
    briefingHour: number;   // Hour of day (0-23) to send the briefing
    smartAlerts: boolean;   // Opt-in for continuous extreme weather checks
    lastAlertSentAt?: Date; // To prevent spamming the same alert
    createdAt: Date;
    updatedAt: Date;
}

export interface IWeatherProfileDoc extends IWeatherProfile, Document {
    id: string; // Mongoose virtual getter
}

const weatherProfileSchema = new Schema<IWeatherProfileDoc>({
    jid: {
        type: String,
        required: true,
        unique: true,
        index: true
    },
    latitude: {
        type: Number,
        required: true
    },
    longitude: {
        type: Number,
        required: true
    },
    locationName: {
        type: String,
        required: true
    },
    timezone: {
        type: String,
        required: true,
        default: 'auto'
    },
    dailyBriefing: {
        type: Boolean,
        default: false
    },
    briefingHour: {
        type: Number,
        default: 8,
        min: 0,
        max: 23
    },
    smartAlerts: {
        type: Boolean,
        default: false
    },
    lastAlertSentAt: {
        type: Date
    }
}, {
    timestamps: true
});

export const WeatherProfileModel = mongoose.model<IWeatherProfileDoc>('WeatherProfile', weatherProfileSchema);

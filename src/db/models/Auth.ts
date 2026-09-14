import mongoose, { Schema, Document } from 'mongoose';

// Session Credentials Model
export interface IAuthCreds extends Document {
    key: string;
    value: string; // Stored as JSON string using BufferJSON
}

const AuthCredsSchema = new Schema<IAuthCreds>({
    key: { type: String, required: true, unique: true },
    value: { type: String, required: true },
});

export const AuthCredsModel = mongoose.model<IAuthCreds>('AuthCreds', AuthCredsSchema);

// Signal Keys Model
export interface IAuthKey extends Document {
    key: string;
    value: string; // Stored as JSON string using BufferJSON
}

const AuthKeysSchema = new Schema<IAuthKey>({
    key: { type: String, required: true, unique: true },
    value: { type: String, required: true },
});

export const AuthKeysModel = mongoose.model<IAuthKey>('AuthKeys', AuthKeysSchema);

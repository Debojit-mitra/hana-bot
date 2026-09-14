import {
    initAuthCreds,
    BufferJSON,
    type AuthenticationState,
    type AuthenticationCreds,
    type SignalKeyStore,
    type SignalDataTypeMap,
    type SignalDataSet
} from '@whiskeysockets/baileys';
import { AuthCredsModel, AuthKeysModel } from '../db/models/Auth.js';
import logger from '../utils/logger.js';

export async function useMongoDBAuthState(): Promise<{ state: AuthenticationState, saveCreds: () => Promise<void> }> {
    // Helper to serialize and deserialize
    const writeData = (data: any) => JSON.stringify(data, BufferJSON.replacer);
    const readData = (text: string) => JSON.parse(text, BufferJSON.reviver);

    // Fetch creds from DB
    let creds: AuthenticationCreds;
    const credsDoc = await AuthCredsModel.findOne({ key: 'creds' });

    if (credsDoc) {
        creds = readData(credsDoc.value);
    } else {
        creds = initAuthCreds();
    }

    const saveCreds = async () => {
        const val = writeData(creds);
        await AuthCredsModel.updateOne(
            { key: 'creds' },
            { $set: { value: val } },
            { upsert: true }
        );
    };

    const keys: SignalKeyStore = {
        async get<T extends keyof SignalDataTypeMap>(type: T, ids: string[]): Promise<{ [id: string]: SignalDataTypeMap[T] }> {
            const data: { [id: string]: SignalDataTypeMap[T] } = {};
            
            for (const id of ids) {
                const doc = await AuthKeysModel.findOne({ key: `${type}-${id}` });
                if (doc) {
                    try {
                        data[id] = readData(doc.value);
                    } catch (err) {
                        logger.error({ err, id, type }, 'Failed to parse key from DB');
                    }
                }
            }
            
            return data;
        },
        async set(data: SignalDataSet): Promise<void> {
            const tasks: Promise<any>[] = [];
            
            for (const category in data) {
                for (const id in data[category as keyof SignalDataSet]) {
                    const value = data[category as keyof SignalDataSet]?.[id];
                    const key = `${category}-${id}`;
                    
                    if (value) {
                        tasks.push(
                            AuthKeysModel.updateOne(
                                { key },
                                { $set: { value: writeData(value) } },
                                { upsert: true }
                            )
                        );
                    } else {
                        tasks.push(
                            AuthKeysModel.deleteOne({ key })
                        );
                    }
                }
            }
            
            await Promise.all(tasks);
        },
        async clear(): Promise<void> {
            await AuthKeysModel.deleteMany({});
        }
    };

    return {
        state: { creds, keys },
        saveCreds
    };
}

export async function clearMongoDBAuthState(): Promise<void> {
    await AuthCredsModel.deleteMany({});
    await AuthKeysModel.deleteMany({});
    logger.info('Cleared MongoDB auth state');
}

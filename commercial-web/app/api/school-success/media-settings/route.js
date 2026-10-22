import {withRequest} from '@/lib/school-success/server';
import { env } from '@/lib/school-success/environment';
import { actor, database, checkOrigin, failure } from '@/lib/school-success/server';
import { MEDIA_SETTINGS_KEY, encryptMediaCredentials, loadR2Config, r2UploadsConfigured, verifyMediaStorage } from '@/lib/school-success/r2-evidence';
export const dynamic = 'force-dynamic';
const headers = { 'Cache-Control': 'no-store' };
async function handlerGET() { try {
    const a = await actor();
    if (!a.isSuperAdmin)
        throw Error('403:Admin required');
    const db = database(), config = await loadR2Config(env, db);
    return Response.json({ configured: r2UploadsConfigured(config), canSave: Boolean(config.MEDIA_SETTINGS_ENCRYPTION_KEY), bucket: config.R2_BUCKET_NAME, publicBase: config.R2_PUBLIC_BASE_URL }, { headers });
}
catch (e) {
    return failure(e);
} }
async function handlerPOST(req) { try {
    checkOrigin(req);
    const a = await actor();
    if (!a.isSuperAdmin)
        throw Error('403:Admin required');
    if (!req.headers.get('content-type')?.includes('application/json'))
        throw Error('Expected JSON settings');
    const text = await req.text();
    if (text.length > 4096)
        throw Error('Settings are too large');
    const body = JSON.parse(text), accessKeyId = String(body.accessKeyId || '').trim(), secretAccessKey = String(body.secretAccessKey || '').trim();
    if (!/^[A-Za-z0-9]{16,128}$/.test(accessKeyId) || !/^[A-Za-z0-9/+_=\-]{16,256}$/.test(secretAccessKey))
        throw Error('Enter the R2 Access Key ID and Secret Access Key supplied by Cloudflare');
    const config = env;
    if (!config.MEDIA_SETTINGS_ENCRYPTION_KEY)
        throw Error('503:Media settings encryption is not configured');
    await verifyMediaStorage({ ...config, R2_ACCESS_KEY_ID: accessKeyId, R2_SECRET_ACCESS_KEY: secretAccessKey });
    const encrypted = await encryptMediaCredentials({ accessKeyId, secretAccessKey, updatedAt: new Date().toISOString() }, config.MEDIA_SETTINGS_ENCRYPTION_KEY);
    await database().prepare('INSERT INTO portal_config(key,value) VALUES(?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value').bind(MEDIA_SETTINGS_KEY, encrypted).run();
    return Response.json({ ok: true, configured: true }, { headers });
}
catch (e) {
    return failure(e);
} }


export async function GET(req){return withRequest(req,()=>handlerGET(req));}

export async function POST(req){return withRequest(req,()=>handlerPOST(req));}


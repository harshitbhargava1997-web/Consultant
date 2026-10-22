import { AwsClient } from 'aws4fetch';
export const r2UploadsConfigured = (c) => Boolean(c.R2_ACCESS_KEY_ID && c.R2_SECRET_ACCESS_KEY && c.R2_ENDPOINT_URL && c.R2_BUCKET_NAME && c.R2_PUBLIC_BASE_URL);
const encoder = new TextEncoder();
const encode = (bytes) => btoa(String.fromCharCode(...bytes)).replaceAll('+', '-').replaceAll('/', '_').replaceAll('=', '');
const decode = (text) => Uint8Array.from(atob(text.replaceAll('-', '+').replaceAll('_', '/')), x => x.charCodeAt(0));
async function signingKey(secret) { if (!secret)
    throw Error('503:Submission signing is not configured'); return crypto.subtle.importKey('raw', encoder.encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign', 'verify']); }
export async function seal(value, secret) { const body = encode(encoder.encode(JSON.stringify(value))); const signature = await crypto.subtle.sign('HMAC', await signingKey(secret), encoder.encode(body)); return body + '.' + encode(new Uint8Array(signature)); }
export async function unseal(token, secret) { try {
    if (typeof token !== 'string' || token.length > 200000)
        throw Error();
    const [body, signature, extra] = token.split('.');
    if (extra || !await crypto.subtle.verify('HMAC', await signingKey(secret), decode(signature), encoder.encode(body)))
        throw Error();
    const data = JSON.parse(new TextDecoder().decode(decode(body)));
    if (!data.exp || data.exp < Date.now())
        throw Error();
    return data;
}
catch {
    throw Error('403:Submission permission expired or is invalid. Prepare the submission again.');
} }
export async function r2Request(config, key, method, body, headers = {}) { if (!r2UploadsConfigured(config))
    throw Error('503:Evidence uploads need the R2 access key ID and secret access key'); const endpoint = new URL(config.R2_ENDPOINT_URL); if (endpoint.protocol !== 'https:' || !endpoint.hostname.endsWith('.r2.cloudflarestorage.com') || config.R2_BUCKET_NAME !== 'onelern-media')
    throw Error('503:Expected the existing onelern-media bucket'); const url = endpoint.origin + '/' + encodeURIComponent(config.R2_BUCKET_NAME) + '/' + key.split('/').map(encodeURIComponent).join('/'); const client = new AwsClient({ accessKeyId: config.R2_ACCESS_KEY_ID, secretAccessKey: config.R2_SECRET_ACCESS_KEY, service: 's3', region: 'auto' }); const signed = await client.sign(url, { method, headers: { ...headers, 'x-amz-content-sha256': 'UNSIGNED-PAYLOAD' }, body, aws: { signQuery: true }, ...{ duplex: 'half' } }); return fetch(signed, { signal: AbortSignal.timeout(120000) }); }
export const MEDIA_SETTINGS_KEY = 'r2CredentialsEncryptedV1';
async function encryptionKey(secret) { if (!secret)
    throw Error('503:Media settings encryption is not configured'); return crypto.subtle.importKey('raw', await crypto.subtle.digest('SHA-256', encoder.encode(secret)), { name: 'AES-GCM' }, false, ['encrypt', 'decrypt']); }
export async function encryptMediaCredentials(value, secret) { const iv = crypto.getRandomValues(new Uint8Array(12)); const bytes = await crypto.subtle.encrypt({ name: 'AES-GCM', iv, additionalData: encoder.encode(MEDIA_SETTINGS_KEY) }, await encryptionKey(secret), encoder.encode(JSON.stringify(value))); return JSON.stringify({ iv: encode(iv), ciphertext: encode(new Uint8Array(bytes)) }); }
export async function decryptMediaCredentials(value, secret) { try {
    const saved = JSON.parse(value);
    const bytes = await crypto.subtle.decrypt({ name: 'AES-GCM', iv: decode(saved.iv), additionalData: encoder.encode(MEDIA_SETTINGS_KEY) }, await encryptionKey(secret), decode(saved.ciphertext));
    const data = JSON.parse(new TextDecoder().decode(bytes));
    if (!data.accessKeyId || !data.secretAccessKey)
        throw Error();
    return data;
}
catch {
    throw Error('503:Saved media credentials could not be unlocked. Ask the administrator to save them again.');
} }
export async function loadR2Config(base, db) {
 const extra=await db.prepare('SELECT value FROM portal_config WHERE key=?').bind('r2BaseConfig').first();
 if(extra)base={...base,...JSON.parse(extra.value)};
 if (!base.MEDIA_SETTINGS_ENCRYPTION_KEY)
    return base; const saved = await db.prepare('SELECT value FROM portal_config WHERE key=?').bind(MEDIA_SETTINGS_KEY).first(); if (!saved)
    return base; const keys = await decryptMediaCredentials(saved.value, base.MEDIA_SETTINGS_ENCRYPTION_KEY); return { ...base, R2_ACCESS_KEY_ID: keys.accessKeyId, R2_SECRET_ACCESS_KEY: keys.secretAccessKey }; }
export async function verifyMediaStorage(config) { const key = 'portal-connection-check/' + crypto.randomUUID() + '.txt'; const content = 'School Success media connection check'; const put = await r2Request(config, key, 'PUT', content, { 'Content-Type': 'text/plain' }); if (!put.ok)
    throw Error('R2 rejected the connection test. Check the key pair and Object Read & Write access to onelern-media.'); try {
    const read = await r2Request(config, key, 'GET');
    if (!read.ok || await read.text() !== content)
        throw Error('R2 read verification failed. Check Object Read & Write access.');
}
finally {
    const removed = await r2Request(config, key, 'DELETE');
    if (!removed.ok)
        throw Error('R2 cleanup verification failed. Check Object Read & Write access and retry.');
} }


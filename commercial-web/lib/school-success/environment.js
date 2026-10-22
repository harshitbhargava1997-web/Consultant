// Runtime secrets stay in Vercel Functions. This module must never enter a client bundle.
export const env = {
 get SUPABASE_GATEWAY_TOKEN(){return process.env.SCHOOL_SUCCESS_SIGNING_KEY;},
 get MEDIA_SETTINGS_ENCRYPTION_KEY(){return process.env.SCHOOL_SUCCESS_TRANSFER_KEY;},
 get R2_ENDPOINT_URL(){return process.env.SUCCESS_R2_ENDPOINT_URL||'';},
 get R2_BUCKET_NAME(){return process.env.SUCCESS_R2_BUCKET_NAME||'onelern-media';},
 get R2_PUBLIC_BASE_URL(){return process.env.SUCCESS_R2_PUBLIC_BASE_URL||'https://pub-584a50ce1c7944dea02be2edbc4188aa.r2.dev';},
 get R2_ACCESS_KEY_ID(){return process.env.SUCCESS_R2_ACCESS_KEY_ID||'';},
 get R2_SECRET_ACCESS_KEY(){return process.env.SUCCESS_R2_SECRET_ACCESS_KEY||'';}
};

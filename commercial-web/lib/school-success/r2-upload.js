import {AwsClient} from 'aws4fetch';
import {r2UploadsConfigured} from './r2-evidence.js';
function urlFor(config,path=''){
 const endpoint=new URL(config.R2_ENDPOINT_URL);if(endpoint.protocol!=='https:'||!endpoint.hostname.endsWith('.r2.cloudflarestorage.com')||config.R2_BUCKET_NAME!=='onelern-media')throw Error('503:Unexpected media storage');
 return new URL(endpoint.origin+'/'+encodeURIComponent(config.R2_BUCKET_NAME)+path);
}
function client(config){return new AwsClient({accessKeyId:config.R2_ACCESS_KEY_ID,secretAccessKey:config.R2_SECRET_ACCESS_KEY,service:'s3',region:'auto'});}
export async function presignUpload(config,key,type,requiredHeaders){
 if(!r2UploadsConfigured(config))throw Error('503:Media storage is not configured');
 const url=urlFor(config,'/'+key.split('/').map(encodeURIComponent).join('/'));url.searchParams.set('X-Amz-Expires','900');
 const signed=await client(config).sign(url,{method:'PUT',headers:{'Content-Type':type,...requiredHeaders},aws:{signQuery:true,allHeaders:Boolean(requiredHeaders)}});return signed.url;
}
export async function bucketCors(config,method='GET',body){return client(config).fetch(urlFor(config,'?cors'),{method,headers:body?{'Content-Type':'application/xml'}:{},body});}
// Short-lived signed GET for one evidence object (served only after the caller's access was checked).
export async function presignDownload(config,key,expires=3600){
 if(!r2UploadsConfigured(config))throw Error('503:Media storage is not configured');
 const url=urlFor(config,'/'+key.split('/').map(encodeURIComponent).join('/'));url.searchParams.set('X-Amz-Expires',String(expires));
 const signed=await client(config).sign(url,{method:'GET',aws:{signQuery:true}});return signed.url;
}

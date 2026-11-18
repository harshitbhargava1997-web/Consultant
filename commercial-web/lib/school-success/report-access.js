// Access check for one consolidated-report record, shared by the report and evidence routes.
// 'signin' records: the caller must be a signed-in School Success administrator whose grant covers the
// record's school (signedIn() performs it). 'link' records and earlier sharing links (v1, which have no
// mode): the link's secret must match the stored digest. Failures never reveal which part was wrong.
import {isShareSecret,secretDigest,sameDigest} from './report-shares.js';
export const accessMode=record=>record.mode==='signin'?'signin':'link';
export async function authorizeAccess(record,secret,signedIn){
 if(accessMode(record)==='signin'){await signedIn(record.school);return;}
 if(!isShareSecret(secret)||!sameDigest(await secretDigest(secret),record.secretSha256))throw Error('404:not valid');
}

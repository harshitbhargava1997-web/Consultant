// Short school link IDs: "<school-name>-<4-digit code>", e.g. "sunrise-public-school-4821" (6–40 characters).
export const SHORT_ID=/^(?=.{6,40}$)[a-z0-9]+(?:-[a-z0-9]+)*-[1-9]\d{3}$/;
export const isShortId=id=>typeof id==='string'&&SHORT_ID.test(id);

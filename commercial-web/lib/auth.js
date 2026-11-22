export function normalizePhone(value) {
  const raw=String(value||"").trim();
  if(!raw)return "";
  const compact=raw.replace(/[\s()-]/g,"");
  if(/^\+[1-9]\d{7,14}$/.test(compact))return compact;
  if(!/^\d+$/.test(compact))return "";
  const digits=compact;
  if(/^\d{10}$/.test(digits))return "+91"+digits;
  if(/^0\d{10}$/.test(digits))return "+91"+digits.slice(1);
  if(/^91\d{10}$/.test(digits))return "+"+digits;
  return "";
}

export function isEmail(value) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(String(value||"").trim());
}

export function isConfirmedUser(user) {
  return !!(user&&(user.email_confirmed_at||user.phone_confirmed_at));
}

export function loginLabel(user) {
  if(user?.email&&user.email.endsWith("@"+MOBILE_LOGIN_DOMAIN)&&user.phone)return "+"+String(user.phone).replace(/^\+/,"");
  return user?.email||user?.phone||"User";
}

// Mobile-number sign-in without SMS: accounts created for a mobile number also carry this internal sign-in address
// (never emailed; schoolsuccess.in has no mail service on this subdomain). The sign-in page uses it when a mobile
// number is entered, then falls back to the phone sign-in for older phone-only accounts.
export const MOBILE_LOGIN_DOMAIN="mobile.schoolsuccess.in";
export function mobileLoginEmail(phone){
  const digits=String(normalizePhone(phone)||"").replace(/\D/g,"");
  return digits?digits+"@"+MOBILE_LOGIN_DOMAIN:"";
}

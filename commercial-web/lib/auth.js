export function normalizePhone(value) {
  const raw=String(value||"").trim();
  if(!raw)return "";
  const compact=raw.replace(/[\s()-]/g,"");
  if(/^\+[1-9]\d{7,14}$/.test(compact))return compact;
  const digits=compact.replace(/\D/g,"");
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
  return user?.email||user?.phone||"User";
}

// One password rule for every Vision and School Success account (owner decision, 24 November 2026):
// 6 to 128 characters. Digits only (for example a 6-digit number) is allowed; no letter or symbol rules.
export const PASSWORD_MIN = 6, PASSWORD_MAX = 128;
export const PASSWORD_RULE = 'at least 6 characters (6 digits are fine)';
export function validPassword(p) { return typeof p === 'string' && p.length >= PASSWORD_MIN && p.length <= PASSWORD_MAX; }

export function reportTime(settings = {}) {
 const hours = settings.timeUnit !== 'minutes';
 return {unit: hours ? 'hours' : 'minutes', label: hours ? 'Hours' : 'Minutes', short: hours ? 'hr' : 'min', digits: hours ? 2 : 1,
  value: minutes => Number(minutes || 0) / (hours ? 60 : 1),
  format(minutes) {
   const value = Number(minutes || 0) / (hours ? 60 : 1);
   return Math.abs(value) > 0 && Math.abs(value) < (hours ? .01 : .1) ? (value < 0 ? '-' : '') + (hours ? '<0.01' : '<0.1') : value.toLocaleString('en-IN', {minimumFractionDigits: hours ? 0 : 1, maximumFractionDigits: hours ? 2 : 1});
  }
 };
}

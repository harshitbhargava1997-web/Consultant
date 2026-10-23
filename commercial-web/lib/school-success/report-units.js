// Presentation only: raw minutes still drive totals, averages and benchmarks.
export function formatReportDuration(minutes) {
 const value = Number(minutes || 0);
 if (!Number.isFinite(value)) return '—';
 const negative = value < 0 ? '-' : '', absolute = Math.abs(value), rounded = Math.round(absolute);
 if (absolute > 0 && rounded === 0) return negative + '<1 min';
 const hours = Math.floor(rounded / 60), remainder = rounded % 60;
 return negative + (hours ? hours.toLocaleString('en-IN') + ' hr ' + remainder + ' min' : remainder + ' min');
}

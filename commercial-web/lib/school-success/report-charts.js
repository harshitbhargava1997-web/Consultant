import {includedMetric} from './reports.js';
import {reportTime} from './report-units.js';

export const reportViews = ['tables', 'charts', 'both'];
export function reportPresentation(settings = {}) {
 const view = reportViews.includes(settings.visualization) ? settings.visualization : 'tables';
 return {view, tables: view !== 'charts', charts: view !== 'tables'};
}
export const chartNumber = value => Number(value) > 0 && Number(value) < .01 ? '<0.01' : Number(value).toLocaleString('en-IN', {maximumFractionDigits: 2});
const actualSeries = {key: 'actual', label: 'Recorded', color: '#147d73'};
const targetSeries = {key: 'target', label: 'Target', color: '#62798d'};
function inTime(model, settings) {
 const time = reportTime(settings);
 return {...model, unit: time.label, short: time.short, rows: model.rows.map(row => ({...row, ...Object.fromEntries(model.series.filter(s => row[s.key] !== undefined).map(s => [s.key, time.value(row[s.key])]))}))};
}
function usageModel(title, rows, benchmark, settings) {
 return inTime({title, series: benchmark ? [actualSeries, targetSeries] : [actualSeries], rows}, settings);
}
export function profileUsageChart(profile, settings) {
 const time = reportTime(settings);
 const rows = profile.metrics.flatMap((metric, i) => includedMetric(i, settings) ? [{
  label: metric.label, actual: metric.actual,
  ...(settings.quantitative && metric.target > 0 ? {target: metric.target} : {}),
  note: `${time.format(metric.average)} ${time.short} per working day${settings.quantitative && metric.target > 0 ? ' | ' + metric.status : ''}`
 }] : []);
 return usageModel('Recorded resource usage', rows, rows.some(row => row.target !== undefined), settings);
}
export function schoolUsageChart(profiles, index, settings, includeSchool = false) {
 const time = reportTime(settings);
 const benchmark = settings.quantitative && settings.daily[index] > 0;
 return usageModel(profiles[0]?.metrics[index].label + ' - consolidated report', profiles.map(p => {
  const m = p.metrics[index];
  const books = new Set(p.books.filter(b => b.title !== 'Title not provided').map(b => b.title)).size;
  return {label: p.name + (includeSchool ? ' | ' + p.school : ''), actual: m.actual,
   ...(benchmark && m.target > 0 ? {target: m.target} : {}),
   note: `${time.format(m.average)} ${time.short} per working day${index === 1 ? ' | ' + books + ' book' + (books === 1 ? '' : 's') + ' opened' : ''}${benchmark && m.target > 0 ? ' | ' + m.status : ''}`};
 }), benchmark && profiles.some(p => p.metrics[index].target > 0), settings);
}
export function bookUsageChart(profile, settings) {
 return inTime({title: 'Book / chapter breakdown', series: [actualSeries], rows: profile.books.map(b => ({
  label: [b.title, b.grade && 'Grade ' + b.grade, b.subject].filter(Boolean).join(' | '),
  actual: b.minutes, note: `${b.sessions} session${b.sessions === 1 ? '' : 's'}`
 }))}, settings);
}
export function comparisonChart(changes, comparison, from, to, settings) {
 const time = reportTime(settings);
 return inTime({title: 'Teacher usage comparison', series: [
  {key: 'previous', label: 'Previous ' + time.unit, detail: `${comparison.from} to ${comparison.to}`, color: '#62798d'},
  {key: 'current', label: 'Current ' + time.unit, detail: `${from} to ${to}`, color: '#147d73'}
 ], rows: changes.map(r => ({label: r.current.name + ' | ' + r.current.school, previous: r.previousTotal, current: r.total,
  note: `Change: ${r.total - r.previousTotal > 0 ? '+' : ''}${time.format(r.total - r.previousTotal)} ${time.short}`}))}, settings);
}
export function schoolComparisonChart(group, changes, comparison, from, to, settings) {
 const model = comparisonChart([], comparison, from, to, settings), time = reportTime(settings);
 return inTime({...model, title: 'School usage comparison', rows: group[0].metrics.flatMap((metric, i) => {
  if (!includedMetric(i, settings)) return [];
  const previous = changes.reduce((sum, r) => sum + (r.previous?.metrics[i].actual || 0), 0);
  const current = group.reduce((sum, p) => sum + p.metrics[i].actual, 0);
  return [{label: metric.label, previous, current, note: `Change: ${current - previous > 0 ? '+' : ''}${time.format(current - previous)} ${time.short}`}];
 })}, settings);
}
export function chartMaximum(model) {
 return Math.max(0, ...model.rows.flatMap(row => model.series.map(series => Number(row[series.key]) || 0))) || 1;
}

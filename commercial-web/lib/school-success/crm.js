import { z } from 'zod';
const date = z.string().regex(/^\d{4}-\d{2}-\d{2}$/).refine(s => Number.isFinite(Date.parse(s)) && new Date(s).toISOString().slice(0, 10) === s, 'Invalid date');
export const ticketSchema = z.object({ school: z.string().trim().min(1).max(1000), title: z.string().trim().min(1).max(200), description: z.string().trim().min(1).max(10000), status: z.enum(['Open', 'In Progress', 'Resolved']), priority: z.enum(['Low', 'Normal', 'High', 'Urgent']).default('Normal'), date, followup: z.union([date, z.literal('')]).default(''), resolution: z.string().trim().max(10000).default(''), archived: z.boolean().default(false) }).superRefine((v, ctx) => { if (v.status === 'Resolved' && !v.resolution)
    ctx.addIssue({ code: 'custom', path: ['resolution'], message: 'Add resolution notes before closing the ticket' }); if (v.status !== 'Resolved' && !v.followup)
    ctx.addIssue({ code: 'custom', path: ['followup'], message: 'Set the next action date for an open ticket' }); });
export const connectDone = (r) => r.status === 'Successfully Resolved' || r.status === 'Completed';
export function crmDue(r, today) { return !r.archived && !(r.kind === 'ticket' ? r.status === 'Resolved' : connectDone(r)) && Boolean(r.followup) && r.followup <= today; }
export function crmView(rows, view, today) { return rows.filter(r => view === 'Archive' ? r.archived : !r.archived && (view === 'Due' ? crmDue(r, today) : view === 'Resolved' || view === 'Completed' ? (r.kind === 'ticket' ? r.status === 'Resolved' : connectDone(r)) : !(r.kind === 'ticket' ? r.status === 'Resolved' : connectDone(r)))); }
// One conversation log; the type is a label rather than a separate workflow.
export function conversationCounts(rows) { const active = rows.filter(r => !r.archived), connects = active.filter(r => r.recordType !== 'Ticket'); return { tickets: active.filter(r => r.recordType === 'Ticket').length, connects: connects.length, completedConnects: connects.filter(connectDone).length }; }
export function schoolWeek(today) { const start = new Date(today + 'T00:00:00Z'); start.setUTCDate(start.getUTCDate() - ((start.getUTCDay() + 6) % 7)); const end = new Date(start); end.setUTCDate(end.getUTCDate() + 6); return { from: start.toISOString().slice(0, 10), to: end.toISOString().slice(0, 10) }; }
export function weeklyConnects(rows, schools, today) { const week = schoolWeek(today); return schools.map(school => { const calls = rows.filter(r => r.kind === 'call' && r.recordType !== 'Ticket' && !r.archived && r.school === school), completed = calls.filter(r => connectDone(r) && r.outcome === 'Connected' && r.date >= week.from && r.date <= week.to && r.date <= today).length; return { school, completed, target: 2, remaining: Math.max(0, 2 - completed), scheduled: calls.filter(r => !connectDone(r) && (r.followup || r.date) >= week.from && (r.followup || r.date) <= week.to).length, ...week }; }); }
export function dashboardCRM(rows, schools, today) { const tickets = rows.filter(r => r.kind === 'ticket' && !r.archived), calls = rows.filter(r => r.kind === 'call' && !r.archived && r.recordType !== 'Ticket'), weekly = weeklyConnects(calls, schools, today); return { openTickets: tickets.filter(r => r.status !== 'Resolved').length, dueTickets: tickets.filter(r => crmDue(r, today)).length, pendingCalls: calls.filter(r => !connectDone(r)).length, completedCalls: calls.filter(connectDone).length, weekly, weeklyRemaining: weekly.reduce((n, r) => n + r.remaining, 0), weeklyCompleted: weekly.reduce((n, r) => n + r.completed, 0) }; }
export function todaysPriorities(rows, schools, today) {
    const active = rows.filter(r => !r.archived && schools.includes(r.school));
    const tasks = active.flatMap(r => {
        if (r.kind === 'ticket' && crmDue(r, today))
            return [{ ...r, priorityType: 'Ticket due', dueDate: r.followup }];
        if (r.kind !== 'call' || r.recordType === 'Ticket')
            return [];
        if (r.nextAction && !r.actionDone && r.followup && r.followup <= today)
            return [{ ...r, priorityType: 'Follow-up action', dueDate: r.followup }];
        if (!connectDone(r)) {
            const date = r.followup || r.date;
            if (date && date <= today)
                return [{ ...r, priorityType: 'Call due', dueDate: date }];
        }
        return [];
    }).sort((a, b) => a.dueDate.localeCompare(b.dueDate));
    return { tasks, belowTarget: weeklyConnects(active, schools, today).filter(r => r.remaining > 0) };
}


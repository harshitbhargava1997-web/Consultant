'use client';
import { todaysPriorities } from '@/lib/school-success/crm';
export default function CRMPriorities({ rows, schools, today, onOpen }) {
    const { tasks, belowTarget } = todaysPriorities(rows, schools, today);
    return <section className="card"><h2>Today’s priorities</h2><p>Tickets, calls and agreed actions due today or overdue.</p>{!tasks.length && <p className="hint">No overdue or due-today tasks.</p>}{tasks.map(r => <button type="button" className="list-row" key={r.kind + ':' + r.id} onClick={() => onOpen(r)}><div><b>{r.school}</b><small>{r.priorityType} · {r.nextAction || r.title || r.name || 'Stakeholder call'}{r.actionOwner ? ' · ' + r.actionOwner : ''}</small></div><span className="due">{r.dueDate}</span></button>)}<h3>Schools below this week’s call target</h3><p className="hint">Two connected calls per school, Monday–Sunday. Calls without a recorded outcome do not count.</p>{!belowTarget.length && <p>All selected schools have met their target.</p>}{belowTarget.map(r => <button type="button" className="list-row" key={r.school} onClick={() => onOpen({ kind: 'call', school: r.school })}><div><b>{r.school}</b><small>{r.completed} connected · {r.remaining} remaining · {r.scheduled} pending this week</small></div><span>Plan call →</span></button>)}</section>;
}


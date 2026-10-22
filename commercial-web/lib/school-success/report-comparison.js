export function compareProfiles(current, comparison) {
    const old = new Map(comparison.profiles.map(p => [p.key, p]));
    return current.map(p => {
        const prev = old.get(p.key);
        const total = (x) => x ? x.metrics.reduce((s, m) => s + m.actual, 0) : 0;
        const visibleDays = (x) => x ? new Set(x.usage.filter(r => r.minutes > 0 && !x.holidays.includes(r.date) && (!comparison.excludeSundays || new Date(r.date + 'T00:00:00Z').getUTCDay() !== 0)).map(r => r.date)).size : 0;
        const previous = total(prev), now = total(p), previousRate = prev?.days ? previous / prev.days : 0, currentRate = p.days ? now / p.days : 0, delta = currentRate - previousRate;
        const trend = !p.days || !prev?.days ? 'Not comparable' : now < comparison.visibleMinutes ? 'No current use' : previous < comparison.visibleMinutes ? 'Started using' : Math.abs(delta) < comparison.changeThreshold ? 'Almost unchanged' : delta > 0 ? 'Usage improved' : 'Usage went down';
        const gaps = p.metrics.filter(m => m.target > 0 && m.actual < m.target);
        const suggestion = trend === 'No current use' ? 'Verify the teacher login and access; agree a daily usage routine.' : trend === 'Usage went down' ? 'Review the decline with the teacher and restore a consistent routine.' : gaps.length ? 'Maintain regular use and focus on ' + gaps.map(m => m.label.toLowerCase()).join(', ') + '.' : 'Sustain the routine and review classroom evidence.';
        const goal = p.metrics.filter(m => m.target > 0).map(m => `${m.label}: ${m.target.toFixed(0)} min`).join('; ');
        return { current: p, previous: prev, total: now, previousTotal: previous, currentDays: visibleDays(p), previousDays: visibleDays(prev), delta, trend, suggestion, outcome: (goal || 'Benchmarks disabled; review recorded activity') + `; visible use on ${Math.min(comparison.regularDays, p.days)} working days in an equivalent review period.` };
    });
}


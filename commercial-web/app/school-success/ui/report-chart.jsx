import {chartMaximum, chartNumber} from '@/lib/school-success/report-charts';

export default function ReportChart({model}) {
 const maximum = chartMaximum(model);
 return <figure className="report-chart" aria-label={model.title}>
  <figcaption><strong>{model.title}</strong><span>{model.unit} · scale starts at zero</span></figcaption>
  <div className="report-chart-legend">{model.series.map(series => <div key={series.key}><span><i style={{background: series.color}} aria-hidden="true"/>{series.label}</span>{series.detail && <small>{series.detail}</small>}</div>)}</div>
  {!model.rows.length ? <p className="hint">No records in this review period.</p> : <>
   <div className="report-chart-axis" aria-hidden="true"><span>0</span><span>{chartNumber(maximum / 2)}</span><span>{chartNumber(maximum)} {model.short}</span></div>
   <div className="report-chart-rows">{model.rows.map((row, index) => <div className="report-chart-row" key={index}>
    <b>{row.label}</b>{row.note && <small>{row.note}</small>}
    {model.series.map(series => row[series.key] === undefined ? null : <div className="report-chart-series" key={series.key}>
     <span>{series.label}</span><div className="report-chart-track" aria-hidden="true"><i style={{width: Math.max(0, Number(row[series.key]) || 0) / maximum * 100 + '%', background: series.color}}/></div><strong>{chartNumber(row[series.key])}</strong>
    </div>)}
   </div>)}</div>
  </>}
 </figure>;
}

export default function OverviewTotals({totals,admin=false,loading=false,error=''}){
 const cards=[['schools','Total schools','Active schools'],['teachers','Total teachers','Unique teacher accounts'],['students','Total students','Active learners'],['consultants','Total consultants',admin?'Registered consultants':'Consultants in your permitted schools']];
 return <section aria-label="Vision overview totals" aria-busy={loading}>
  <p className="helper">{admin?'Totals across all active Vision schools.':'Totals within your permitted schools and classes.'}{loading?' Updating totals…':''}</p>
  {error&&<p className="notice" role="status">{error}</p>}
  <div className="stats">{cards.map(([key,label,detail])=><div className="stat" key={key}><span>{label}</span><strong>{Number.isInteger(totals?.[key])?totals[key].toLocaleString('en-IN'):'—'}</strong><small>{detail}</small></div>)}</div>
 </section>;
}

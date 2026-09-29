"""Consultant workflow added to the existing admin app; no startup data writes."""
from datetime import datetime, date
from io import BytesIO
from pathlib import Path
from uuid import uuid4
from xml.sax.saxutils import escape
import json

import pandas as pd
import streamlit as st
from sqlalchemy import text
from reportlab.lib import colors
from reportlab.lib.styles import ParagraphStyle
from portal_core import pdf_styles as getSampleStyleSheet
from reportlab.lib.pagesizes import A4
from reportlab.platypus import SimpleDocTemplate, Paragraph, Spacer, Table, TableStyle, PageBreak
from portal_core import (APP_VERSION, EVIDENCE_COLUMNS, artifact_counts, clean_text,
                         evidence_values, report_fingerprint, school_metrics, usage_masks)

STATUSES = ['Open', 'In Progress', 'Blocked', 'Awaiting Verification', 'Verified']


def workflow_ready(conn):
    try:
        with conn.engine.connect() as c:
            required = ['portal_actions', 'portal_action_history', 'portal_school_plans',
                        'portal_evidence_reviews', 'portal_import_runs', 'portal_contacts', 'portal_call_logs']
            return all(c.execute(text('SELECT to_regclass(:name)'), {'name': 'public.' + n}).scalar() for n in required)
    except Exception:
        return False


def read_table(conn, table, schools):
    allowed = {'portal_actions', 'portal_school_plans', 'portal_evidence_reviews', 'portal_import_runs'}
    if table not in allowed:
        raise ValueError('Unsupported table')
    if table != 'portal_import_runs' and not schools:
        return pd.DataFrame()
    with conn.engine.connect() as c:
        if table == 'portal_import_runs':
            return pd.read_sql(text('SELECT * FROM portal_import_runs ORDER BY created_at DESC LIMIT 100'), c)
        return pd.read_sql(text(f'SELECT * FROM {table} WHERE school = ANY(:schools)'), c, params={'schools': list(schools)})


def save_action(conn, values, actor, existing=None):
    values = dict(values)
    for field in ['school', 'finding', 'action', 'owner', 'success_criterion']:
        if not str(values.get(field, '')).strip():
            raise ValueError(f'{field.replace("_", " ").title()} is required.')
    if values['status'] not in STATUSES:
        raise ValueError('Invalid status')
    if values['status'] == 'Verified' and (not values.get('verification', '').strip() or not values.get('verified_by', '').strip()):
        raise ValueError('Verified actions need review evidence and the reviewer name.')
    values['verified_at'] = datetime.now().astimezone() if values['status'] == 'Verified' else None
    if values['status'] != 'Verified':
        values['verified_by'] = ''
    with conn.engine.begin() as c:
        if existing:
            values['id'] = existing['id']
            values['expected_updated'] = existing['updated_at']
            columns = [k for k in values if k not in {'id', 'expected_updated'}]
            query = 'UPDATE portal_actions SET ' + ', '.join(f'{k}=:{k}' for k in columns)
            query += ', updated_at=now() WHERE id=:id AND updated_at=:expected_updated'
            if c.execute(text(query), values).rowcount != 1:
                raise ValueError('Another user updated this action. Refresh and review their changes before saving.')
        else:
            values['id'] = str(uuid4())
            values['created_by'] = actor
            columns = list(values)
            c.execute(text('INSERT INTO portal_actions (' + ','.join(columns) + ') VALUES (' + ','.join(':'+k for k in columns) + ')'), values)
        c.execute(text('INSERT INTO portal_action_history(action_id, actor, snapshot) VALUES (:id,:actor,CAST(:snapshot AS jsonb))'),
                  {'id': values['id'], 'actor': actor, 'snapshot': json.dumps(values, default=str)})
    return values['id']


def leadership_pdf(school, period, metrics, plan, actions, evidence_summary, report_meta):
    """Short leadership report, with automatic extra pages for long action lists."""
    buffer = BytesIO()
    styles = getSampleStyleSheet()
    body = ParagraphStyle('LeadershipBody', parent=styles['BodyText'], fontSize=9, leading=13, spaceAfter=6)
    small = ParagraphStyle('LeadershipSmall', parent=body, fontSize=8, leading=11)
    heading = ParagraphStyle('LeadershipHeading', parent=styles['Heading2'], textColor=colors.HexColor('#174466'))
    p = lambda value, style=body: Paragraph(escape(str(value or '')).replace('\n','<br/>'), style)
    story = [p('School Implementation Review', styles['Title']), p(school, heading), p(period),
             p(report_meta, small), Spacer(1, 10)]
    story.extend([p('Agreed priorities', heading), p(plan.get('priorities') or 'Not yet recorded'),
                  p('Baseline and school readiness', heading), p(plan.get('baseline') or 'Baseline not recorded'),
                  p(plan.get('readiness') or 'Readiness not recorded')])
    rows = [[p('Measure', small), p('Teachers meeting target / eligible', small), p('Recorded minutes', small)]]
    for key, label in [('prep','Lesson-plan access'),('library','Library access'),('content','Book/content access')]:
        if metrics.empty:
            value, minutes = 'No roster available', '0'
        else:
            eligible = metrics['Eligible days'].gt(0) & metrics[f'{key} target'].gt(0)
            value = f"{int((eligible & metrics[f'{key} status'].eq('Met')).sum())} / {int(eligible.sum())}"
            minutes = f"{metrics[f'{key} minutes'].sum():.1f}"
        rows.append([p(label, small), p(value, small), p(minutes, small)])
    table = Table(rows, colWidths=[160, 225, 130], repeatRows=1)
    table.setStyle(TableStyle([('BACKGROUND',(0,0),(-1,0),colors.HexColor('#E8F0F6')),
                              ('GRID',(0,0),(-1,-1),0.3,colors.lightgrey),('VALIGN',(0,0),(-1,-1),'TOP'),
                              ('TOPPADDING',(0,0),(-1,-1),7),('BOTTOMPADDING',(0,0),(-1,-1),7)]))
    story.extend([p('Implementation indicators', heading), table,
                  p('These are recorded access indicators, not verified teaching time or student outcomes.', small),
                  p('Evidence coverage', heading), p(evidence_summary),
                  p('Student learning', heading), p('Record comparable learning checks in the baseline and action verification. Uploaded files alone do not establish learning improvement.')])
    story.extend([PageBreak(), p('Actions, support and leadership decisions', styles['Title'])])
    if actions.empty:
        story.append(p('No actions recorded for this school.'))
    else:
        for _, a in actions.sort_values('due_date').iterrows():
            story.extend([p(f"{a['status']} | {a['owner']} | Due {a['due_date']}", heading),
                          p(a['action']), p('Success criterion: ' + str(a['success_criterion'])),
                          p('Support: ' + str(a.get('support') or 'Not recorded')),
                          p('Review evidence: ' + str(a.get('verification') or 'Not yet verified'), small)])
    story.extend([p('Leadership decisions required', heading), p(plan.get('leadership_decisions') or 'None recorded'),
                  p('Next school review: ' + str(plan.get('review_date') or 'Not scheduled'))])
    def footer(canvas, doc):
        canvas.setFont('PortalSans', 8)
        canvas.drawString(40, 23, f'{APP_VERSION} | Generated {datetime.now().astimezone().strftime("%Y-%m-%d %H:%M %Z")}')
        canvas.drawRightString(A4[0]-40, 23, f'Page {doc.page}')
    SimpleDocTemplate(buffer, pagesize=A4, leftMargin=40, rightMargin=40, topMargin=35, bottomMargin=40).build(story, onFirstPage=footer, onLaterPages=footer)
    buffer.seek(0)
    return buffer


def render_workspace(conn, df, roster, schools, actor, period, days, daily_targets, scope_meta):
    st.header('Consultant Workspace')
    st.caption('Turn findings into agreed support, ownership, and verified improvement. Actions stay visible until closed, even outside the usage review period.')
    if not workflow_ready(conn):
        st.warning('Run migration.sql once in Supabase SQL Editor to enable the new consultant workspace. Existing tracker tabs remain available.')
        return
    if not schools:
        st.info('Select at least one school in the global filters.')
        return
    try:
        actions = read_table(conn, 'portal_actions', schools)
        plans = read_table(conn, 'portal_school_plans', schools)
        reviews = read_table(conn, 'portal_evidence_reviews', schools)
    except Exception as e:
        st.error(f'Could not load consultant records: {e}')
        return
    today = pd.Timestamp.now(tz='Asia/Kolkata').date()
    open_actions = actions[actions.status.ne('Verified')] if not actions.empty else actions
    overdue = open_actions[pd.to_datetime(open_actions.due_date).dt.date < today] if not open_actions.empty else open_actions
    reviewed_ids = set(reviews.record_id.astype(str)) if not reviews.empty else set()
    evidence_mask = pd.Series(False,index=df.index)
    for col in EVIDENCE_COLUMNS:
        evidence_mask |= df.get(col, pd.Series('',index=df.index)).map(lambda v: bool(evidence_values(v)))
    submissions = df[evidence_mask].copy()
    pending = submissions[~submissions['id'].astype(str).isin(reviewed_ids)] if 'id' in submissions else submissions
    cards = st.columns(4)
    cards[0].metric('Open actions',len(open_actions)); cards[1].metric('Overdue actions',len(overdue))
    cards[2].metric('Blocked',int(open_actions.status.eq('Blocked').sum()) if not open_actions.empty else 0)
    cards[3].metric('Evidence awaiting review',len(pending))
    tabs = st.tabs(['Priorities & Actions','School Plan & Leadership Report','Evidence Review','Action History'])
    with tabs[0]:
        if not overdue.empty:
            st.warning('Follow up on these overdue commitments.')
            st.dataframe(overdue[['school','teacher','action','owner','due_date','status']],use_container_width=True)
        if not actions.empty:
            show = st.checkbox('Include verified actions',value=False,key='cw_show_verified')
            st.dataframe(actions if show else open_actions,use_container_width=True)
            st.download_button('Download action register (CSV)',actions.to_csv(index=False).encode('utf-8-sig'),'consultant_actions.csv','text/csv')
        choices = ['New action'] + (actions.id.tolist() if not actions.empty else [])
        labels = {r['id']: f"{r['school']} | {r['action'][:70]}" for _,r in actions.iterrows()}
        choice = st.selectbox('Create or update action',choices,format_func=lambda x: labels.get(x,x),key='cw_action_choice')
        old = actions[actions.id.eq(choice)].iloc[0].to_dict() if choice!='New action' else {}
        form_key = 'cw_action_'+choice
        with st.form(form_key):
            school = st.selectbox('School',schools,index=schools.index(old['school']) if old.get('school') in schools else 0)
            teacher = st.text_input('Teacher (leave blank for a school-wide action)',value=old.get('teacher',''))
            finding = st.text_area('Finding',value=old.get('finding',''))
            evidence = st.text_area('Supporting evidence / observation reference',value=old.get('evidence',''))
            cause = st.text_input('Cause / barrier',value=old.get('cause',''))
            confidences=['Hypothesis','Reported by school','Verified']
            confidence=st.selectbox('Cause confidence',confidences,index=confidences.index(old.get('cause_confidence','Hypothesis')))
            action=st.text_area('Agreed action',value=old.get('action',''))
            owner=st.text_input('Responsible person',value=old.get('owner',''))
            roles=['Teacher','Coordinator','Consultant','Principal','Owner','Technical support']
            role=st.selectbox('Owner role',roles,index=roles.index(old.get('owner_role','Teacher')))
            due=st.date_input('Due date',value=pd.Timestamp(old['due_date']).date() if old else today)
            criterion=st.text_area('Success criterion: what will improve and how will we check?',value=old.get('success_criterion',''))
            support=st.text_area('Consultant / school support',value=old.get('support',''))
            priorities=['Normal','High','Urgent']
            priority=st.selectbox('Priority',priorities,index=priorities.index(old.get('priority','Normal')))
            status=st.selectbox('Status',STATUSES,index=STATUSES.index(old.get('status','Open')))
            verification=st.text_area('Review evidence / observed result (required to verify)',value=old.get('verification',''))
            verifier=st.text_input('Reviewed by (required to verify)',value=old.get('verified_by',''))
            submitted=st.form_submit_button('Save action',type='primary')
        if submitted:
            try:
                if teacher.strip() and not ((roster.Institution.eq(school)) & roster.FullName.eq(teacher.strip())).any():
                    raise ValueError('Teacher must match the selected school roster; leave blank for a school-wide action.')
                save_action(conn,dict(school=school,teacher=teacher.strip(),finding=finding,evidence=evidence,cause=cause,cause_confidence=confidence,
                    action=action,owner=owner,owner_role=role,due_date=due,success_criterion=criterion,support=support,
                    priority=priority,status=status,verification=verification,verified_by=verifier),actor,old or None)
                st.success('Action saved.'); st.rerun()
            except Exception as e:
                st.error(str(e))
    with tabs[1]:
        school=st.selectbox('School plan',schools,key='cw_plan_school')
        matches=plans[plans.school.eq(school)] if not plans.empty else plans
        plan=matches.iloc[0].to_dict() if not matches.empty else {}
        with st.form('cw_plan_'+school):
            baseline=st.text_area('Baseline: dated implementation and student-learning evidence',value=plan.get('baseline',''))
            priorities=st.text_area('Two or three agreed school priorities',value=plan.get('priorities',''))
            readiness=st.text_area('Readiness and barriers: devices, offline use, training, staffing',value=plan.get('readiness',''))
            decisions=st.text_area('Decisions required from school leadership',value=plan.get('leadership_decisions',''))
            review_date=st.date_input('Next school review',value=pd.Timestamp(plan['review_date']).date() if plan.get('review_date') else today)
            old_dates=plan.get('calendar_dates') or []
            if isinstance(old_dates,str): old_dates=json.loads(old_dates)
            dates_text=st.text_area('School holidays / non-teaching dates (YYYY-MM-DD, one per line)',value='\n'.join(old_dates))
            save_plan=st.form_submit_button('Save school plan')
        if save_plan:
            try:
                dates=sorted({date.fromisoformat(x.strip()).isoformat() for x in dates_text.splitlines() if x.strip()})
                with conn.engine.begin() as c:
                    params=dict(school=school,baseline=baseline,priorities=priorities,readiness=readiness,leadership_decisions=decisions,
                                review_date=review_date,calendar_dates=json.dumps(dates),updated_by=actor)
                    if plan:
                        params['expected_updated']=plan['updated_at']
                        result=c.execute(text('''UPDATE portal_school_plans SET baseline=:baseline, priorities=:priorities,
                            readiness=:readiness, leadership_decisions=:leadership_decisions, review_date=:review_date,
                            calendar_dates=CAST(:calendar_dates AS jsonb),updated_by=:updated_by,updated_at=now()
                            WHERE school=:school AND updated_at=:expected_updated'''),params)
                        if result.rowcount!=1: raise ValueError('School plan changed in another session. Refresh before saving.')
                    else:
                        c.execute(text('''INSERT INTO portal_school_plans(school,baseline,priorities,readiness,leadership_decisions,
                            review_date,calendar_dates,updated_by) VALUES (:school,:baseline,:priorities,:readiness,:leadership_decisions,
                            :review_date,CAST(:calendar_dates AS jsonb),:updated_by)'''),params)
                st.success('School plan saved.');st.rerun()
            except Exception as e: st.error(f'Could not save school plan: {e}')
        sdf=df[df.Institution.eq(school)]
        sr=roster[roster.Institution.eq(school)]
        metrics=school_metrics(sdf,sr,days,daily_targets)
        st.dataframe(metrics,use_container_width=True)
        counts=artifact_counts(sdf)
        reviewed=int(reviews.school.eq(school).sum()) if not reviews.empty else 0
        summary=f"Activity files: {counts['activity']}; written-work files: {counts['Writing_Sample_Link']}; assessment files: {counts['Student_Assessment_Link']}. Review records for this school (all dates): {reviewed}. Counts describe submissions, not quality."
        school_actions=actions[actions.school.eq(school)] if not actions.empty else actions
        meta=f"Consultant: {actor} | Scope: {scope_meta} | Roster: {len(sr)} | Benchmark version: {APP_VERSION}"
        signature=report_fingerprint(sdf,dict(plan=plan,actions=school_actions.to_dict('records'),period=period,meta=meta,days=days,targets=daily_targets,roster=sr.to_dict('records')))
        if st.button('Prepare school leadership PDF',key='cw_prepare_leadership'):
            st.session_state['cw_pdf']=(signature,leadership_pdf(school,period,metrics,plan,school_actions,summary,meta).getvalue())
        saved=st.session_state.get('cw_pdf')
        if saved and saved[0]==signature:
            st.download_button('Download school leadership PDF',saved[1],f"School_Leadership_Review_{today}.pdf",'application/pdf')
        elif saved: st.caption('Settings or data changed. Prepare a fresh report.')
    with tabs[2]:
        if submissions.empty:
            st.info('No evidence submissions in the selected global review window.')
        elif 'id' not in submissions:
            st.warning('Evidence reviews require the teacher_records primary id column.')
        else:
            pending_only=st.checkbox('Show only unreviewed submissions',True,key='cw_pending_only')
            selection=pending if pending_only else submissions
            if selection.empty:
                st.success('All selected submissions have a review record.')
            else:
                ids=selection['id'].astype(str).tolist()
                labels={str(r['id']):f"{r['Institution']} | {r['FullName']} | {r['Date']} | {r.get('Book','')}" for _,r in selection.iterrows()}
                rid=st.selectbox('Submission to review',ids,format_func=lambda x:labels[x],key='cw_review_record')
                row=selection[selection.id.astype(str).eq(rid)].iloc[0]
                st.write(f"Teacher: {row['FullName']} | School: {row['Institution']} | Class: {row.get('Grade','')} {row.get('Section','')}")
                st.caption('Open the same submission in Live Evidence to inspect media before recording a review.')
                old_review=reviews[reviews.record_id.astype(str).eq(rid)] if not reviews.empty else reviews
                old=old_review.iloc[0].to_dict() if not old_review.empty else {}
                statuses=['Reviewed - useful evidence','Needs clarification','Needs coaching']
                with st.form('cw_review_'+rid):
                    status=st.selectbox('Review result',statuses,index=statuses.index(old.get('status',statuses[0])))
                    feedback=st.text_area('Specific feedback grounded in the evidence',value=old.get('feedback',''))
                    next_step=st.text_area('Teacher next step / support to provide',value=old.get('next_step',''))
                    save_review=st.form_submit_button('Save evidence review')
                if save_review:
                    if not feedback.strip(): st.error('Enter specific feedback before saving.')
                    else:
                        try:
                            with conn.engine.begin() as c:
                                params=dict(record_id=rid,school=row['Institution'],teacher=row['FullName'],status=status,feedback=feedback,next_step=next_step,reviewer=actor)
                                if old:
                                    params['expected_updated']=old['updated_at']
                                    result=c.execute(text('''UPDATE portal_evidence_reviews SET status=:status,feedback=:feedback,
                                        next_step=:next_step,reviewer=:reviewer,updated_at=now()
                                        WHERE record_id=:record_id AND updated_at=:expected_updated'''),params)
                                    if result.rowcount!=1: raise ValueError('Review changed in another session. Refresh before saving.')
                                else:
                                    c.execute(text('''INSERT INTO portal_evidence_reviews(record_id,school,teacher,status,feedback,next_step,reviewer)
                                        VALUES (:record_id,:school,:teacher,:status,:feedback,:next_step,:reviewer)'''),params)
                            st.success('Review saved. Share feedback through your existing school communication process.');st.rerun()
                        except Exception as e:st.error(f'Could not save review: {e}')
        if not reviews.empty:
            st.download_button('Download school feedback (CSV)',reviews.to_csv(index=False).encode('utf-8-sig'),'evidence_feedback.csv','text/csv')
    with tabs[3]:
        if actions.empty: st.info('No action history yet.')
        else:
            try:
                with conn.engine.connect() as c:
                    history=pd.read_sql(text('''SELECT h.action_id,h.actor,h.recorded_at,h.snapshot FROM portal_action_history h
                        JOIN portal_actions a ON a.id=h.action_id WHERE a.school=ANY(:schools) ORDER BY h.recorded_at DESC LIMIT 500'''),c,params={'schools':list(schools)})
                st.dataframe(history,use_container_width=True)
            except Exception as e:st.error(f'Could not load action history: {e}')


def render_data_quality(conn, df, filtered, actor):
    st.header('Data Quality & Import Verification')
    st.caption('These checks describe the database currently connected to this app. No records are deleted by this screen.')
    cols=st.columns(4)
    cols[0].metric('Database records loaded',len(df));cols[1].metric('Selected records',len(filtered))
    cols[2].metric('Schools loaded',df.Institution.nunique());cols[3].metric('Teacher/school pairs',len(df[['Institution','FullName']].drop_duplicates()))
    types=df.groupby('Type',dropna=False).size().reset_index(name='Records')
    st.dataframe(types,use_container_width=True)
    reflection=df['Type'].fillna('').astype(str).str.casefold().eq('classroom reflection')
    undated=df['Date'].isna()
    legacy=reflection & df.get('implementation_date',pd.Series(None,index=df.index,dtype=object)).isna()
    st.write(f'Rows with no usable review date: {int(undated.sum())}. Legacy reflections without an explicit implementation date: {int(legacy.sum())}.')
    if legacy.any():st.info('Legacy reflection dates fall back to their recorded timestamp. Original lesson dates cannot be reconstructed reliably from timestamps alone; records are not silently rewritten.')
    ambiguous=df[['Institution','FullName']].drop_duplicates().groupby('FullName').Institution.nunique()
    if (ambiguous>1).any():st.caption(f'{int((ambiguous>1).sum())} teacher names occur in multiple schools. Updated 360 selection always uses school + teacher.')
    session_summary=st.session_state.get('last_import_result')
    if session_summary:st.json(session_summary)
    if workflow_ready(conn):
        try:
            st.subheader('Recent import / restore runs')
            st.dataframe(read_table(conn,'portal_import_runs',[]),use_container_width=True)
        except Exception as e:st.error(f'Could not read import history: {e}')
    st.subheader('Import and recovery checks')
    st.write('Uploads reject invalid identities, dates, or durations before writing. Restore includes assessment/event evidence, sections, original submission timestamps, and new implementation identifiers. New evidence submissions are excluded from destructive duplicate cleanup.')
    st.download_button('Export selected records for verification (CSV)',filtered.to_csv(index=False).encode('utf-8-sig'),'selected_records_verification.csv','text/csv')

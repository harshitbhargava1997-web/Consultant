"""Shared, side-effect-free rules for the existing Streamlit portals.

No connection or migration runs when this module is imported.
"""
from datetime import date, datetime
import hashlib
import json
import math
import re

import numpy as np
import pandas as pd

APP_VERSION = "2026.09-consultant.1"
INDIA_TZ = "Asia/Kolkata"


def pdf_styles():
    """Embed ReportLab's bundled Vera fonts for predictable PDF rendering."""
    from pathlib import Path
    import reportlab
    from reportlab.pdfbase import pdfmetrics
    from reportlab.pdfbase.ttfonts import TTFont
    from reportlab.lib.styles import getSampleStyleSheet
    root = Path(reportlab.__file__).parent / 'fonts'
    variants = {'PortalSans': 'Vera.ttf', 'PortalSans-Bold': 'VeraBd.ttf',
                'PortalSans-Oblique': 'VeraIt.ttf', 'PortalSans-BoldOblique': 'VeraBI.ttf'}
    for name, filename in variants.items():
        if name not in pdfmetrics.getRegisteredFontNames():
            pdfmetrics.registerFont(TTFont(name, str(root / filename)))
    pdfmetrics.registerFontFamily('PortalSans', normal='PortalSans', bold='PortalSans-Bold',
                                  italic='PortalSans-Oblique', boldItalic='PortalSans-BoldOblique')
    styles = getSampleStyleSheet()
    for style in styles.byName.values():
        if not hasattr(style, "fontName"):
            continue
        style.fontName = style.fontName.replace('Helvetica', 'PortalSans')
        if style.fontName.startswith('Times'):
            style.fontName = 'PortalSans'
    return styles
EVIDENCE_COLUMNS = [
    "Voice_Note_Link", "Lesson_Plan_Picture", "Video_Evidence_1",
    "Video_Evidence_2", "Video_Evidence_3", "Writing_Sample_Link",
    "Phonics_Evidence_Link", "Portfolio_Evidence_Link",
    "Student_Assessment_Link", "Event_Pictures_Link",
]
RECORD_COLUMNS = [
    "State_Zone", "Uploaded_By", "Institution", "Center", "FirstName",
    "LastName", "FullName", "Role", "Type", "Grade", "Section", "Subject",
    "Book", "StartTime", "EndTime", "Duration_Min", *EVIDENCE_COLUMNS,
    "Assessment_Score_Pct", "Record_Hash", "submitted_at",
    "implementation_date", "submission_id", "implementation_id",
]


def clean_text(value):
    if value is None or (not isinstance(value, (list, dict)) and pd.isna(value)):
        return ""
    return re.sub(r"\s+", " ", str(value)).strip()


def evidence_values(value):
    return [x.strip() for x in clean_text(value).split(",")
            if x.strip() and x.strip().lower() not in {"nan", "none", "null"}]


def india_datetime(value):
    """Legacy naive platform dates are local; timezone-aware submissions convert."""
    try:
        t = pd.Timestamp(value)
        if pd.isna(t):
            return pd.NaT
        return t.tz_localize(INDIA_TZ) if t.tzinfo is None else t.tz_convert(INDIA_TZ)
    except (ValueError, TypeError):
        return pd.NaT


def local_naive_series(series):
    return pd.to_datetime(series.map(lambda x: india_datetime(x).tz_localize(None)
                          if pd.notna(india_datetime(x)) else pd.NaT), errors="coerce")


def add_review_dates(df):
    out = df.copy()
    starts = local_naive_series(out.get("StartTime", pd.Series(pd.NaT, index=out.index)))
    dates = pd.to_datetime(out.get("implementation_date", pd.Series(pd.NaT, index=out.index)), errors="coerce")
    out["StartTime"] = starts
    out["Date"] = dates.fillna(starts).dt.date
    return out


def usage_masks(df):
    types = df.get("Type", pd.Series("", index=df.index)).fillna("").astype(str).str.strip().str.casefold()
    books = df.get("Book", pd.Series("", index=df.index)).fillna("").astype(str).str.strip()
    reflection = types.eq("classroom reflection")
    lesson = types.eq("lessondelivery") & ~reflection
    library = types.eq("library") & ~reflection
    # Preserve the existing publisher event mapping; exclude self-reported topics.
    content = books.ne("") & ~books.str.match(r"^Lesson Plan", case=False, na=False) & ~reflection
    return lesson, library, content


def parse_duration_minutes(value):
    if value is None or pd.isna(value):
        return 0.0
    if hasattr(value, "hour") and not isinstance(value, (datetime, pd.Timestamp)):
        return value.hour * 60 + value.minute + value.second / 60
    if isinstance(value, (pd.Timedelta, np.timedelta64)):
        return pd.to_timedelta(value).total_seconds() / 60
    if isinstance(value, (int, float, np.integer, np.floating)):
        n = float(value)
        return n * 1440 if 0 <= n < 1 else n
    s = str(value).strip()
    if re.fullmatch(r"[+-]?\d+(\.\d+)?", s):
        return float(s)
    try:
        return pd.to_timedelta(s).total_seconds() / 60
    except (ValueError, TypeError):
        return float("nan")


def record_hash(row):
    """Keep legacy import identity; never equate different evidence implementations."""
    def s(key):
        return clean_text(row.get(key)).casefold()
    def t(key, precise=False):
        value = pd.to_datetime(row.get(key), errors="coerce")
        if pd.isna(value):
            return ""
        return value.isoformat() if precise else value.strftime("%Y-%m-%d %H:%M:%S")
    try:
        duration = f"{float(row.get('Duration_Min') or 0):.2f}"
        if duration == "nan":
            duration = "0.00"
    except (TypeError, ValueError):
        duration = "0.00"
    if s("implementation_id"):
        parts = ["implementation-v2", s("implementation_id")]
    elif s("Type") == "classroom reflection" or any(evidence_values(row.get(c)) for c in EVIDENCE_COLUMNS):
        parts = ["evidence-v2", *[s(k) for k in ["Institution", "FullName", "Grade", "Section", "Subject", "Book", "Type"]],
                 t("StartTime", True), t("EndTime", True), s("implementation_date"),
                 *[clean_text(row.get(c)) for c in EVIDENCE_COLUMNS]]
    else:
        parts = [s(k) for k in ["Uploaded_By", "FullName", "Institution", "Center", "Type", "Grade", "Subject", "Book"]]
        parts.extend([t("StartTime"), t("EndTime"), duration])
    return hashlib.sha256("|".join(parts).encode("utf-8")).hexdigest()


def validate_import(df):
    """Return row-level errors. Do not invent dates, teachers or schools."""
    errors = []
    for idx, row in df.iterrows():
        issues = []
        for col in ["Institution", "FullName", "Type"]:
            if clean_text(row.get(col)).casefold() in {"", "unknown teacher", "unknown school", "default school", "nan"}:
                issues.append(f"Missing {col}")
        if pd.isna(pd.to_datetime(row.get("StartTime"), errors="coerce")):
            issues.append("Missing/invalid StartTime")
        try:
            duration = float(row.get("Duration_Min", 0))
            if not math.isfinite(duration) or duration < 0:
                issues.append("Invalid/negative duration")
        except (TypeError, ValueError):
            issues.append("Invalid duration")
        if issues:
            errors.append({"Row": str(idx), "Issues": "; ".join(issues)})
    return errors


def report_fingerprint(df, configuration):
    stable = df.reindex(sorted(df.columns), axis=1).astype(str)
    rows = pd.util.hash_pandas_object(stable, index=False).sort_values().values.tobytes()
    settings = json.dumps(configuration, sort_keys=True, default=str).encode()
    return hashlib.sha256(rows + settings).hexdigest()


def scope_school(df, schools):
    if isinstance(schools, str):
        if schools in {"Multiple Schools", "All Selected Schools", "All Schools"}:
            return df.copy()
        schools = [schools]
    return df[df["Institution"].isin(list(schools))].copy()


def eligible_days(start, end, holidays=(), exclude_sundays=True, active_from=None, active_to=None):
    if start is None or end is None:
        return 0
    start, end = pd.Timestamp(start).date(), pd.Timestamp(end).date()
    if active_from is not None and pd.notna(active_from):
        start = max(start, pd.Timestamp(active_from).date())
    if active_to is not None and pd.notna(active_to):
        end = min(end, pd.Timestamp(active_to).date())
    if end < start:
        return 0
    excluded = {pd.Timestamp(d).date() for d in holidays if pd.notna(d)}
    return sum(d.date() not in excluded and (not exclude_sundays or d.weekday() != 6)
               for d in pd.date_range(start, end))


def artifact_counts(df):
    counts = {}
    for col in EVIDENCE_COLUMNS:
        counts[col] = len({v for value in df.get(col, []) for v in evidence_values(value)})
    counts["activity"] = len({v for col in ["Video_Evidence_1", "Video_Evidence_2", "Video_Evidence_3"]
                               for value in df.get(col, []) for v in evidence_values(value)})
    return counts


def school_metrics(df, roster, days, daily_targets):
    ld, lib, content = usage_masks(df)
    totals = {}
    for metric, mask in [("prep", ld), ("library", lib), ("content", content)]:
        totals[metric] = df.loc[mask].groupby(["Institution", "FullName"])["Duration_Min"].sum().to_dict()
    rows = []
    for _, r in roster[["Institution", "FullName"]].drop_duplicates().iterrows():
        key = (r["Institution"], r["FullName"])
        teacher_days = days.get(key, 0) if isinstance(days, dict) else days
        row = {"School": key[0], "Teacher": key[1], "Eligible days": teacher_days}
        for metric in totals:
            minutes = float(totals[metric].get(key, 0))
            target = daily_targets.get(metric, 0) * teacher_days
            row[f"{metric} minutes"] = round(minutes, 1)
            row[f"{metric} target"] = round(target, 1)
            row[f"{metric} status"] = ("Not applicable" if teacher_days == 0 else
                "Benchmark disabled" if target == 0 else "Met" if minutes >= target else
                "Below target" if minutes else "No recorded usage")
        rows.append(row)
    return pd.DataFrame(rows)

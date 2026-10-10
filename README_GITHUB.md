# GitHub-ready literacy assessment add-on

## Files / deployment options
- **Standalone pilot (recommended first):** deploy `assessment_app.py` with `assessment_module.py`, requirements file `requirements_assessment.txt`. Does not depend on portal_core or consultant_workspace.
- **Integrated teacher app:** add `assessment_module.py` and use `teacher_app_integrated.py` as the main script (or rename it to your repository's current entrypoint). Also keep your existing `portal_core.py`, secrets, and existing requirements.
- **Integrated admin app:** add `assessment_module.py` and use `admin_app_integrated.py`; keep your existing `portal_core.py`, `consultant_workspace.py`, requirements and secrets. Do not overwrite live deployments until tested.

## Configure
1. Create a separate TEST Supabase project. Run `assessment_migration.sql` using the SQL editor. `assessment_spiral_upgrade.sql` is for projects with an older migration already installed; don't run it after this bundled full migration.
2. Import `competencies_seed.csv` into `public.literacy_competencies` (Supabase CSV import). Grade 3/4 can be added later.
3. Provision Supabase Auth users and assign them to a `literacy_schools` row via `literacy_memberships` with roles `teacher`, `coordinator`, `principal`, or `owner`. This privileged setup is manual in this version. Do not give the teacher app a service-role credential.
4. In Streamlit secrets configure:
```toml
[supabase]
url = "https://YOUR_PROJECT.supabase.co"
anon_key = "YOUR_SUPABASE_ANON_OR_PUBLISHABLE_KEY"
```
For integrated apps, retain all the old secrets too. Existing apps may require a separate legacy `key` secret; never conflate that privilege with assessment auth.
5. Start with standalone: `streamlit run assessment_app.py`. Create class/section/year in Assessment Admin and import `Lebad_Assessment_Rosters_Independent_IDs.zip` CSVs (provided separately). Keep these same internally-generated IDs on every reimport.
6. Test each role, teacher class assignment, school isolation, roster upload, assessment save, reassessment, and student-level reports.

## Demonstrated literacy level
In **Progress Reports** choose class and student. Reports give enrolled grade, sequential *demonstrated level*, competency breakdown, next learning target, and downloadable CSV. This conservative **provisional rule** requires >=80% competency coverage and >=80% Independent among assessed competencies at each level, with all preceding levels mastered. Not Assessed is not failure. No level is inferred where there are no published competencies. Cutoffs must be approved before use for consequential decisions. Ratings carry forward from the latest observed assessment of each competency.

## Limitations
Local Python syntax verification only; no live DB/auth/Streamlit end-to-end run. Curriculum is an editable initial seed, not a validated diagnostic instrument. School memberships must be securely provisioned. Global competency edits affect all schools; add versioning/tenant overrides before large-scale rollout. Evidence is text-based, not independent audio/video verification. No automatic remediation engine or approval workflow yet.

# Teacher app layout (Stage 1)

24 November 2026. This follows the owner-approved phone designs (screens 1–3, plus tap-to-read and the date filter). It applies to **teachers signed in through their school link with their PIN**. Consultants, super admins and school leaders keep the existing staff layout, including when they open the Teacher portal.

## What teachers see
- **No staff header.** The sidebar, breadcrumb, "Academic operations / Teacher portal", "New preparation" and the "Usage … Refresh data" bar are not shown to these teachers.
- **Top bar:** "School Success" and a profile button with the teacher's initials. It opens a **profile menu** with:
  - Language (English / हिन्दी);
  - Change PIN (the existing PIN screen);
  - Log out.
- **Home:**
  - a greeting with the date;
  - a **Today** card listing today's periods. Tapping a period opens its plan; **Add evidence for today** opens Add evidence. With nothing planned today, it offers **Plan a lesson**.
  - three numbers: lessons planned this month, evidence shared this month, and new feedback;
  - **Recent lessons** with a date filter: **Today · This week** (Monday to today) **· This month · Date** (from/to). A chosen range can include upcoming days, so tomorrow's plan can be read. Tapping a lesson opens its plan; the camera button opens Add evidence. Upcoming lessons have no camera button. The list covers the summary window (the last 60 and next 30 days).
- **Bottom tabs:** Home · Plan · Evidence · Feedback. A red count shows feedback not yet seen on this device.
- **Read plan:**
  - The saved plan is shown in large, readable sections in teaching order: learning outcome, materials, I do, We do, You do, check learning, classwork and homework.
  - Notes saved without these headings are shown unchanged as "Your notes".
  - **A+** gives larger text (remembered on the phone).
  - For lessons dated today or earlier, **After class: add evidence** opens Add evidence on the same period.
- **Add evidence** (the same screen for staff):
  - lesson day dropdown;
  - period buttons, with a dot on any period that has something added;
  - a reminder of the period's learning outcome;
  - four evidence-type buttons;
  - **Take photo** (opens the camera) and **Choose files**;
  - thumbnails of chosen files, each with its type and a remove button;
  - the after-class reflection folded as "Optional · type or speak";
  - saved items under "Saved for this period";
  - a fixed Submit button that says what will be sent ("Submit 3 files + reflection").
- **Evidence shared screen:**
  - what was saved, by type, with a receipt;
  - **Next**, which offers the next period of the same lesson not yet included, or another lesson from today without evidence;
  - **Back to home** and **Add more to this lesson**.

## Unchanged
- **Server and data:** no server, data or permission change. Reading a plan uses the existing lesson read (`resume`), and the home uses the existing `myLessons` summary.
- **Uploads:** the upload, prepare/commit, update-ID retry and reflection-saving logic is unchanged.
- **Planning:** the lesson plan form is unchanged.
- **Staff:** consultants and leaders keep their layout.

## Tests
- `tests/success-teacher-app.test.mjs`:
  - plan text read back into sections;
  - free-form notes kept;
  - date filters;
  - greeting;
  - the Submit button text.
- Existing tests still pass, including the day/period helpers and Recent lessons.
- **Phone browser check** (iPhone 13 size, local production build, synthetic data). It covered:
  - PIN sign-in, with no staff header;
  - Today periods, numbers and filters;
  - a range including tomorrow (readable, no camera button);
  - the profile menu and Hindi;
  - the plan reader (seven sections, period switch, A+);
  - After class opening on the same period with its outcome;
  - Take photo and Choose files with thumbnails;
  - type change, reflection and Submit;
  - all three files and the reflection sent for Period 1;
  - the shared screen suggesting Period 2;
  - the Feedback tab clearing the red count;
  - the Plan tab Save bar sitting above the tabs;
  - the camera button opening the right day;
  - no page errors or sideways scrolling.
- **Staff layout check:** the Teacher portal rendered with consultant data keeps the school/teacher pickers, admin panels and action buttons, with no tab bar.
- The full staff page could not be opened locally without Vision sign-in settings.

## Rollback
Revert the PR.

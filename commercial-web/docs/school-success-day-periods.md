# Day-by-day periods and Home filters (owner request, 25 November 2026)

**Owner observation:** a teacher planned Periods 1–3 for a day, then came back to plan Period 4.
- The Plan screen started again at Period 1.
- Home showed each save as one row ("Grade 2 A · English +2").
- "This week" stopped at today, so later plans in the week did not appear.

## Changes
**Period numbers** (`lib/school-success/day-periods.js`):
- Every class period of a day is numbered **Period 1, 2, 3, 4…** in the order it was saved, across saves.
- The server now sends each lesson's first saved record (`order`) with the teacher summary.
- The same numbers are used on Home, the Plan screen and Add evidence.

**Plan screen, daily plan:**
- When a date is chosen, the periods already saved for it are listed under "Already planned for …" with a **green tick**. A tap opens the plan.
- New periods continue from the next number ("Period 5").
- The limit of 10 periods per day counts the saved ones too.

**Plan screen, weekly plan:** a day that already has a saved plan for the same class and subject is marked "A plan for this class and subject is already saved on this day". It is a note only; saving is not blocked.

**Home, Today:** chips read "Period 1 · Grade 2 A · English", "Period 2 · …".

**Home, Recent lessons:**
- **Layout:** one row per day, listing every period with its number, class, subject and topic.
  - Tapping a period opens its plan.
  - The camera adds evidence, for today and earlier days only.
- **Date chips:**
  - **Tomorrow:** shows tomorrow's planned periods, with a "Plan tomorrow" button when nothing is planned yet. Today has its own box at the top of Home, so there is no "Today" chip (owner decision).
  - **This week:** Monday to Sunday, upcoming days included.
  - **This month:** the whole month.
  - **Date:** a chosen range.
- **Class and Subject:**
  - The drop-downs list only what the teacher has planned.
  - They work together with the date chips.
  - A filtered list keeps the day's period numbers ("Period 4").
  - The month numbers follow the class and subject.
  - The choice is remembered on the phone.

**Feedback tab filters** (`lib/school-success/feedback-filters.js`):
- **When it was given:** All, This week, This month, or a chosen Date range.
- **Class and Subject:** of the lesson.
- **From:** the reviewer, for example "Meera Rao, Principal" or "School Success team".
- **Status:** All feedback, Not yet noted, or Noted.
- When a filter is on, the screen says "Showing 2 of 4 · Clear filters". The choices are remembered on the phone.

**Add evidence:**
- The "Lesson day" list reads "Wed, 25 Nov · Periods 1–3 · …" and "Wed, 25 Nov · Period 4 · …".
- The period chips and headings use the same numbers.

## Not changed
- **Saved plans:** cannot be edited (owner decision).
- **Storage:** nothing new is stored and there is no database change. Numbers come from the save order.
- **Coverage:** Home covers the last 60 and next 30 days, as before.

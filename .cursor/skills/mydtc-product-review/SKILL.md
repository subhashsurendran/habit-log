---
name: mydtc-product-review
description: >-
  Thorough MyDTC (habit-log) product review from UI/UX and real use cases.
  Use when reviewing the app, rating it, proposing improvements, checking a
  screen or flow, or deciding what to build next. Always think what could add
  more value to the app from a UI/UX perspective and also from use case perspective.
---

# MyDTC product review

Always think what could add more value to the app from a UI/UX perspective and also from use case perspective.

Be thorough before you call a pass done. A happy path that was just built is not a review. Two seats look at the same build. Both speak. A gap either seat finds is still a gap.

## The two seats

**UI/UX.** What a person can see and do on this screen, with one thumb, without a tour. Name, order, empty state, the one next action, and what is hidden.

**Use case.** The job they opened the app to finish. Walk it as that person, including the wrong door they will actually use.

## Lifecycle, every object

For each thing a person can create (habit, template, month, reminder, mark, backup, name), answer all of these before the review is done:

- Create
- See it again
- Edit it
- Delete it, with a second tap when the delete cannot be undone
- The cap, and what the screen says when the cap is full
- The empty state
- What related data stays or goes (a deleted template must not erase a month already started)

Missed on 2026-10-20: templates could be saved and set, and could not be edited or deleted, and had no cap. That was a review failure, not a small follow-up.

## Use-case walk

For the flow under review, write the person's sentence in their words ("I set sleep to 9:15 PM, so the phone should nudge me"). Then check the control they will actually touch, not only the control that was designed for it.

- A time written on today's square is a mark. A nudge is a separate booking. If the person expects one gesture to do both, the gesture they use must do both, or the screen must say what it did.
- A minute that has already passed does not ring tonight. Say when the next one is.
- Wrap up day means tonight's nudges stay quiet.
- Free stays the grid they use today. Do not lock a feature that cannot be paid for yet.

## What adds value

Prefer, in this order:

1. A broken truth: a mark, a month, or a nudge the person did not make, or a job they cannot finish.
2. The missing half of a lifecycle (edit, delete, cap).
3. One clearer sentence on the screen they are already on.
4. A new screen, a new tab, or a new feature. These wait until 1–3 are clean.

Do not add a control that only a reviewer would look for. Three templates, not thirty. The month grid stays the product.

## Review shape

Keep it short enough to act on.

| Seat | Score /10 | What is in the way |
| --- | --- | --- |
| UI/UX | | |
| Use case | | |

Then:

- Overall /10
- Gaps, highest value first. Each gap names the object, the missing lifecycle step, and the person's sentence.
- What not to build yet

A score of 10 still needs real days of use. Do not treat a checklist as a finished product.

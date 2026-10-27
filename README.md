# habit-log

Personal Android and iOS habit log. One month on the device. Not part of prarambh.

The name shown in the app is MyDTC, short for My Daily Task Checker. The tagline is "Small checks. Lasting habits." The expansion sits under the tagline on Home, in a smaller quiet line. Today, Score, Ideas, and Templates each open with one line on what that page is for. The GitHub repo stays habit-log. There is no store listing. Privacy and support pages are in docs/. They still need a public URL.

## Run on a Mac

```bash
cd ~/Projects/habit-log
npm install
npm run web
```

That opens MyDTC in the browser. Six tabs sit at the bottom: Home, Today, Score, Ideas, Templates, and Profile. Home asks what to call you the first time, then greets you by name. The mark and the tagline stay on Home. Track today opens this month. Back returns one step on Today, Score, and Templates. Exit returns to Home. Ideas and Profile are tabs, so they have no Back. Neither control covers the grid or the tab bar.

Today opens on the month and the grid. Add habit, Lock habits, Wrap up day, and More sit under the grid. Search, tags, the evening reminder, backup, and restore are under More. Sound stays off until Profile says Sound on. A tick plays when a cell is marked. One low tone plays when the night closes. There is no music loop. Version 1 is the iPhone app. The iOS build number is 9. Signing uses the paid Apple team Subhash Surendran. The bundle id is com.gosubhash31.habit-log. Restore latest reads a backup this app saved on the phone and refuses any other file. A checklist question is asked once for that list, and once for that day. Ideas is the gist of habits people add in many countries. Today's gist stays the same all day. Add puts that row on this month. A habit already there says On this month. This phone does not see anyone else's log. Home shows what is still open and Wrap up day. After that, the screen says tonight is closed, and the nudges for tonight stay quiet. A journal or a checklist opens Today. The month score on Home opens the score, and that number is not edited. A September already stored on this phone stays on its own Sample line. A new phone does not receive that month. Templates lets you name a list, add habits, and save it. Three lists is the limit. Each list has Edit and Delete. Deleting a list leaves a month that was already started. The list you last set is used again on the first morning of a new month, so that month is not a blank grid. The template that was used says Set for that month and has Unset. Unset removes that next month while it still has no marks. Other lists have Set. Habits are copied. Day marks are not. This month stays as it is. The next month shows under Next on Home. If this month has no marks yet, Set fills this month instead.

Profile is the last tab. It holds the stored name, sound on or off, and Write to us. The Premium card is hidden. Write to us opens the mail app. The subject is MyDTC and the build number. The note starts empty. The habit log, photos, and backup are not attached. If mail cannot open, the line under the button says so. Today’s grid stays free.

A past month, when one exists, opens from Home as a view. Edit is a separate control. Days before the month was started stay blank. Wrap up day still closes a chosen day. One evening reminder can be set, and it replaces the previous one. A timer reminder and an hour follow-up schedule a local notification on the phone. Up to three habits can be pinned. Drag reorders a habit inside its pin group, and Move up and Move down stay in the row. A journal voice note is a file on the phone, the same way a photo is.

Expo 58 asks for Node 22. Node 20 can still start this project. If `npm run web` stops and asks for a newer Node, install Node 22 (`nvm install 22 && nvm use 22`) and run `npm install` again.

On a phone, a release install contains the JavaScript, so MyDTC opens with Metro stopped. Marks stay in an encrypted database on that device. Save backup writes a file on the phone. There is no account and no network sync.

`npm run ios` and `npm run android` open a simulator when Xcode or Android Studio is installed.

## What the grid does

Task names stay on the left. The days across the top match that month, so February stops at 28, or 29 in a leap year. Each column shows the weekday as M, T, W, Th, F, S, or Su. Saturday and Sunday are shaded.

- Add habit offers Tick, Timer, Journal, or Checklist. Wake up is a timer. Meditation and Reading stay ticks. Medicine and Supplement add a starting tag (tablets or fitness) and do not change the habit name.
- A tick cycles blank, tick, cross. Hold the cell for a short note. A timer shows a clock such as 6:30 AM, and you can switch AM and PM. Type 507 for 5:07. The colon is added. It never shows a tick.
- A journal cell opens a page for a note, one photo, a voice note, or "Wrote it in my diary". The photo and the voice note are files on the device. A data URL is not stored. If that file cannot be saved, it is refused and the note can still be saved.
- A checklist row is the main task. Tap that row name, then Add a subtask. The same control is on the day cell. Subtasks stay on today. The cell shows how many are done, such as 2/3. It is not a tick. An empty checklist becomes a cross only when the day is wrapped and the miss flag is on.
- Adding a fourth task asks if you can complete all of them today. A day with more than 12 checklist tasks asks if you can finish that many in a day. You choose. One list stops at 24 tasks.
- Checklist rows copy unfinished tasks to the next day when that day is wrapped. The original day still shows what was finished. This is on by default. Turn it off on the row if each day should start empty. The copy stays inside the current month, and the next day never grows past three tasks.
- Tick and timer rows can store a follow-up a whole number of hours after the mark. 8 hours is the shortcut. On the phone that schedules one local notification. Saving a timer time, such as 9:15 PM, sets the nudge for that minute. Sleep Time says it is time to go to bed. Changing the time replaces that nudge. It stays off tonight once Wrap up day has been used. The following days still ring at that minute. The phone asks to allow notifications. If that is refused, the reminder is not on. The browser keeps the number and does not notify you. If the phone refuses permission, the mark is still saved and the screen says the notification was not scheduled. Checklist rows have no follow-up.
- The month starts blank. A cross is added only after a day has passed, and only from the day you first opened that month. Days before you started stay blank. Today stays blank until you wrap up.
- Wrap up day sits next to Add habit. It fills today's empty miss-rows with a cross and locks the habits. Marks already made stay put. Unlock habits if you still need a change.
- Each row says "Empty day counts as a miss." That is on by default. The cell stays blank until that day has passed. Turn it off and a blank is not a miss.
- Tags are short labels on the row. A task can have 3. A fourth tag is refused, and the ones already there stay. A stored row with more than 3 keeps the first 3. Tags do not change the cell.
- Score is its own tab. It counts days from when you started through today. A tick, a filled timer, a finished journal, or a checklist with every line checked is done. A cross is a miss. An empty cell is a miss only when that row counts blanks, and only after the day has passed or been wrapped. Efficiency is done divided by done plus miss. With nothing to count, the screen says "No closed days yet". Under the totals, each habit stays on one line: how many days, then up to three stretches, such as 1-5, 8-14. More breaks than that say scattered, with the first and last day, so alternate days do not list every number. This week names the habit to make easier, and a smaller version for the coming days. The same line sits under the month.

The first open of a month starts with three empty rows: Wake up, Meditation, and Reading.

## Check types

```bash
npm run typecheck
```

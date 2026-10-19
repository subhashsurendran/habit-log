# habit-log

Personal Android and iOS habit log. One month on the device. Not part of prarambh.

The name shown in the app is MyDTC. The tagline is "Small checks. Lasting habits." The GitHub repo stays habit-log. There is no store listing.

## Run on a Mac

```bash
cd ~/Projects/habit-log
npm install
npm run web
```

That opens MyDTC in the browser. Four tabs sit at the bottom: Home, Today, Score, and Templates. Home asks what to call you the first time, then greets you by name. The mark and the tagline stay on Home. Track today opens this month. Back, on every other screen, returns one step. Exit returns to Home. Neither control covers the grid or the tab bar.

Today is the month grid, with the month and year just above it. Home has Track today and a quiet Create a habit, which opens the add-row flow. Score is this month's efficiency. Templates lets you name a list, add habits, and save it. Starting a month from a template copies those habits only. Day marks are not part of the template.

A mute control on Home remembers whether the calm loop plays. The loop starts on a tap. The name and that choice stay on the device.

Expo 58 asks for Node 22. Node 20 can still start this project. If `npm run web` stops and asks for a newer Node, install Node 22 (`nvm install 22 && nvm use 22`) and run `npm install` again.

On a phone, install Expo Go, then:

```bash
npm start
```

Scan the QR code. Marks stay in a database on that device. There is no account and no network sync.

`npm run ios` and `npm run android` open a simulator when Xcode or Android Studio is installed.

## What the grid does

Task names stay on the left. The days across the top match that month, so February stops at 28, or 29 in a leap year. Each column shows the weekday as M, T, W, Th, F, S, or Su. Saturday and Sunday are shaded.

- Add a row as Tick, Timer, Journal, or Checklist. Wake up is a timer. Meditation and Reading stay ticks. Medicine and Supplement add a starting tag (tablets or fitness) and do not change the row name.
- A tick cycles blank, tick, cross. Hold the cell for a short note. A timer shows a clock such as 6:30 AM, and you can switch AM and PM. It never shows a tick.
- A journal cell opens a page for a note, one photo, or "Wrote it in my diary". The photo is a file on the device. If that file cannot be saved, the photo is refused and the note can still be saved.
- A checklist row is the main task. Tap that row name, then Add a subtask. The same control is on the day cell. Subtasks stay on today. The cell shows how many are done, such as 2/3. It is not a tick. An empty checklist becomes a cross only when the day is wrapped and the miss flag is on.
- Adding a fourth task asks if you can complete all of them today. A day with more than 12 checklist tasks asks if you can finish that many in a day. You choose. One list stops at 24 tasks.
- Checklist rows copy unfinished tasks to the next day when that day is wrapped. The original day still shows what was finished. This is on by default. Turn it off on the row if each day should start empty. The copy stays inside the current month, and the next day never grows past three tasks.
- Tick and timer rows can store a follow-up a whole number of hours after the mark. 8 hours is the shortcut. The browser keeps that number and does not notify you. Checklist rows have no follow-up.
- The month starts blank. A cross is added only after a day has passed, and only from the day you first opened that month. Days before you started stay blank. Today stays blank until you wrap up.
- Wrap up day sits next to Add row. It fills today's empty miss-rows with a cross and locks the rows. Marks already made stay put. Unlock rows if you still need a change.
- Each row says "Empty day counts as a miss." That is on by default. The cell stays blank until that day has passed. Turn it off and a blank is not a miss.
- Tags are short labels on the row. A task can have 3. A fourth tag is refused, and the ones already there stay. A stored row with more than 3 keeps the first 3. Tags do not change the cell.
- Month score sits with the top buttons. It counts days from when you started through today. A tick, a filled timer, a finished journal, or a checklist with every line checked is done. A cross is a miss. An empty cell is a miss only when that row counts blanks, and only after the day has passed or been wrapped. Efficiency is done divided by done plus miss. With nothing to count, the screen says "No closed days yet". Focus lists up to three rows or tags with the most misses.

The first open of a month starts with three empty rows: Wake up, Meditation, and Reading.

## Check types

```bash
npm run typecheck
```

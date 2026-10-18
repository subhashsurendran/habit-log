# habit-log

Personal Android and iOS habit log. One month on the device. Not part of prarambh.

The name shown in the app is Pencheck. The GitHub repo stays habit-log.

## Run on a Mac

```bash
cd ~/Projects/habit-log
npm install
npm run web
```

That opens the current month in the browser.

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
- A journal cell opens a page for a note, one photo, or "Wrote it in my diary".
- A checklist cell holds up to three tasks for that day. Name the row yourself, for example Most Important Tasks of the Day. The cell shows how many are done, such as 2/3. It is not a tick. An empty checklist becomes a cross only when the day is wrapped and the miss flag is on.
- Checklist rows copy unfinished tasks to the next day when that day is wrapped. The original day still shows what was finished. This is on by default. Turn it off on the row if each day should start empty. The copy stays inside the current month, and the next day never grows past three tasks.
- Tick and timer rows can store a follow-up a whole number of hours after the mark. 8 hours is the shortcut. The browser keeps that number and does not notify you. Checklist rows have no follow-up.
- Wrap up day sits next to Add row. It fills today's empty miss-rows with a cross and locks the rows. Earlier empty miss-rows wrap when the month opens. Marks already made stay put. Unlock rows if you still need a change.
- Each row says "Empty day counts as a miss." That is on by default. The cell stays blank until wrap-up. Turn it off and a blank is not a miss.
- Tags are short labels on the row. They do not change the cell.

The first open of a month starts with three empty rows: Wake up, Meditation, and Reading.

## Check types

```bash
npm run typecheck
```

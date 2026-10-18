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

Habit names stay on the left. Days 1–31 scroll across the top.

- Add a row as Tick, Timer, or Journal. Wake up is a timer. Meditation and Reading stay ticks. Medicine and Supplement add a starting tag (tablets or fitness) and do not change the row name.
- A tick cycles blank, tick, cross. Hold the cell for a short note. A timer shows a clock such as 6:30 AM, and you can switch AM and PM. It never shows a tick.
- A journal cell opens a page for a note, one photo, or "Wrote it in my diary".
- Tick and timer rows can store a follow-up a whole number of hours after the mark. 8 hours is the shortcut. The browser keeps that number and does not notify you.
- Wrap up day sits next to Add row. It fills today's empty miss-rows with a cross. Earlier empty miss-rows wrap when the month opens. Marks already made stay put.
- Each row says "Empty day counts as a miss." That is on by default. The cell stays blank until wrap-up. Turn it off and a blank is not a miss.
- Tags are short labels on the row. They do not change the cell.

The first open of a month starts with three empty rows: Wake up, Meditation, and Reading.

## Check types

```bash
npm run typecheck
```

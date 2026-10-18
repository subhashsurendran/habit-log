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

- Add a row as Tick or Time. Wake up stays Time. Sleep Time is Time too. Meditation and Reading stay Tick.
- A tick cycles blank, tick, cross, then blank. A time stores a value such as 630 and never shows a tick or a cross.
- Each row says "Empty day counts as a miss." That is on by default. The cell stays blank. Turn it off and a blank is not a miss.
- Rename a row, move it, or remove it. Then lock the month. Names stay fixed. Days can still be marked. Unlock if a name still needs a change.

The first open of a month starts with three empty rows: Wake up, Meditation, and Reading.

## Check types

```bash
npm run typecheck
```

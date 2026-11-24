/**
 * Times the mark paint against the encrypt the old tap waited on.
 * Run: node --experimental-strip-types scripts/measure-mark-paint.mjs
 * Prints durations only. It does not print habit names.
 */
import { performance } from "node:perf_hooks";

import { encryptAesGcm } from "../src/aesGcm.ts";
import { cycleTickMonth } from "../src/markPaint.ts";

const key = new Uint8Array(32).fill(7);
const iv = new Uint8Array(12).fill(3);

function seal(bytes) {
  const plain = new Uint8Array(bytes);
  const started = performance.now();
  encryptAesGcm(key, iv, plain);
  return performance.now() - started;
}

const month = {
  id: "2026-11",
  year: 2026,
  month: 11,
  locked: false,
  startedOn: "2026-11-01",
  wrappedDates: [],
  habits: [],
  records: [],
};

function paint() {
  const started = performance.now();
  let current = month;
  current = cycleTickMonth(current, "habit", "2026-11-23").month;
  current = cycleTickMonth(current, "habit", "2026-11-23").month;
  current = cycleTickMonth(current, "habit", "2026-11-23").month;
  return performance.now() - started;
}

paint();
const paints = [];
for (let index = 0; index < 1000; index += 1) paints.push(paint());
paints.sort((left, right) => left - right);
const paintMedian = paints[Math.floor(paints.length / 2)];
const paintMax = paints[paints.length - 1];

const sizes = [64 * 1024, 128 * 1024, 256 * 1024, 512 * 1024, 1024 * 1024];
console.log(`paint median ms ${paintMedian.toFixed(4)}`);
console.log(`paint max ms ${paintMax.toFixed(4)}`);
for (const size of sizes) {
  seal(size);
  const samples = [seal(size), seal(size), seal(size)];
  console.log(`seal ${size} bytes ms ${samples.map((sample) => sample.toFixed(1)).join(" ")}`);
}

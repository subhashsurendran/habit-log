"use strict";

const fs = require("node:fs");
const path = require("node:path");

// Original calm loop: four sine tones and a slow breath.
// Each tone completes a whole number of cycles so the file can repeat.
const sampleRate = 22050;
const seconds = 6;
const samples = sampleRate * seconds;
const pcm = Buffer.alloc(samples * 2);

function tone(t, freq) {
  return Math.sin(2 * Math.PI * freq * t);
}

for (let i = 0; i < samples; i += 1) {
  const t = i / sampleRate;
  const breath = 0.65 + 0.35 * Math.sin(2 * Math.PI * 0.5 * t);
  const mixed = 0.45 * tone(t, 196) + 0.28 * tone(t, 247) + 0.18 * tone(t, 294) + 0.08 * tone(t, 392);
  const value = Math.max(-1, Math.min(1, mixed * breath * 0.22));
  pcm.writeInt16LE(Math.round(value * 32767), i * 2);
}

const header = Buffer.alloc(44);
header.write("RIFF", 0);
header.writeUInt32LE(36 + pcm.length, 4);
header.write("WAVE", 8);
header.write("fmt ", 12);
header.writeUInt32LE(16, 16);
header.writeUInt16LE(1, 20);
header.writeUInt16LE(1, 22);
header.writeUInt32LE(sampleRate, 24);
header.writeUInt32LE(sampleRate * 2, 28);
header.writeUInt16LE(2, 32);
header.writeUInt16LE(16, 34);
header.write("data", 36);
header.writeUInt32LE(pcm.length, 40);

const out = path.join(__dirname, "..", "assets", "calm-loop.wav");
fs.writeFileSync(out, Buffer.concat([header, pcm]));
process.stdout.write(`Wrote ${out} (${header.length + pcm.length} bytes)\n`);

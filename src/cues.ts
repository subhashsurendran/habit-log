import { createAudioPlayer, type AudioPlayer } from "expo-audio";

const tickSource = require("../assets/tick.wav") as number;
const nightSource = require("../assets/night.wav") as number;

let tickPlayer: AudioPlayer | null = null;
let nightPlayer: AudioPlayer | null = null;
let soundOn = false;

/** Sound stays off until Profile turns it on. */
export function setCueSound(on: boolean): void {
  soundOn = on;
  if (!on) {
    try {
      tickPlayer?.pause();
      nightPlayer?.pause();
    } catch {
      // Already stopped.
    }
  }
}

function play(source: number, current: AudioPlayer | null): AudioPlayer | null {
  if (!soundOn) return current;
  try {
    const player = current ?? createAudioPlayer(source);
    void player.seekTo(0).then(() => {
      player.play();
    });
    return player;
  } catch {
    return current;
  }
}

export function playTick(): void {
  tickPlayer = play(tickSource, tickPlayer);
}

export function playNight(): void {
  nightPlayer = play(nightSource, nightPlayer);
}

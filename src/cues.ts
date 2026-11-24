import { createAudioPlayer, preload, setAudioModeAsync, type AudioPlayer } from "expo-audio";

const tickSource = require("../assets/tick.wav") as number;
const nightSource = require("../assets/night.wav") as number;

type Cue = {
  source: number;
  player: AudioPlayer | null;
};

const tick: Cue = { source: tickSource, player: null };
const night: Cue = { source: nightSource, player: null };

let soundOn = false;

/** Buffer the local cues once. This does not play them. Web preload may return nothing. */
function bufferCue(source: number): void {
  try {
    const pending = preload(source) as Promise<void> | undefined;
    if (pending && typeof pending.catch === "function") void pending.catch(() => undefined);
  } catch {
    // The cue can still be created when it is played.
  }
}

bufferCue(tickSource);
bufferCue(nightSource);

/** Sound stays off until Profile turns it on. Does not play. */
export function setCueSound(on: boolean): void {
  soundOn = on;
  if (on) return;
  try {
    tick.player?.pause();
    night.player?.pause();
  } catch {
    // Already stopped.
  }
}

function armPlayback(): Promise<void> {
  return setAudioModeAsync({
    playsInSilentMode: true,
    allowsRecording: false,
    interruptionMode: "mixWithOthers",
  }).catch(() => undefined);
}

function playerFor(cue: Cue): AudioPlayer | null {
  if (cue.player) return cue.player;
  try {
    const player = createAudioPlayer(cue.source);
    player.loop = false;
    cue.player = player;
    return player;
  } catch {
    return null;
  }
}

function playCue(cue: Cue): void {
  if (!soundOn) return;
  const player = playerFor(cue);
  if (!player) return;
  void armPlayback().then(() => {
    if (!soundOn) return;
    try {
      player.loop = false;
      // Do not wait on seekTo. A rejected seek used to skip play() entirely.
      void player.seekTo(0).catch(() => undefined);
      player.play();
    } catch {
      // A refused audio session should not block the grid.
    }
  });
}

export function playTick(): void {
  playCue(tick);
}

export function playNight(): void {
  playCue(night);
}

/** Profile switched to Sound on. The tick is the short cue they can hear. */
export function previewCueSound(): void {
  setCueSound(true);
  playTick();
}

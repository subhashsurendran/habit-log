import {
  createAudioPlayer,
  setAudioModeAsync,
  setIsAudioActiveAsync,
  type AudioPlayer,
  type AudioStatus,
} from "expo-audio";

const tickSource = require("../assets/tick.wav") as number;
const nightSource = require("../assets/night.wav") as number;

type Cue = {
  source: number;
  player: AudioPlayer | null;
  token: number;
};

const tick: Cue = { source: tickSource, player: null, token: 0 };
const night: Cue = { source: nightSource, player: null, token: 0 };

let soundOn = false;

/**
 * Sound stays off until Profile turns it on. Does not play.
 * Opening the app and re-rendering Profile must not play a cue.
 */
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

/**
 * expo-audio 58.0.9 starts play() and only then activates the session, on a
 * side queue. This tick is 0.12s, so it finished before the speaker was on.
 * A seek fired at the same time cancelled that play. The iOS default for
 * playsInSilentMode is false, so an unarmed session is also silent on the
 * ring/silent switch. Arm playback, wait until the file is loaded, seek, then play.
 */
async function armPlayback(): Promise<void> {
  await setAudioModeAsync({
    playsInSilentMode: true,
    allowsRecording: false,
    interruptionMode: "mixWithOthers",
    shouldPlayInBackground: false,
  });
  await setIsAudioActiveAsync(true);
}

function playerFor(cue: Cue): AudioPlayer | null {
  if (cue.player) return cue.player;
  try {
    const player = createAudioPlayer(cue.source);
    player.loop = false;
    player.volume = 1;
    player.muted = false;
    cue.player = player;
    return player;
  } catch {
    return null;
  }
}

function whenLoaded(player: AudioPlayer): Promise<void> {
  if (player.isLoaded) return Promise.resolve();
  return new Promise((resolve) => {
    let settled = false;
    const finish = () => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      subscription.remove();
      resolve();
    };
    const timer = setTimeout(finish, 800);
    const subscription = player.addListener("playbackStatusUpdate", (status: AudioStatus) => {
      if (status.isLoaded) finish();
    });
  });
}

function playCue(cue: Cue): void {
  if (!soundOn) return;
  const token = cue.token + 1;
  cue.token = token;
  void (async () => {
    try {
      await armPlayback();
      if (!soundOn || cue.token !== token) return;
      const player = playerFor(cue);
      if (!player) return;
      player.loop = false;
      player.volume = 1;
      player.muted = false;
      await whenLoaded(player);
      if (!soundOn || cue.token !== token) return;
      try {
        await player.seekTo(0);
      } catch {
        // The file can still start from the beginning.
      }
      if (!soundOn || cue.token !== token) return;
      player.play();
    } catch {
      // A refused audio session should not block the grid.
    }
  })();
}

export function playTick(): void {
  playCue(tick);
}

export function playNight(): void {
  playCue(night);
}

/** Profile switched to Sound on. One tick, from that tap, not from a later render. */
export function previewCueSound(): void {
  setCueSound(true);
  playTick();
}

import { useAudioPlayer } from "expo-audio";
import { forwardRef, useImperativeHandle } from "react";

export type CalmLoopHandle = {
  start: () => void;
  stop: () => void;
};

/**
 * No welcome track until a local file is assigned here.
 * Leave this null. Do not point it at a download.
 */
const WELCOME_TRACK: number | null = null;

/** Player stays mounted and silent until a local track is assigned. */
export const CalmLoop = forwardRef<CalmLoopHandle>(function CalmLoop(_props, ref) {
  const player = useAudioPlayer(WELCOME_TRACK, { updateInterval: 1000 });

  useImperativeHandle(
    ref,
    () => ({
      start() {
        if (WELCOME_TRACK == null) return;
        try {
          player.loop = true;
          player.volume = 0.32;
          player.play();
        } catch {
          // A refused audio session should not block the grid.
        }
      },
      stop() {
        try {
          player.pause();
        } catch {
          // Already stopped.
        }
      },
    }),
    [player],
  );

  return null;
});

import { useAudioPlayer } from "expo-audio";
import { forwardRef, useImperativeHandle } from "react";

export type CalmLoopHandle = {
  start: () => void;
  stop: () => void;
};

/** Original synthesized tone. Playback starts only from a call inside a tap. */
export const CalmLoop = forwardRef<CalmLoopHandle>(function CalmLoop(_props, ref) {
  const player = useAudioPlayer(require("../assets/calm-loop.wav"), { updateInterval: 1000 });

  useImperativeHandle(
    ref,
    () => ({
      start() {
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

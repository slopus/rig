const RESET = "\x1b[0m";
export const ACTIVITY_WAVE_FRAME_COUNT = 12;

export function renderActivityWave(text: string, frame: number): string {
  return `${Array.from(text)
    .map((character, index) => {
      if (character === " ") {
        return character;
      }

      return `\x1b[38;5;${activityWaveColor(index, frame)}m${character}`;
    })
    .join("")}${RESET}`;
}

function activityWaveColor(index: number, frame: number): number {
  const phase = positiveModulo(index - frame, ACTIVITY_WAVE_FRAME_COUNT);
  const distance = Math.min(phase, ACTIVITY_WAVE_FRAME_COUNT - phase);
  if (distance === 0) return 255;
  if (distance === 1) return 253;
  if (distance === 2) return 250;
  if (distance === 3) return 247;
  return 244;
}

function positiveModulo(value: number, modulus: number): number {
  return ((value % modulus) + modulus) % modulus;
}

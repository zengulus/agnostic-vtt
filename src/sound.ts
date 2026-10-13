let context: AudioContext | null = null,
  lastImpact = 0;
export function unlockSound() {
  try {
    context ||= new AudioContext();
    if (context.state === 'suspended') void context.resume();
  } catch {
    /* Audio is optional. */
  }
}
export function playTone(volume: number, impact = false) {
  if (impact && performance.now() - lastImpact < 95) return;
  if (impact) lastImpact = performance.now();
  try {
    if (!context || context.state !== 'running' || !volume) return;
    const oscillator = context.createOscillator(),
      gain = context.createGain(),
      time = context.currentTime;
    oscillator.type = impact ? 'triangle' : 'sine';
    oscillator.frequency.setValueAtTime(impact ? 170 : 660, time);
    oscillator.frequency.exponentialRampToValueAtTime(impact ? 85 : 880, time + 0.12);
    gain.gain.setValueAtTime(volume * (impact ? 0.06 : 0.14), time);
    gain.gain.exponentialRampToValueAtTime(0.001, time + (impact ? 0.13 : 0.45));
    oscillator.connect(gain);
    gain.connect(context.destination);
    oscillator.start();
    oscillator.stop(time + (impact ? 0.15 : 0.5));
  } catch {
    /* Audio is optional. */
  }
}

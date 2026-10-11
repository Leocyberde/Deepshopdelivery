// Web Audio API notification chime for Admin Panel (New Orders & New Customers)
export function playAdminAlertSound(
  type: 'NEW_ORDER' | 'NEW_CUSTOMER' | 'TEST' = 'NEW_ORDER'
): void {
  try {
    const AudioCtx =
      window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
    if (!AudioCtx) return;

    const ctx = new AudioCtx();
    const now = ctx.currentTime;

    const notes =
      type === 'NEW_ORDER'
        ? [
            { freq: 587.33, start: 0, duration: 0.14 }, // D5
            { freq: 880.0, start: 0.15, duration: 0.16 }, // A5
            { freq: 1174.66, start: 0.33, duration: 0.28 }, // D6
          ]
        : [
            { freq: 523.25, start: 0, duration: 0.14 }, // C5
            { freq: 659.25, start: 0.15, duration: 0.22 }, // E5
          ];

    for (const note of notes) {
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.type = 'sine';
      osc.frequency.setValueAtTime(note.freq, now + note.start);

      gain.gain.setValueAtTime(0.001, now + note.start);
      gain.gain.exponentialRampToValueAtTime(0.22, now + note.start + 0.02);
      gain.gain.exponentialRampToValueAtTime(0.001, now + note.start + note.duration);

      osc.connect(gain);
      gain.connect(ctx.destination);

      osc.start(now + note.start);
      osc.stop(now + note.start + note.duration + 0.02);
    }

    setTimeout(() => {
      ctx.close().catch(() => {});
    }, 900);
  } catch {
    // Ignore if browser blocked autoplay before user interaction
  }
}

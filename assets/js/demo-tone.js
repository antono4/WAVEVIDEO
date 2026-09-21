/**
 * Procedural demo audio.
 *
 * Generates a short looping bed with a clear kick so every control in the
 * studio can be demonstrated without the visitor having to find a file first.
 * Written as an offline-rendered WAV, which decodes through the same path as a
 * user file.
 */

const SAMPLE_RATE = 44100;

function encodeWav(samples, sampleRate = SAMPLE_RATE) {
  const buffer = new ArrayBuffer(44 + samples.length * 2);
  const view = new DataView(buffer);
  const writeString = (offset, str) => {
    for (let i = 0; i < str.length; i++) view.setUint8(offset + i, str.charCodeAt(i));
  };
  writeString(0, 'RIFF');
  view.setUint32(4, 36 + samples.length * 2, true);
  writeString(8, 'WAVE');
  writeString(12, 'fmt ');
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true);
  view.setUint16(22, 1, true);
  view.setUint32(24, sampleRate, true);
  view.setUint32(28, sampleRate * 2, true);
  view.setUint16(32, 2, true);
  view.setUint16(34, 16, true);
  writeString(36, 'data');
  view.setUint32(40, samples.length * 2, true);
  let offset = 44;
  for (let i = 0; i < samples.length; i++) {
    const s = Math.max(-1, Math.min(1, samples[i]));
    view.setInt16(offset, s < 0 ? s * 0x8000 : s * 0x7fff, true);
    offset += 2;
  }
  return new Blob([buffer], { type: 'audio/wav' });
}

/** ADSR helper returning a 0..1 envelope value at time `t` within a note. */
function envelope(t, dur, attack = 0.005, release = 0.06) {
  if (t < 0 || t > dur) return 0;
  if (t < attack) return t / attack;
  if (t > dur - release) return Math.max(0, (dur - t) / release);
  return 1;
}

/**
 * Build a demo track.
 * @param {number} seconds
 * @param {number} bpm
 */
export function createDemoTone(seconds = 12, bpm = 100) {
  const total = Math.floor(seconds * SAMPLE_RATE);
  const out = new Float32Array(total);
  const beat = 60 / bpm;
  const step = beat / 2; // eighth notes

  const scale = [220, 261.63, 293.66, 329.63, 392, 440, 523.25];

  for (let i = 0; i < total; i++) {
    const t = i / SAMPLE_RATE;
    const beatIndex = Math.floor(t / beat);
    const beatPhase = t - beatIndex * beat;
    let sample = 0;

    // Kick on every beat: fast downward pitch sweep with a tight envelope.
    const kickEnv = envelope(beatPhase, 0.22, 0.002, 0.16);
    if (kickEnv > 0) {
      const f = 120 * Math.exp(-beatPhase * 22) + 42;
      sample += Math.sin(2 * Math.PI * f * beatPhase) * kickEnv * 0.55;
    }

    // Hat on the offbeat for rhythmic definition.
    const offPhase = t - (beatIndex * beat + beat / 2);
    const hatEnv = envelope(offPhase, 0.06, 0.001, 0.05);
    if (hatEnv > 0) {
      sample += (Math.random() * 2 - 1) * hatEnv * 0.08;
    }

    // Arpeggio across the scale, one note per eighth.
    const stepIndex = Math.floor(t / step);
    const stepPhase = t - stepIndex * step;
    const note = scale[stepIndex % scale.length];
    const noteEnv = envelope(stepPhase, step * 0.95, 0.01, step * 0.5);
    if (noteEnv > 0) {
      const detune = 1 + 0.003 * Math.sin(2 * Math.PI * 0.7 * t);
      sample += Math.sin(2 * Math.PI * note * detune * stepPhase) * noteEnv * 0.16;
      sample += Math.sin(2 * Math.PI * note * 2 * stepPhase) * noteEnv * 0.05;
    }

    // Slow bass pad follows the bar root.
    const barRoot = scale[(beatIndex >> 2) % 3] / 2;
    sample += Math.sin(2 * Math.PI * barRoot * t) * 0.1;

    // Gentle fade in and out so the file never starts or ends on a click.
    const fade = Math.min(1, t / 0.4, (seconds - t) / 1.2);
    out[i] = sample * 0.8 * Math.max(0, fade);
  }

  return encodeWav(out);
}

export const DEMO_NAME = 'wavevideo-demo-tone.wav';
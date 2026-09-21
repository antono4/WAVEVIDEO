import { formatTime, formatBytes, clamp } from './utils.js';

/**
 * Canvas recorder for video export.
 *
 * Video comes from canvas.captureStream(); audio is added as a second track
 * from the analyser graph so the rendered file carries the soundtrack. The
 * recorder is driven by a manual frame pump rather than requestAnimationFrame
 * so frame pacing stays as close to the requested fps as the tab allows.
 */

const MIME_CANDIDATES = [
  'video/webm;codecs=vp9,opus',
  'video/webm;codecs=vp8,opus',
  'video/webm;codecs=h264,opus',
  'video/webm',
  'video/mp4;codecs=avc1,mp4a',
  'video/mp4'
];

export function pickMimeType() {
  if (typeof MediaRecorder === 'undefined') return '';
  for (const type of MIME_CANDIDATES) {
    if (typeof MediaRecorder.isTypeSupported === 'function' && MediaRecorder.isTypeSupported(type)) return type;
  }
  return '';
}

export function isSupported() {
  return typeof MediaRecorder !== 'undefined'
    && typeof HTMLCanvasElement.prototype.captureStream === 'function'
    && pickMimeType() !== '';
}

export class Exporter {
  /**
   * @param {object} deps
   * @param {HTMLCanvasElement} deps.canvas
   * @param {import('./audio.js').AudioEngine} deps.audio
   * @param {(progress:object)=>void} deps.onProgress
   */
  constructor({ canvas, audio, onProgress, onFrame }) {
    this.canvas = canvas;
    this.audio = audio;
    this.onProgress = onProgress || (() => {});
    this.onFrame = onFrame || (() => {});
    this.recorder = null;
    this.stream = null;
    this.videoTrack = null;
    this.chunks = [];
    this.state = 'idle';
    this._pumpHandle = 0;
    this._startedAt = 0;
    this._frame = 0;
    this._lastEmit = 0;
  }

  get recording() {
    return this.state === 'recording';
  }

  /** Estimated recording wall time for the given range. */
  static estimateSeconds({ start, end }) {
    return Math.max(0, end - start);
  }

  /**
   * Begin recording.
   * @param {object} o
   * @param {number} o.fps
   * @param {number} o.bitrate
   * @param {number} o.start range start in seconds
   * @param {number} o.end range end in seconds
   * @param {() => number} o.currentTime returns the playhead in seconds
   * @param {() => Promise<void>} o.onStart called after the recorder starts
   */
  async start({ fps, bitrate, start, end, currentTime, onStart }) {
    if (this.state !== 'idle') throw new Error('An export is already running');
    const mimeType = pickMimeType();
    if (!mimeType) throw new Error('This browser cannot record video (MediaRecorder unavailable)');

    this._rangeStartValue = start;

    const stream = this.canvas.captureStream(0);
    const videoTrack = stream.getVideoTracks()[0] || null;
    this.videoTrack = videoTrack;
    // captureStream(0) disables automatic capture, so every frame is pulled
    // explicitly. That gives exact frame pacing and guarantees the encoder
    // always receives frames, which automatic capture does not on all builds.
    const manualFrames = !!videoTrack && typeof videoTrack.requestFrame === 'function';
    if (!manualFrames) {
      // Fall back to automatic capture where requestFrame is unavailable.
      stream.getTracks().forEach((t) => t.stop());
      const auto = this.canvas.captureStream(Number(fps) || 30);
      this.stream = auto;
      this.videoTrack = auto.getVideoTracks()[0] || null;
    } else {
      this.stream = stream;
    }

    const activeStream = this.stream;
    const audioTrack = this.audio.attachRecorder();
    if (audioTrack) activeStream.addTrack(audioTrack);
    this.chunks = [];
    this.recorder = new MediaRecorder(activeStream, {
      mimeType,
      videoBitsPerSecond: Number(bitrate) || 8_000_000
    });
    this.recorder.ondataavailable = (e) => {
      if (e.data && e.data.size) this.chunks.push(e.data);
    };

    const finished = new Promise((resolve, reject) => {
      this.recorder.onstop = () => {
        // requestData() flushes frames still buffered in the encoder.
        try { this.recorder?.requestData(); } catch { /* nothing to flush */ }
        resolve();
      };
      this.recorder.onerror = (e) => reject(e.error || new Error('Recorder error'));
    });

    this.state = 'recording';
    this._startedAt = performance.now();
    this._frame = 0;
    this.recorder.start(1000);

    if (onStart) await onStart();

    this._pump({ fps, start, end, currentTime });

    await finished;

    this.audio.detachRecorder();
    const type = this.recorder.mimeType || mimeType;
    const blob = new Blob(this.chunks, { type });
    this.recorder = null;
    this.stream = null;
    this.videoTrack = null;
    this.state = 'idle';
    return { blob, mimeType: type, frames: this._frame, hasAudio: !!audioTrack };
  }

  /**
   * Drive frame capture. Uses requestAnimationFrame when the tab is visible and
   * a timer when it is not, because background tabs throttle rAF to roughly 1
   * frame per second which would otherwise stall the export.
   */
  _pump({ fps, start, end, currentTime }) {
    const frameInterval = 1000 / (Number(fps) || 30);
    let last = 0;

    const tick = (now) => {
      if (this.state !== 'recording') return;
      if (now - last >= frameInterval - 1) {
        last = now;
        this._frame++;
        // Requesting the frame after the app has drawn it keeps the encoder in
        // step with the canvas content.
        this.onFrame();
        try { this.videoTrack?.requestFrame(); } catch { /* track ended */ }
      }
      const elapsed = (performance.now() - this._startedAt) / 1000;
      const t = currentTime();
      const remaining = Math.max(0, end - t);
      const span = Math.max(1e-6, end - start);
      if (now - this._lastEmit > 120) {
        this._lastEmit = now;
        this.onProgress({
          elapsed,
          playhead: t,
          end,
          remaining,
          frames: this._frame,
          ratio: clamp((t - start) / span, 0, 1),
          eta: remaining
        });
      }
      if (t >= end - 0.04) {
        this.stop();
        return;
      }
      this._pumpHandle = typeof requestAnimationFrame === 'function' && !document.hidden
        ? requestAnimationFrame(tick)
        : setTimeout(() => tick(performance.now()), frameInterval);
    };

    this._pumpHandle = requestAnimationFrame(tick);
  }

  stop() {
    if (this.state !== 'recording') return;
    if (this._pumpHandle) {
      cancelAnimationFrame(this._pumpHandle);
      clearTimeout(this._pumpHandle);
      this._pumpHandle = 0;
    }
    try {
      if (this.recorder && this.recorder.state !== 'inactive') this.recorder.stop();
    } catch { /* already stopped */ }
  }

  /** Abort without keeping the result. */
  cancel() {
    if (this.state === 'idle') return;
    this.chunks = [];
    this.stop();
  }

  /**
   * Human-readable summary line for the export panel.
   */
  static describe({ duration, fps, bitrate }) {
    const sizeMb = (Number(bitrate) / 8 / 1024 / 1024) * duration;
    return `${formatTime(duration)} at ${fps} fps · about ${formatBytes(sizeMb * 1024 * 1024)} estimated`;
  }
}
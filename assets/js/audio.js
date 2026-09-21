import { clamp } from './utils.js';

/**
 * Web Audio playback and analysis.
 *
 * Graph:  source -> gain -> analyser -> destination
 *                    \-> recordDest (added during export)
 *
 * Two source strategies are supported. Decoded AudioBuffer sources give exact
 * scheduling; an <audio> element is the fallback for containers the decoder
 * rejects (some M4A/AAC files). Both feed the same analyser.
 */
export class AudioEngine {
  constructor(onEnded) {
    this.onEnded = onEnded || (() => {});
    this.ctx = null;
    this.gain = null;
    this.analyser = null;
    this.recordDest = null;
    this.buffer = null;
    this.el = null;
    this.source = null;
    this.usingElement = false;
    this.connectedElement = false;

    this.freq = null;
    this.wave = null;
    this.bins = new Float32Array(256);
    this.energy = 0;
    this.bass = 0;
    this.beat = 0;
    this._prevBass = 0;

    this.playing = false;
    this._offset = 0;
    this._startedAt = 0;
    this._wallStart = 0;
    this._clock = 'audio';
  }

  /* ------------------------------------------------------------- lifecycle */

  ensureContext() {
    if (!this.ctx) {
      const AC = window.AudioContext || window.webkitAudioContext;
      this.ctx = new AC();
      this.analyser = this.ctx.createAnalyser();
      this.analyser.fftSize = 2048;
      this.analyser.smoothingTimeConstant = 0.75;
      this.freq = new Uint8Array(this.analyser.frequencyBinCount);
      this.wave = new Uint8Array(this.analyser.fftSize);
      this.gain = this.ctx.createGain();
      this.gain.connect(this.analyser);
      this.analyser.connect(this.ctx.destination);
    }
    return this.ctx;
  }

  /**
   * Resume the context and report whether it is actually running.
   *
   * Chrome can leave resume() pending indefinitely when the page has no user
   * activation, so the attempt is raced against a timeout. A frozen promise
   * must never block playback, and callers that need real audio (the recorder)
   * check the returned state before relying on the graph.
   */
  async resume(timeoutMs = 900) {
    if (!this.ctx) return 'closed';
    if (this.ctx.state === 'running') return 'running';
    try {
      await Promise.race([
        this.ctx.resume(),
        new Promise((resolve) => setTimeout(resolve, timeoutMs))
      ]);
    } catch {
      /* activation still required */
    }
    return this.ctx.state;
  }

  /** True when the audio graph can actually emit samples. */
  get isRunning() {
    return !!this.ctx && this.ctx.state === 'running';
  }

  /* ---------------------------------------------------------------- loading */

  /** Decode an ArrayBuffer into the buffer source path. Throws on failure. */
  async decode(arrayBuffer) {
    this.ensureContext();
    const buf = await new Promise((resolve, reject) => {
      const p = this.ctx.decodeAudioData(arrayBuffer, resolve, reject);
      if (p && p.then) p.then(resolve, reject);
    });
    this.buffer = buf;
    this._teardownElement();
    this.usingElement = false;
    this._offset = 0;
    return buf;
  }

  /** Fall back to an <audio> element, e.g. for unsupported containers. */
  useElement(src, { revokeOnReplace = false } = {}) {
    this.ensureContext();
    if (this.el && this._objectUrl && !revokeOnReplace) URL.revokeObjectURL(this._objectUrl);
    if (!this.el) {
      this.el = document.createElement('audio');
      this.el.crossOrigin = 'anonymous';
      this.el.preload = 'auto';
      this.el.addEventListener('ended', () => {
        if (this.playing) {
          this.playing = false;
          this.onEnded();
        }
      });
    }
    this.el.src = src;
    this._objectUrl = revokeOnReplace ? null : src;
    this.buffer = null;
    this._offset = 0;
    if (!this.connectedElement) {
      try {
        this.source = this.ctx.createMediaElementSource(this.el);
        this.source.connect(this.gain);
        this.connectedElement = true;
      } catch {
        /* already connected */
      }
    }
    this.usingElement = true;
  }

  _teardownElement() {
    if (this.el) {
      try { this.el.pause(); } catch { /* ignore */ }
    }
  }

  clear() {
    this.pause();
    this.buffer = null;
    this._teardownElement();
    this.el = null;
    this.usingElement = false;
    this.connectedElement = false;
    this.source = null;
    this._offset = 0;
  }

  /* -------------------------------------------------------------- transport */

  get duration() {
    if (this.buffer) return this.buffer.duration;
    if (this.el && Number.isFinite(this.el.duration)) return this.el.duration;
    return 0;
  }

  get currentTime() {
    if (!this.playing) return this._offset;
    if (this.buffer) {
      // The clock is chosen once in play() and kept for the whole run. Mixing
      // clocks mid-playback would let the playhead jump backwards when a
      // suspended AudioContext resumes partway through.
      const t = this._clock === 'wall'
        ? performance.now() / 1000 - this._wallStart
        : this.ctx.currentTime - this._startedAt;
      return clamp(t, 0, this.duration);
    }
    if (this.el) return this.el.currentTime || 0;
    return this._offset;
  }

  async play(offset) {
    if (!this.buffer && !this.el) return false;
    this.ensureContext();
    // Only the graph needs the context running; playback starts regardless so
    // a pending resume() can never stall the transport.
    this.resume();
    const from = clamp(offset === undefined ? this._offset : offset, 0, Math.max(0, this.duration - 0.001));
    this._stopSource();

    if (this.buffer) {
      const src = this.ctx.createBufferSource();
      src.buffer = this.buffer;
      src.connect(this.gain);
      src.onended = () => {
        if (this.playing && this.currentTime >= this.duration - 0.06) {
          this.playing = false;
          this._offset = this.duration;
          this.onEnded();
        }
      };
      src.start(0, from);
      this.source = src;
      this._startedAt = this.ctx.currentTime - from;
      this._wallStart = performance.now() / 1000 - from;
      // A suspended context cannot advance, so anchor to the wall clock when
      // the graph is not running. Otherwise trust the audio clock.
      this._clock = this.ctx.state === 'running' ? 'audio' : 'wall';
    } else {
      this.el.currentTime = from;
      const p = this.el.play();
      if (p && p.catch) p.catch(() => {});
    }
    this._offset = from;
    this.playing = true;
    return true;
  }

  pause() {
    if (this.buffer) this._offset = this.currentTime;
    else if (this.el) { try { this.el.pause(); } catch { /* ignore */ } }
    this._stopSource();
    this.playing = false;
  }

  stop() {
    this._stopSource();
    this._teardownElement();
    this._offset = 0;
    this.playing = false;
  }

  async seek(t) {
    const target = clamp(t, 0, Math.max(0, this.duration));
    if (this.playing) await this.play(target);
    else {
      this._offset = target;
      if (this.el) this.el.currentTime = target;
    }
    return target;
  }

  _stopSource() {
    if (this.source && !this.usingElement) {
      try {
        this.source.onended = null;
        this.source.stop();
      } catch { /* ignore */ }
    }
    if (!this.usingElement) this.source = null;
  }

  /** Apply gain, including fade in/out relative to the effective export range. */
  applyGain({ volume = 1, fadeIn = 0, fadeOut = 0, start = 0, end = 0 } = {}) {
    if (!this.gain || !this.ctx) return;
    const now = this.ctx.currentTime;
    const t = this.currentTime;
    const rangeEnd = end || this.duration;
    let v = volume;
    if (fadeIn > 0 && t < start + fadeIn) v *= clamp((t - start) / fadeIn, 0, 1);
    if (fadeOut > 0 && t > rangeEnd - fadeOut) v *= clamp((rangeEnd - t) / fadeOut, 0, 1);
    this.gain.gain.setTargetAtTime(v, now, 0.02);
  }

  setVolume(v) {
    if (!this.gain || !this.ctx) return;
    this.gain.gain.setTargetAtTime(v, this.ctx.currentTime, 0.02);
  }

  /* --------------------------------------------------------------- analysis */

  /**
   * Read the analyser and reduce it into `barCount` perceptually spaced bands.
   * Returns the shared bins array; callers must not retain it.
   */
  analyse({ barCount = 64, smoothing = 0.78, bassBoost = 0.15, gain = 1, beatSensitivity = 1.25 } = {}) {
    if (!this.analyser || !this.freq) {
      this.bins.fill(0);
      this.energy = 0;
      this.bass = 0;
      this.beat *= 0.9;
      return this.bins;
    }
    this.analyser.smoothingTimeConstant = clamp(smoothing, 0, 0.95);
    this.analyser.getByteFrequencyData(this.freq);
    this.analyser.getByteTimeDomainData(this.wave);

    const n = clamp(Math.round(barCount), 8, this.bins.length);
    const usable = Math.max(24, Math.floor(this.freq.length * 0.72));
    let sum = 0;
    let lowSum = 0;
    let lowCount = 0;

    for (let i = 0; i < n; i++) {
      const a = Math.floor(Math.pow(i / n, 1.7) * usable);
      const b = Math.max(a + 1, Math.floor(Math.pow((i + 1) / n, 1.7) * usable));
      let peak = 0;
      let acc = 0;
      let count = 0;
      for (let k = a; k < b && k < this.freq.length; k++) {
        const v = this.freq[k];
        if (v > peak) peak = v;
        acc += v;
        count++;
      }
      const avg = count ? acc / count : 0;
      const weight = 1 + bassBoost * Math.max(0, 1 - i / (n * 0.45));
      const target = clamp(((peak * 0.6 + avg * 0.4) / 255) * gain * weight, 0, 1.7);
      const prev = this.bins[i] || 0;
      // Fast attack, slow release keeps the movement musical.
      this.bins[i] = target > prev ? target : prev * 0.82 + target * 0.18;
      sum += this.bins[i];
      if (i < Math.max(2, n * 0.12)) { lowSum += this.bins[i]; lowCount++; }
    }

    const energy = n ? sum / n : 0;
    this.energy = this.energy * 0.85 + energy * 0.15;
    this.bass = lowCount ? lowSum / lowCount : 0;

    const rise = this.bass - this._prevBass;
    this._prevBass = this.bass;
    const threshold = 0.06 / clamp(beatSensitivity, 0.6, 2.4);
    if (rise > threshold && this.bass > 0.28) this.beat = 1;
    this.beat *= 0.9;
    return this.bins;
  }

  /* --------------------------------------------------------------- recording */

  /**
   * Route the master gain into a MediaStreamDestination for export.
   *
   * Returns null unless the context is actually running. Attaching an audio
   * track whose source graph is suspended makes the WebM muxer emit zero
   * bytes, silently producing an empty file, so a silent-but-working video is
   * strictly better than a broken container.
   */
  attachRecorder() {
    this.ensureContext();
    if (!this.isRunning) return null;
    if (!this.recordDest) this.recordDest = this.ctx.createMediaStreamDestination();
    try { this.gain.connect(this.recordDest); } catch { /* already connected */ }
    return this.recordDest.stream.getAudioTracks()[0] || null;
  }

  detachRecorder() {
    if (!this.recordDest) return;
    try { this.gain.disconnect(this.recordDest); } catch { /* ignore */ }
  }

  /** Peak envelope for the timeline, computed once per loaded track. */
  buildPeaks(buckets = 1400) {
    if (!this.buffer) return null;
    const channel = this.buffer.getChannelData(0);
    const per = Math.floor(channel.length / buckets) || 1;
    const peaks = new Float32Array(buckets * 2);
    for (let i = 0; i < buckets; i++) {
      const start = i * per;
      const end = Math.min(channel.length, start + per);
      let min = 1;
      let max = -1;
      for (let k = start; k < end; k += 2) {
        const v = channel[k];
        if (v < min) min = v;
        if (v > max) max = v;
      }
      peaks[i * 2] = min === 1 && max === -1 ? 0 : min;
      peaks[i * 2 + 1] = max === -1 ? 0 : max;
    }
    return peaks;
  }
}
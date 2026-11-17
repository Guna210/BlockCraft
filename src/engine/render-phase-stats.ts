/** Debug-only timing samples for the main-thread terrain frame. */
export const RENDER_PHASES = [
  'gameUpdateMs',
  'saveFrameMs',
  'frameClearMs',
  'menuRenderMs',
  'captureMs',
  'uiFrameMs',
  'hudFrameMs',
  'caveFrustumMs',
  'caveBfsMs',
  'frustumCullMs',
  'drawListMs',
  'translucentSortMs',
  'uniformUploadMs',
  'arenaUploadMs',
  'arenaPackMs',
  'arenaTransferMs',
  'uploadOverheadMs',
  'glErrorDrainMs',
  'drawSubmissionMs',
  'opaquePassMs',
  'cutoutPassMs',
  'depthCaptureMs',
  'translucentPassMs',
  'sectionUploadMs',
  'translucentUploadPrepMs',
  'meshBookkeepingMs',
  'tintPrepareMs',
  'tintTextureUploadMs',
  'tintTextureBindingMs',
  'editUploadMs',
  'streamerDrainMs',
  'streamerUploadCallbackMs',
  'streamerUpdateMs',
  'worldTickMs',
  'terrainRenderMs',
  'terrainSetupMs',
  'skyRenderMs',
  'underwaterUpdateMs',
  'chunkRendererMs',
  'entityRenderMs',
  'portalRenderMs',
  'selectionRenderMs',
  'cloudRenderMs',
  'underwaterTintMs',
  'weatherRenderMs',
  'particleStatsMs',
  'warpRenderMs',
  'otherFrameMs',
] as const;

export type RenderPhase = (typeof RENDER_PHASES)[number];
export type RenderPhaseStatsSnapshot = Record<RenderPhase, number> & { frames: number };

const SAMPLE_LIMIT = 2048;
const PHASE_COUNT = RENDER_PHASES.length;
const MEASURED_PHASES = [
  'gameUpdateMs',
  'saveFrameMs',
  'frameClearMs',
  'menuRenderMs',
  'captureMs',
  'uiFrameMs',
  'hudFrameMs',
  'caveFrustumMs',
  'drawListMs',
  'translucentSortMs',
  'uniformUploadMs',
  'arenaUploadMs',
  'uploadOverheadMs',
  'drawSubmissionMs',
  'depthCaptureMs',
  'streamerUpdateMs',
] as const;
const phaseIndex = new Map<RenderPhase, number>(
  RENDER_PHASES.map((phase, index) => [phase, index]),
);

/** Uses fixed storage while the frame runs; snapshot allocation happens only on a debug read. */
class RenderPhaseStats {
  enabled = false;
  private readonly samples = new Float64Array(SAMPLE_LIMIT * PHASE_COUNT);
  private readonly current = new Float64Array(PHASE_COUNT);
  private count = 0;
  private next = 0;

  reset(): void {
    this.count = 0;
    this.next = 0;
    this.current.fill(0);
    this.samples.fill(0);
  }

  beginFrame(): void {
    if (this.enabled) this.current.fill(0);
  }

  endFrame(frameCpuMs: number): void {
    if (!this.enabled) return;
    let measured = 0;
    for (const phase of MEASURED_PHASES) measured += this.current[phaseIndex.get(phase)!]!;
    const otherIndex = phaseIndex.get('otherFrameMs')!;
    this.current[otherIndex] = Math.max(0, frameCpuMs - measured);
    const offset = this.next * PHASE_COUNT;
    this.samples.set(this.current, offset);
    this.next = (this.next + 1) % SAMPLE_LIMIT;
    this.count = Math.min(SAMPLE_LIMIT, this.count + 1);
  }

  start(): number {
    return this.enabled ? performance.now() : 0;
  }

  end(phase: RenderPhase, start: number): void {
    if (this.enabled) {
      const index = phaseIndex.get(phase)!;
      this.current[index] = this.current[index]! + performance.now() - start;
    }
  }

  add(phase: RenderPhase, duration: number): void {
    if (this.enabled) {
      const index = phaseIndex.get(phase)!;
      this.current[index] = this.current[index]! + duration;
    }
  }

  currentValue(phase: RenderPhase): number {
    return this.enabled ? this.current[phaseIndex.get(phase)!]! : 0;
  }

  snapshot(): RenderPhaseStatsSnapshot {
    const result = { frames: this.count } as RenderPhaseStatsSnapshot;
    for (let phase = 0; phase < PHASE_COUNT; phase++) {
      const values = new Float64Array(this.count);
      const start = (this.next - this.count + SAMPLE_LIMIT) % SAMPLE_LIMIT;
      for (let i = 0; i < this.count; i++)
        values[i] = this.samples[((start + i) % SAMPLE_LIMIT) * PHASE_COUNT + phase]!;
      values.sort();
      result[RENDER_PHASES[phase]!] = values[Math.floor(this.count * 0.95)] ?? 0;
    }
    return result;
  }
}

export const renderPhaseStats = new RenderPhaseStats();

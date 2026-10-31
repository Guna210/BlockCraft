/** Consumed by the per-dimension runtime; no Overworld update hooks or load scans. */
export const HOLLOWDEEP_ENVIRONMENT = {
  fogColor: [0.12, 0.065, 0.19],
  fogDensity: 0.018,
  skyLight: 0,
  spores: {
    color: [0.55, 0.95, 0.8],
    particlesPerSecond: 12,
    radius: 18,
    lifetimeSeconds: 8,
    riseSpeed: 0.18,
    size: 0.035,
  },
  lavaFlowTickRate: 10,
} as const;

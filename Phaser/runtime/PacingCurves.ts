/**
 * Tension curves, shared by the compiler (which names one) and the runtime
 * (which samples it). Pure functions of elapsed seconds -> tension in 0..1.
 *
 * They live in the runtime rather than in an adapter because sampling is a
 * decision about pacing, and the adapter is not allowed to make those: it
 * receives a scalar and applies it.
 */
export type TensionCurve = (elapsedSeconds: number) => number;

export const PACING_CURVES: Record<string, TensionCurve> = {
  steady: () => 0.5,
  escalating: t => Math.min(1, t / 300), // ramps over 5 minutes
  pulse: t => 0.5 + 0.4 * Math.sin(t / 20),
  release: t => Math.max(0.1, 1 - t / 180),
};

export function sampleCurve(name: string, elapsedSeconds: number): number {
  const curve = PACING_CURVES[name] ?? PACING_CURVES.steady;
  return Number(curve(elapsedSeconds).toFixed(4));
}

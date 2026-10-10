import { VERSION } from './version';

/** Recent errors (message text only, newest last), kept so Settings can include them in diagnostics. */
const recent: string[] = [];

export function recordError(message: string): void {
  recent.push(message.slice(0, 200));
  if (recent.length > 5) recent.shift();
}

export function recentErrors(): readonly string[] {
  return recent;
}

export function installErrorLog(target: Pick<Window, 'addEventListener'> = window): void {
  target.addEventListener('error', (e) => recordError(String((e as ErrorEvent).message ?? 'error')));
  target.addEventListener('unhandledrejection', (e) => {
    const r = (e as PromiseRejectionEvent).reason;
    recordError(`Unhandled: ${r instanceof Error ? r.message : String(r)}`);
  });
}

export interface DiagnosticsInput {
  language: string;
  userAgent: string;
  viewport: string;
  world: { width: number; height: number; seed: number; tick: number; creatures: number };
  saveVersion: number;
  speed: string;
  settings: Record<string, unknown>;
  errors: readonly string[];
}

/** Plain-text report for bug reports: no personal data and no save contents. */
export function buildDiagnostics(d: DiagnosticsInput): string {
  const lines = [
    `ALVOXIS: World Evolution ${VERSION}`,
    `Save format: v${d.saveVersion}`,
    `Language: ${d.language}`,
    `User agent: ${d.userAgent}`,
    `Viewport: ${d.viewport}`,
    `World: ${d.world.width}x${d.world.height}, seed ${d.world.seed}, tick ${d.world.tick}, creatures ${d.world.creatures}`,
    `Speed: ${d.speed}`,
    `Settings: ${JSON.stringify(d.settings)}`,
    `Recent errors: ${d.errors.length ? d.errors.join(' | ') : 'none'}`,
  ];
  return lines.join('\n');
}

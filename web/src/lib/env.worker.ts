/**
 * Runtime env in the preview Worker: Cloudflare bindings (secrets and vars set on the Worker, never in git).
 * Loaded lazily so the Node-side prerender of the Worker's static routes can still import this module.
 */
let bindings: Record<string, unknown> | null = null;
export async function runtimeEnv(name: string): Promise<string | undefined> {
  if (!bindings) {
    try {
      const spec = 'cloudflare:workers';
      bindings = ((await import(/* @vite-ignore */ spec)) as { env: Record<string, unknown> }).env;
    } catch {
      bindings = process.env as Record<string, unknown>;   // Node prerender at build time
    }
  }
  const v = bindings[name];
  return typeof v === 'string' ? v : undefined;
}

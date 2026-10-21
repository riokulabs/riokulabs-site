/** Runtime env for Node (static build, local tools). The preview Worker build aliases '#site-env' to env.worker.ts. */
export async function runtimeEnv(name: string): Promise<string | undefined> {
  return process.env[name];
}

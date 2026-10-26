import type { FullConfig } from '@playwright/test';
import { preview, type PreviewServer } from 'vite';

/**
 * Avvia Vite nello stesso processo del runner. Su Windows Playwright arresta i
 * `webServer.command` tramite taskkill; se taskkill non e consentito, attende
 * per sempre e lascia i listener aperti. Le API Vite espongono invece close(),
 * che chiude in modo osservabile socket, watcher e timer senza processi figli.
 */
export default async function globalSetup(_config: FullConfig): Promise<() => Promise<void>> {
  const servers: PreviewServer[] = [];
  const start = async (port: number, outDir: string, base = '/') => {
    servers.push(await preview({
      root: 'apps/web',
      base,
      build: { outDir },
      preview: { host: 'localhost', port, strictPort: true },
      logLevel: 'warn',
    }));
  };

  try {
    await start(4173, 'dist');
    await start(4174, 'dist-sb');
    await start(4175, 'dist-pages', '/dt.github.io/');
  } catch (error) {
    await Promise.allSettled(servers.map((server) => server.close()));
    throw error;
  }

  return async () => {
    const closed = await Promise.allSettled(servers.reverse().map((server) => server.close()));
    const failure = closed.find((result): result is PromiseRejectedResult => result.status === 'rejected');
    if (failure) throw failure.reason;
  };
}

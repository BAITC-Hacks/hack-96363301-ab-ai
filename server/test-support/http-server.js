import { createServer } from 'node:http';
import { randomInt } from 'node:crypto';

/**
 * OS-assigned ports can land on the Fetch forbidden-port list. Bind test HTTP
 * servers within the high dynamic range, retrying clashes and Windows-reserved
 * port ranges (EACCES, e.g. Hyper-V exclusions). Attempts remain bounded.
 * The caller remains responsible for closing the successfully started server.
 */
export async function listenTestServer(handler) {
  let lastError;
  for (let attempt = 0; attempt < 20; attempt += 1) {
    const server = createServer(handler);
    try {
      await new Promise((resolve, reject) => {
        const cleanup = () => {
          server.off('error', failed);
          server.off('listening', ready);
        };
        const failed = (error) => {
          cleanup();
          server.close(() => reject(error));
          server.closeAllConnections();
        };
        const ready = () => { cleanup(); resolve(); };
        server.once('error', failed);
        server.once('listening', ready);
        try { server.listen(randomInt(49152, 65536), '127.0.0.1'); }
        catch (error) { failed(error); }
      });
      return server;
    } catch (error) {
      if (error.code !== 'EADDRINUSE' && !(process.platform === 'win32' && error.code === 'EACCES')) throw error;
      lastError = error;
    }
  }
  throw new Error('Не удалось открыть локальный HTTP-сервер теста после 20 попыток.', { cause: lastError });
}

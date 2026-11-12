import { startServer } from './server';
import { parseOptions } from './options';

const server = await startServer(parseOptions(process.argv.slice(2)));
console.log(`BlockCraft server listening on ${server.port}`);
const shutdown = (): void => {
  void server
    .stop()
    .then(() => {
      process.exitCode = 0;
    })
    .catch((error) => {
      console.error(error);
      process.exitCode = 1;
    });
};
process.once('SIGINT', shutdown);
process.once('SIGTERM', shutdown);

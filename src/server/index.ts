import { startServer } from './server.ts';

const port = Number(process.env.PORT ?? 8080);
const host = process.env.HOST ?? '0.0.0.0';

const server = await startServer({ port, host });
console.log(`chess server listening on ws://${host}:${server.port}/ws`);

for (const signal of ['SIGINT', 'SIGTERM'] as const) {
  process.once(signal, async () => {
    await server.close();
    process.exit(0);
  });
}

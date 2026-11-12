import { spawn } from 'node:child_process';
import { mkdtemp, readFile, readdir, stat, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { setTimeout as pause } from 'node:timers/promises';
import { HeadlessClient } from '../tests/helpers/m21b-client';
import { MessageType as T, BlockActionKind as B, decodeMessage } from '../src/net/protocol';

async function diskSize(path: string): Promise<number> {
  let bytes = 0;
  for (const entry of await readdir(path, { withFileTypes: true }))
    bytes += entry.isDirectory()
      ? await diskSize(join(path, entry.name))
      : (await stat(join(path, entry.name))).size;
  return bytes;
}
async function cpu(pid: number): Promise<number> {
  const text = await readFile(`/proc/${pid}/stat`, 'utf8');
  const fields = text.slice(text.lastIndexOf(')') + 2).split(' ');
  return Number(fields[11]) + Number(fields[12]);
}
/** Run via Vite's SSR loader so the benchmark uses exactly the production protocol codec. */
export async function run(): Promise<void> {
  const world = await mkdtemp(join(tmpdir(), 'm21b-benchmark-'));
  const child = spawn(
    process.execPath,
    ['dist-server/main.js', '--world', world, '--seed', 'blockcraft-test-seed-42', '--port', '0'],
    { stdio: ['ignore', 'pipe', 'pipe'] },
  );
  child.stderr.on('data', (data) => process.stderr.write(data));
  const clients: HeadlessClient[] = [];
  const distance = [0, 0];
  let measuringMovement = false;
  let inputTimer: ReturnType<typeof setInterval> | null = null;
  try {
    const port = await new Promise<number>((resolve, reject) => {
      let log = '';
      child.stdout.on('data', (data) => {
        log += String(data);
        const match = /listening on (\d+)/.exec(log);
        if (match) resolve(Number(match[1]));
      });
      child.once('error', reject);
      child.once('exit', (code) => reject(new Error(`Server exited: ${code}`)));
    });
    const health = async (): Promise<{ rss: number; tickP95: number; tickMax: number }> =>
      (await fetch(`http://127.0.0.1:${port}/health`)).json();
    await pause(2000);
    let before = await cpu(child.pid!),
      start = performance.now();
    await pause(10000);
    const idleCpu = ((await cpu(child.pid!)) - before) / ((performance.now() - start) / 1000);
    const idle = await health();
    for (const name of ['Bench-A', 'Bench-B']) {
      const client = await new HeadlessClient(port).open();
      clients.push(client);
      const index = clients.length - 1;
      let last: readonly [number, number, number] | null = null;
      client.socket.on('message', (bytes) => {
        const result = decodeMessage(new Uint8Array(bytes as Buffer));
        if (!result.ok || result.message.type !== T.PlayerCorrection) return;
        const position = result.message.position;
        if (last && measuringMovement)
          distance[index]! += Math.hypot(position[0] - last[0], position[2] - last[2]);
        last = position;
      });
      await client.login(name);
    }
    // Both clients have the full default view before the steady movement measurement.
    await Promise.all(
      clients.map(async (client) => {
        for (let i = 0; i < 289; i++) await client.wait(T.ChunkData, () => true, 30000);
      }),
    );
    const a = clients[0]!;
    const correction = await a.wait(T.PlayerCorrection);
    a.send({ type: T.PlayerInput, sequence: 1, movement: [0, 0], look: [0, -1.56], actions: 0 });
    await pause(100);
    const target = {
      x: Math.floor(correction.position[0]),
      y: Math.floor(correction.position[1]) - 1,
      z: Math.floor(correction.position[2]),
      face: 'top' as const,
      heldSlot: 0,
    };
    a.send({ type: T.BlockAction, action: B.StartBreak, ...target, sequence: 1 });
    await pause(1200);
    a.send({ type: T.BlockAction, action: B.FinishBreak, ...target, sequence: 2 });
    let sequence = 2;
    inputTimer = setInterval(() => {
      sequence++;
      for (let i = 0; i < clients.length; i++)
        clients[i]!.send({
          type: T.PlayerInput,
          sequence,
          movement: [1, 0],
          look: [sequence / 150 + i * Math.PI, 0],
          actions: 4,
        });
    }, 50);
    measuringMovement = true;
    before = await cpu(child.pid!);
    start = performance.now();
    await pause(15000);
    measuringMovement = false;
    const movingCpu = ((await cpu(child.pid!)) - before) / ((performance.now() - start) / 1000);
    const moving = await health();
    clearInterval(inputTimer);
    inputTimer = null;
    const exited = new Promise<void>((resolve) => child.once('exit', () => resolve()));
    child.kill('SIGTERM');
    await exited;
    console.log(
      JSON.stringify(
        {
          viewDistance: 8,
          idle: {
            rssBytes: idle.rss,
            cpuPercentOfOneCore: idleCpu,
            tickP95Ms: idle.tickP95,
            tickMaxMs: idle.tickMax,
          },
          twoMovingClients: {
            rssBytes: moving.rss,
            cpuPercentOfOneCore: movingCpu,
            tickP95Ms: moving.tickP95,
            tickMaxMs: moving.tickMax,
            horizontalBlocks: distance,
          },
          saveBytes: await diskSize(world),
        },
        null,
        2,
      ),
    );
  } finally {
    if (inputTimer) clearInterval(inputTimer);
    for (const client of clients) client.close();
    if (child.exitCode === null) {
      const exit = new Promise<void>((resolve) => child.once('exit', () => resolve()));
      child.kill('SIGTERM');
      await exit;
    }
    await rm(world, { recursive: true, force: true });
  }
}

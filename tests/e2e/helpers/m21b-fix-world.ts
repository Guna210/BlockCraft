import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { createServer as createViteServer } from 'vite';

/** Prepare a normal disk-backed server world using the game's persistence serializers. */
export async function prepareContainerWorld(root: string): Promise<void> {
  const vite = await createViteServer({
    configFile: join(process.cwd(), 'vite.config.ts'),
    appType: 'custom',
    logLevel: 'error',
    server: { middlewareMode: true },
  });
  try {
    const registryModule = await vite.ssrLoadModule('/src/world/blocks/registry.ts');
    const { BlockRegistry } = registryModule as typeof import('../../../src/world/blocks/registry');
    BlockRegistry.getInstance();
    await vite.ssrLoadModule('/src/gameplay/chests.ts');
    const kilnModule = await vite.ssrLoadModule('/src/gameplay/kiln.ts');
    const { registerKilnBlockEntity } = kilnModule as typeof import('../../../src/gameplay/kiln');
    registerKilnBlockEntity();

    const [
      columnModule,
      worldModule,
      physicsModule,
      playerModule,
      serializerModule,
      storageModule,
    ] = await Promise.all([
      vite.ssrLoadModule('/src/world/column.ts'),
      vite.ssrLoadModule('/src/world/world.ts'),
      vite.ssrLoadModule('/src/entity/physics.ts'),
      vite.ssrLoadModule('/src/entity/player.ts'),
      vite.ssrLoadModule('/src/persist/serializers.ts'),
      vite.ssrLoadModule('/server/storage.ts'),
    ]);
    const { ChunkColumn } = columnModule as typeof import('../../../src/world/column');
    const { World } = worldModule as typeof import('../../../src/world/world');
    const { BlockCollision } = physicsModule as typeof import('../../../src/entity/physics');
    const { Player } = playerModule as typeof import('../../../src/entity/player');
    const { serializeBlockEntities, serializeBlockTicks, serializeInventory, serializePlayerData } =
      serializerModule as typeof import('../../../src/persist/serializers');
    const { DiskStorage } = storageModule as typeof import('../../../server/storage');

    const column = new ChunkColumn(0, 0);
    const world = new World(false);
    world.setColumn(column);
    world.fill(0, 250, 0, 10, 250, 10, 'stone');
    world.setBlock(3, 251, 0, 'chest');
    world.setBlock(0, 251, 0, 'workbench');
    world.setBlock(3, 251, 3, 'kiln');

    await mkdir(join(root, 'overworld'), { recursive: true });
    await new DiskStorage(root).saveColumns('overworld', [column]);
    await writeFile(
      join(root, 'overworld', 'c.0.0.state.bin'),
      JSON.stringify({
        blockEntities: [...serializeBlockEntities(world.blockEntities.getInColumn(0, 0))],
        ticks: [...serializeBlockTicks({ time: world.ticks.time, ticks: [] })],
        doors: [],
      }),
    );

    const collision = new BlockCollision(world);
    for (const name of ['Ada', 'Bea']) {
      const player = new Player(collision, () => true);
      player.teleport(name === 'Ada' ? 1.5 : 0.5, 251, name === 'Ada' ? 1.5 : 0.5, 0, 0);
      if (name === 'Ada') player.inventory.insert('oak_planks', 24);
      await mkdir(join(root, 'players'), { recursive: true });
      await writeFile(
        join(root, 'players', `${encodeURIComponent(name)}.bin`),
        JSON.stringify({
          player: [...serializePlayerData(player)],
          inventory: [...serializeInventory(player.inventory)],
        }),
      );
    }
  } finally {
    await vite.close();
  }
}

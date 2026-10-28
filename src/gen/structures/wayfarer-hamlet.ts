import { STRUCTURE_PLACEMENT_CONFIGS } from './placement';
import type { StructurePieceTemplate, StructureTemplateBlock } from './jigsaw';
import type { StructureRegistration } from './stage';

export class TemplateBuilder {
  private readonly palette: string[] = [];
  private readonly paletteIndexes = new Map<string, number>();
  private readonly blocks: StructureTemplateBlock[] = [];

  constructor(
    private readonly name: string,
    private readonly size: readonly [number, number, number],
  ) {}

  add(
    id: string,
    x: number,
    y: number,
    z: number,
    state?: Record<string, string | number>,
    path?: { anchor?: boolean },
  ): void {
    let paletteIndex = this.paletteIndexes.get(id);
    if (paletteIndex === undefined) {
      paletteIndex = this.palette.length;
      this.palette.push(id);
      this.paletteIndexes.set(id, paletteIndex);
    }
    this.blocks.push({
      pos: [x, y, z],
      paletteIndex,
      ...(state ? { state } : {}),
      ...(path ? { surfacePath: true, ...(path.anchor ? { surfacePathAnchor: true } : {}) } : {}),
    });
  }

  build(connectors: StructurePieceTemplate['connectors'] = []): StructurePieceTemplate {
    return {
      name: this.name,
      size: this.size,
      blocks: { palette: this.palette, blocks: this.blocks },
      connectors,
    };
  }
}

function putLine(
  builder: TemplateBuilder,
  from: readonly [number, number],
  to: readonly [number, number],
  anchorAt?: readonly [number, number],
): void {
  const [x0, z0] = from;
  const [x1, z1] = to;
  if (x0 !== x1 && z0 !== z1) throw new Error('Hamlet paths must use axis-aligned segments');
  const dx = Math.sign(x1 - x0);
  const dz = Math.sign(z1 - z0);
  const length = Math.max(Math.abs(x1 - x0), Math.abs(z1 - z0));
  for (let step = 0; step <= length; step++) {
    const x = x0 + dx * step;
    const z = z0 + dz * step;
    const material = (((x * 3 + z * 5) % 7) + 7) % 7;
    const id = material === 0 ? 'cobblestone' : material === 1 ? 'oak_planks' : 'gravel';
    builder.add(
      id,
      x,
      0,
      z,
      undefined,
      anchorAt?.[0] === x && anchorAt[1] === z ? { anchor: true } : {},
    );
  }
}

function makeHamletCenter(): StructurePieceTemplate {
  const builder = new TemplateBuilder('hamlet_center', [33, 1, 33]);
  const routes: Array<{ points: Array<[number, number]>; anchor: [number, number] }> = [
    {
      points: [
        [8, 0],
        [8, 10],
        [16, 10],
        [16, 14],
      ],
      anchor: [8, 0],
    },
    {
      points: [
        [24, 0],
        [24, 10],
        [16, 10],
        [16, 14],
      ],
      anchor: [24, 0],
    },
    {
      points: [
        [8, 32],
        [8, 22],
        [16, 22],
        [16, 18],
      ],
      anchor: [8, 32],
    },
    {
      points: [
        [24, 32],
        [24, 22],
        [16, 22],
        [16, 18],
      ],
      anchor: [24, 32],
    },
    {
      points: [
        [32, 9],
        [23, 9],
        [23, 16],
        [18, 16],
      ],
      anchor: [32, 9],
    },
    {
      points: [
        [0, 23],
        [9, 23],
        [9, 16],
        [14, 16],
      ],
      anchor: [0, 23],
    },
  ];
  for (const route of routes) {
    for (let i = 1; i < route.points.length; i++) {
      putLine(builder, route.points[i - 1]!, route.points[i]!, route.anchor);
    }
  }
  for (let x = 14; x <= 18; x++) {
    putLine(builder, [x, 14], [x, 14], [x, 14]);
    putLine(builder, [x, 18], [x, 18], [x, 18]);
  }
  for (let z = 15; z <= 17; z++) {
    putLine(builder, [14, z], [14, z], [14, z]);
    putLine(builder, [18, z], [18, z], [18, z]);
  }

  for (let z = 15; z <= 17; z++) {
    for (let x = 15; x <= 17; x++) {
      if (x === 16 && z === 16) builder.add('water', x, 0, z);
      else builder.add('cobblestone', x, 0, z);
    }
  }
  builder.add('chest', 11, 0, 16, { facing: 'east', pair: 'single' });

  const connectors: StructurePieceTemplate['connectors'] = [
    { pos: [8, 0, 0], facing: 'north', pool: 'hamlet_houses', target: 'house_door' },
    { pos: [24, 0, 0], facing: 'north', pool: 'hamlet_houses', target: 'house_door' },
    { pos: [8, 0, 32], facing: 'south', pool: 'hamlet_houses', target: 'house_door' },
    { pos: [24, 0, 32], facing: 'south', pool: 'hamlet_houses', target: 'house_door' },
    { pos: [32, 0, 9], facing: 'east', pool: 'hamlet_farm', target: 'farm_gate' },
    { pos: [0, 0, 23], facing: 'west', pool: 'hamlet_tower', target: 'tower_gate' },
  ];
  return builder.build(connectors);
}

interface HouseStyle {
  name: string;
  size: readonly [number, number, number];
  plank: string;
  log: string;
  glass: string;
  roof: string;
  stair: string;
  wallHeight: number;
}

function makeHouse(style: HouseStyle): StructurePieceTemplate {
  const [width, , depth] = style.size;
  const builder = new TemplateBuilder(style.name, style.size);
  const cx = Math.floor(width / 2);
  const doorZ = depth - 1;
  const doorState = { facing: 'south', half: 'lower', hinge: 'left', open: 'true' };

  for (let z = 0; z < depth; z++) {
    for (let x = 0; x < width; x++) {
      if (x === cx && z === doorZ) continue;
      builder.add(
        (x === 0 || x === width - 1 || z === 0 || z === depth - 1) && (x + z) % 5 === 0
          ? 'cobblestone'
          : style.plank,
        x,
        0,
        z,
      );
    }
  }
  for (let y = 1; y <= style.wallHeight; y++) {
    for (let z = 0; z < depth; z++) {
      for (let x = 0; x < width; x++) {
        const edgeX = x === 0 || x === width - 1;
        const edgeZ = z === 0 || z === depth - 1;
        if (!edgeX && !edgeZ) continue;
        if (x === cx && z === doorZ && y <= 2) {
          builder.add('oak_door', x, y - 1, z, { ...doorState, half: y === 1 ? 'lower' : 'upper' });
          continue;
        }
        const corner = edgeX && edgeZ;
        if (corner) {
          builder.add(style.log, x, y, z, { axis: 'y' });
          continue;
        }
        const windowRow = y === 2 && ((edgeX && z % 3 === 1) || (edgeZ && x % 3 === 1));
        if (windowRow && !((x + z) % 4 === 0)) {
          builder.add('glass', x, y, z);
          continue;
        }
        // A few gaps and stone repairs make the cottages feel long abandoned.
        if (y === 2 && (x * 7 + z * 3) % 19 === 0) continue;
        builder.add(y === 1 && (x + z) % 9 === 0 ? 'cobblestone' : style.plank, x, y, z);
      }
    }
  }

  // Pitched, stepped roofs vary by timber and stone, with deep eaves and a clear ridge.
  const ridgeY = style.wallHeight + 3;
  for (let x = 0; x < width; x++) {
    const rise = Math.min(x, width - 1 - x);
    const y = style.wallHeight + 1 + Math.min(2, rise);
    for (let z = -1; z <= depth; z++) {
      const roofX = Math.max(0, Math.min(width - 1, x));
      const atEave = rise === 0;
      builder.add(
        atEave ? style.stair : style.roof,
        roofX,
        y,
        Math.max(0, Math.min(depth - 1, z)),
        atEave ? { facing: x === 0 ? 'west' : 'east', half: 'bottom' } : undefined,
      );
    }
  }
  for (let z = 0; z < depth; z++) builder.add(style.roof, cx, ridgeY, z);

  const connector = {
    pos: [cx, 0, depth - 1] as const,
    facing: 'south' as const,
    pool: 'hamlet_house_returns',
    target: 'house_door',
  };
  return builder.build([connector]);
}

function makeFarm(): StructurePieceTemplate {
  const builder = new TemplateBuilder('abandoned_crop_farm', [11, 2, 11]);
  for (let z = 1; z <= 9; z++) {
    for (let x = 1; x <= 9; x++) {
      if (x === 5) {
        builder.add('water', x, 0, z);
      } else {
        builder.add('farmland', x, 0, z);
        const age = ((x * 3 + z * 5) % 8).toString();
        builder.add('wheat_crop', x, 1, z, { age });
      }
    }
  }
  for (let x = 0; x <= 10; x++) {
    builder.add('oak_planks', x, 0, 5, undefined, { anchor: x === 0 });
  }
  for (let z = 0; z <= 10; z++) {
    builder.add('oak_log', 0, 0, z, { axis: 'y' });
    builder.add('oak_log', 10, 0, z, { axis: 'y' });
  }
  return builder.build([
    { pos: [0, 0, 5], facing: 'west', pool: 'hamlet_farm_returns', target: 'farm_gate' },
  ]);
}

function makeLookout(): StructurePieceTemplate {
  const builder = new TemplateBuilder('broken_lookout', [7, 15, 7]);
  for (let z = 0; z < 7; z++) {
    for (let x = 0; x < 7; x++) {
      if (x === 6 && z === 3) {
        builder.add('gravel', x, 0, z, undefined, { anchor: true });
      } else {
        builder.add(
          x === 0 || x === 6 || z === 0 || z === 6 ? 'pine_planks' : 'oak_planks',
          x,
          0,
          z,
        );
      }
    }
  }
  for (let y = 1; y <= 13; y++) {
    for (const [x, z] of [
      [0, 0],
      [6, 0],
      [0, 6],
      [6, 6],
    ] as const) {
      builder.add('pine_log', x, y, z, { axis: 'y' });
    }
    if (y % 4 === 0) {
      for (let z = 1; z <= 5; z++) {
        for (let x = 1; x <= 5; x++) {
          if (x === 3 && z === 3) continue;
          builder.add('pine_planks', x, y, z);
        }
      }
    }
    builder.add('ladder', 1, y, 3, { facing: 'west' });
    if (y === 5 || y === 9 || y === 12) {
      builder.add('glass', 0, y, 3);
      builder.add('glass', 6, y, 3);
    }
  }
  for (let z = 0; z < 7; z++) {
    for (let x = 0; x < 7; x++) {
      if (x !== 3 || z !== 3) builder.add('cobblestone', x, 14, z);
    }
  }
  return builder.build([
    { pos: [6, 0, 3], facing: 'east', pool: 'hamlet_tower_returns', target: 'tower_gate' },
  ]);
}

const houses = [
  makeHouse({
    name: 'oak_ruined_cottage',
    size: [7, 7, 7],
    plank: 'oak_planks',
    log: 'oak_log',
    glass: 'glass',
    roof: 'cobblestone',
    stair: 'oak_stairs',
    wallHeight: 3,
  }),
  makeHouse({
    name: 'birch_wayhouse',
    size: [9, 8, 8],
    plank: 'birch_planks',
    log: 'birch_log',
    glass: 'glass',
    roof: 'birch_planks',
    stair: 'birch_stairs',
    wallHeight: 4,
  }),
  makeHouse({
    name: 'pine_hill_home',
    size: [8, 8, 9],
    plank: 'pine_planks',
    log: 'pine_log',
    glass: 'glass',
    roof: 'cobblestone',
    stair: 'pine_stairs',
    wallHeight: 4,
  }),
  makeHouse({
    name: 'stone_repaired_house',
    size: [7, 7, 8],
    plank: 'oak_planks',
    log: 'pine_log',
    glass: 'glass',
    roof: 'oak_planks',
    stair: 'oak_stairs',
    wallHeight: 3,
  }),
];

const placement = STRUCTURE_PLACEMENT_CONFIGS.find((config) => config.id === 'wayfarer_hamlet');
if (!placement) throw new Error('Missing wayfarer_hamlet placement data');

export const WAYFARER_HAMLET_REGISTRATIONS: readonly StructureRegistration[] = [
  {
    config: placement,
    startTemplate: 'hamlet_center',
    templates: [makeHamletCenter(), ...houses, makeFarm(), makeLookout()],
    pools: [
      {
        name: 'hamlet_houses',
        entries: houses.map((house) => ({ template: house.name, weight: 1 })),
      },
      { name: 'hamlet_farm', entries: [{ template: 'abandoned_crop_farm', weight: 1 }] },
      { name: 'hamlet_tower', entries: [{ template: 'broken_lookout', weight: 1 }] },
    ],
    maxDepth: 1,
    maxPieces: 7,
    foundationBlock: 'cobblestone',
    stiltsBlock: 'oak_log',
    lootTable: 'wayfarer_hamlet',
  },
];

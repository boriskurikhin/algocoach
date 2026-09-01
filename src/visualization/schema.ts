import { z } from 'zod';

const VisualStateSchema = z
  .enum(['normal', 'active', 'secondary', 'muted', 'warning'])
  .describe(
    'normal for context, active for the one primary focus, secondary for a comparison or changed value, muted for irrelevant structure, and warning for a contradiction',
  );

const VisualIndexSchema = z.number().int().nonnegative();

const ArrayRangeSchema = z.object({
  start: VisualIndexSchema.describe('Inclusive displayed index where the range starts'),
  end: VisualIndexSchema.describe('Inclusive displayed index where the range ends'),
  label: z.string().max(40).describe('Short meaning or arithmetic for this range'),
  state: VisualStateSchema,
});

const ArrayPrimitiveSchema = z
  .object({
    type: z.literal('array'),
    id: z.string().min(1).max(80),
    label: z.string().max(120).describe('Short row label; use an empty string if none'),
    indexStart: z
      .union([z.literal(0), z.literal(1)])
      .nullable()
      .default(null)
      .describe('Whether displayed indices begin at 0 or 1; null means 0'),
    values: z
      .array(z.string().max(30))
      .min(1)
      .max(30)
      .describe('Cell values in left-to-right order'),
    highlighted: z
      .array(VisualIndexSchema)
      .max(30)
      .describe('Displayed indices in the one primary focus'),
    secondaryHighlighted: z
      .array(VisualIndexSchema)
      .max(30)
      .nullable()
      .default(null)
      .describe('Displayed indices used only for a comparison or changed value'),
    ranges: z
      .array(ArrayRangeSchema)
      .max(6)
      .nullable()
      .default(null)
      .describe('Optional inclusive ranges drawn as thin labeled bars below the cells'),
    pointers: z
      .array(
        z.object({
          index: VisualIndexSchema.describe('Displayed index receiving the pointer'),
          label: z.string().max(40).describe('Short pointer label'),
        }),
      )
      .max(10),
  })
  .describe('One row of indexed cells for a tiny concrete state');

const MatrixPrimitiveSchema = z
  .object({
    type: z.literal('matrix'),
    id: z.string().min(1).max(80),
    label: z.string().max(120),
    values: z
      .array(z.array(z.string().max(20)).min(1).max(16))
      .min(1)
      .max(16),
    highlighted: z
      .array(
        z.object({
          row: z.number().int().nonnegative(),
          column: z.number().int().nonnegative(),
        }),
      )
      .max(50),
    secondaryHighlighted: z
      .array(
        z.object({
          row: VisualIndexSchema,
          column: VisualIndexSchema,
        }),
      )
      .max(50)
      .nullable()
      .default(null)
      .describe('Cells used only for a comparison or changed value'),
  })
  .describe('A small rectangular grid; keep dimensions fixed across frames');

const NetworkPrimitiveSchema = z.object({
  id: z.string().min(1).max(80),
  label: z.string().max(120),
  nodes: z
    .array(
      z.object({
        id: z.string().min(1).max(40),
        label: z.string().max(40),
        x: z.number().min(0).max(100),
        y: z.number().min(0).max(100),
        state: VisualStateSchema,
      }),
    )
    .min(1)
    .max(40),
  edges: z
    .array(
      z.object({
        from: z.string().min(1).max(40),
        to: z.string().min(1).max(40),
        label: z.string().max(40),
        directed: z.boolean(),
        state: VisualStateSchema,
      }),
    )
    .max(80),
});

const GraphPrimitiveSchema = NetworkPrimitiveSchema.extend({
  type: z.literal('graph'),
});

const TreePrimitiveSchema = NetworkPrimitiveSchema.extend({
  type: z.literal('tree'),
});

const TextPrimitiveSchema = z.object({
  type: z.literal('text'),
  id: z.string().min(1).max(80),
  text: z.string().min(1).max(300),
  state: VisualStateSchema,
});

const VisualPrimitiveSchema = z.discriminatedUnion('type', [
  ArrayPrimitiveSchema,
  MatrixPrimitiveSchema,
  GraphPrimitiveSchema,
  TreePrimitiveSchema,
  TextPrimitiveSchema,
]);

const VisualFrameSchema = z.object({
  caption: z
    .string()
    .max(300)
    .describe('One short sentence stating what is visible or what just changed'),
  durationMs: z.number().int().min(150).max(8_000),
  primitives: z
    .array(VisualPrimitiveSchema)
    .min(1)
    .max(12)
    .describe('Reuse the same primitive ids and layout in every frame'),
});

export const DrawConceptSchema = z.object({
  title: z.string().min(1).max(120).describe('Short noun phrase for the figure'),
  question: z
    .string()
    .min(1)
    .max(300)
    .describe('One focused prediction the learner can answer from the figure'),
  frames: z
    .array(VisualFrameSchema)
    .min(1)
    .max(12)
    .describe('Use one to six focused frames; fewer is better'),
});

export type DrawConcept = z.infer<typeof DrawConceptSchema>;
export type VisualPrimitive = z.infer<typeof VisualPrimitiveSchema>;

const layoutKey = (primitive: VisualPrimitive): string => {
  if (primitive.type === 'array') {
    return [
      primitive.type,
      primitive.id,
      primitive.values.length,
      primitive.indexStart ?? 0,
      primitive.ranges?.length ?? 0,
    ].join(':');
  }
  if (primitive.type === 'matrix') {
    return [
      primitive.type,
      primitive.id,
      primitive.values.map((row) => row.length).join(','),
    ].join(':');
  }
  if (primitive.type === 'graph' || primitive.type === 'tree') {
    const nodes = primitive.nodes
      .map(({ id, x, y }) => `${id}@${x},${y}`)
      .sort()
      .join('|');
    const edges = primitive.edges
      .map(({ from, to, directed }) => `${from}>${to}:${directed}`)
      .sort()
      .join('|');
    return `${primitive.type}:${primitive.id}:${nodes}:${edges}`;
  }
  return `${primitive.type}:${primitive.id}`;
};

const validArrayIndices = (
  primitive: Extract<VisualPrimitive, { type: 'array' }>,
): boolean => {
  const first = primitive.indexStart ?? 0;
  const last = first + primitive.values.length - 1;
  const inBounds = (index: number) => index >= first && index <= last;
  const secondary = primitive.secondaryHighlighted ?? [];
  const ranges = primitive.ranges ?? [];

  return (
    primitive.highlighted.every(inBounds) &&
    secondary.every(inBounds) &&
    !secondary.some((index) => primitive.highlighted.includes(index)) &&
    primitive.pointers.every(({ index }) => inBounds(index)) &&
    ranges.every(({ start, end }) => start <= end && inBounds(start) && inBounds(end))
  );
};

const validMatrixIndices = (
  primitive: Extract<VisualPrimitive, { type: 'matrix' }>,
): boolean => {
  const inBounds = ({ row, column }: { row: number; column: number }) =>
    row < primitive.values.length && column < (primitive.values[row]?.length ?? 0);
  const secondary = primitive.secondaryHighlighted ?? [];

  return (
    primitive.highlighted.every(inBounds) &&
    secondary.every(inBounds) &&
    !secondary.some((cell) =>
      primitive.highlighted.some(
        (active) => active.row === cell.row && active.column === cell.column,
      ),
    )
  );
};

const primitiveMarks = (primitive: VisualPrimitive): number => {
  if (primitive.type === 'array') return primitive.values.length;
  if (primitive.type === 'matrix') {
    return primitive.values.reduce((sum, row) => sum + row.length, 0);
  }
  if (primitive.type === 'graph' || primitive.type === 'tree') {
    return primitive.nodes.length + primitive.edges.length;
  }
  return 1;
};

const isSmallPrimitive = (primitive: VisualPrimitive): boolean => {
  if (primitive.type === 'array') {
    return primitive.values.length <= 18 && validArrayIndices(primitive);
  }
  if (primitive.type === 'matrix') {
    return primitiveMarks(primitive) <= 64 && validMatrixIndices(primitive);
  }
  if (primitive.type === 'graph' || primitive.type === 'tree') {
    const ids = new Set(primitive.nodes.map(({ id }) => id));
    return (
      ids.size === primitive.nodes.length &&
      primitive.nodes.length <= 18 &&
      primitive.edges.length <= 32 &&
      primitive.edges.every(({ from, to }) => ids.has(from) && ids.has(to))
    );
  }
  return primitive.text.length <= 140;
};

export function isFocusedVisualization(scene: DrawConcept): boolean {
  if (
    scene.frames.length > 6 ||
    !scene.question.trim() ||
    scene.frames.some(
      (frame) =>
        !frame.caption.trim() ||
        frame.primitives.length > 3 ||
        frame.primitives.reduce(
          (sum, primitive) => sum + primitiveMarks(primitive),
          0,
        ) > 48 ||
        frame.primitives.some((primitive) => !isSmallPrimitive(primitive)),
    )
  ) {
    return false;
  }

  const firstLayout = scene.frames[0]?.primitives.map(layoutKey).sort();
  return scene.frames.every((frame) => {
    const ids = frame.primitives.map(({ id }) => id);
    return (
      new Set(ids).size === ids.length &&
      JSON.stringify(frame.primitives.map(layoutKey).sort()) ===
        JSON.stringify(firstLayout)
    );
  });
}

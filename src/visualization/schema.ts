import { z } from 'zod';

const VisualStateSchema = z.enum(['normal', 'active', 'muted', 'warning']);

const ArrayPrimitiveSchema = z.object({
  type: z.literal('array'),
  id: z.string().min(1).max(80),
  label: z.string().max(120),
  values: z.array(z.string().max(30)).min(1).max(30),
  highlighted: z.array(z.number().int().nonnegative()).max(30),
  pointers: z
    .array(
      z.object({
        index: z.number().int().nonnegative(),
        label: z.string().max(40),
      }),
    )
    .max(10),
});

const MatrixPrimitiveSchema = z.object({
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
});

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
  caption: z.string().max(300),
  durationMs: z.number().int().min(150).max(8_000),
  primitives: z.array(VisualPrimitiveSchema).min(1).max(12),
});

export const DrawConceptSchema = z.object({
  title: z.string().min(1).max(120),
  question: z.string().min(1).max(300),
  frames: z.array(VisualFrameSchema).min(1).max(12),
});

export type DrawConcept = z.infer<typeof DrawConceptSchema>;
export type VisualPrimitive = z.infer<typeof VisualPrimitiveSchema>;

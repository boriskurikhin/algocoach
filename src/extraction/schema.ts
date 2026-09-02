import { z } from 'zod';

const ProblemSiteSchema = z.enum([
  'dmoj',
  'codeforces',
  'usaco',
  'advent-of-code',
  'leetcode',
  'generic',
]);

const ProblemSampleSchema = z.object({
  input: z.string().max(20_000),
  output: z.string().max(20_000),
  explanation: z.string().max(20_000).optional(),
});

const ProblemSectionSchema = z.object({
  heading: z.string().max(200),
  body: z.string().max(40_000),
});

export const CodeforcesRatingValueSchema = z.number().int().min(800).max(4_000);

const CodeforcesRatingSchema = z.object({
  value: CodeforcesRatingValueSchema,
  source: z.enum(['official', 'estimated']),
});

export const ProblemContextSchema = z.object({
  version: z.literal(1),
  source: z.object({
    url: z.string().url().max(4_000),
    host: z.string().max(255),
    site: ProblemSiteSchema,
    extractedAt: z.number().int().nonnegative(),
  }),
  title: z.string().trim().min(1).max(500),
  statement: z.string().trim().min(1).max(120_000),
  input: z.string().max(40_000).optional(),
  output: z.string().max(40_000).optional(),
  constraints: z.array(z.string().max(5_000)).max(100).default([]),
  samples: z.array(ProblemSampleSchema).max(30).default([]),
  timeLimit: z.string().max(200).optional(),
  memoryLimit: z.string().max(200).optional(),
  rating: z.string().max(100).optional(),
  codeforcesRating: CodeforcesRatingSchema.optional(),
  tags: z.array(z.string().max(100)).max(50).default([]),
  sections: z.array(ProblemSectionSchema).max(50).default([]),
  confidence: z.number().min(0).max(1),
  warnings: z.array(z.string().max(500)).max(20).default([]),
});

export type ProblemSite = z.infer<typeof ProblemSiteSchema>;
export type ProblemContext = z.infer<typeof ProblemContextSchema>;

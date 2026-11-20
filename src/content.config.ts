import { defineCollection } from 'astro:content';
import { glob } from 'astro/loaders';
import { z } from 'astro/zod';

const cheatsheets = defineCollection({
  loader: glob({ pattern: '**/*.md', base: './src/content/cheatsheets' }),
  schema: z.object({
    title: z.string(),
    description: z.string(),
    tags: z.array(z.string()).default([]),
    updated: z.string().optional(),
  }),
});

const prompts = defineCollection({
  loader: glob({ pattern: '**/*.md', base: './src/content/prompts' }),
  schema: z.object({
    title: z.string(),
    description: z.string(),
    category: z.string(),
    tags: z.array(z.string()).default([]),
    relatedTools: z.array(z.string()).default([]),
    whenToUse: z.string().optional(),
    tips: z.array(z.string()).default([]),
    variables: z
      .array(
        z.object({
          name: z.string(),
          label: z.string(),
          placeholder: z.string().default(''),
          multiline: z.boolean().default(false),
          optional: z.boolean().default(false),
        }),
      )
      .default([]),
  }),
});

const guides = defineCollection({
  loader: glob({ pattern: '**/*.md', base: './src/content/guides' }),
  schema: z.object({
    title: z.string(),
    description: z.string(),
    category: z.string(),
    tags: z.array(z.string()).default([]),
    published: z.string(),
    updated: z.string().optional(),
    readingTime: z.string().default('8 min read'),
    relatedTools: z.array(z.string()).default([]),
  }),
});

export const collections = { cheatsheets, prompts, guides };

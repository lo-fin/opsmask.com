import { getCollection } from 'astro:content';
import { TOOLS } from '../data/tools';

export async function GET() {
  const cheatsheets = await getCollection('cheatsheets');
  const prompts = await getCollection('prompts');
  const items = [
    ...TOOLS.map((t) => ({ type: 'Tool', title: t.title, description: t.description, url: `/tools/${t.slug}/`, keywords: [t.group, ...t.keywords].join(' ') })),
    ...cheatsheets.map((c) => ({ type: 'Cheatsheet', title: c.data.title, description: c.data.description, url: `/cheatsheets/${c.id}/`, keywords: c.data.tags.join(' ') })),
    ...prompts.map((p) => ({ type: 'Prompt', title: p.data.title, description: p.data.description, url: `/prompts/${p.id}/`, keywords: [p.data.category, ...p.data.tags].join(' ') })),
  ];
  return new Response(JSON.stringify(items), { headers: { 'Content-Type': 'application/json' } });
}

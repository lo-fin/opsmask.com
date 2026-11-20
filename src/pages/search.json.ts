import { getCollection } from 'astro:content';
import { TOOLS } from '../data/tools';

export async function GET() {
  const cheatsheets = await getCollection('cheatsheets');
  const prompts = await getCollection('prompts');
  const guides = await getCollection('guides');
  const items = [
    ...TOOLS.map((t) => ({ type: 'Tool', title: t.title, description: t.description, url: `/tools/${t.slug}/`, keywords: [t.group, ...t.keywords].join(' ') })),
    ...guides.map((g) => ({ type: 'Guide', title: g.data.title, description: g.data.description, url: `/guides/${g.id}/`, keywords: [g.data.category, ...g.data.tags].join(' ') })),
    ...cheatsheets.map((c) => ({ type: 'Cheatsheet', title: c.data.title, description: c.data.description, url: `/cheatsheets/${c.id}/`, keywords: c.data.tags.join(' ') })),
    ...prompts.map((p) => ({ type: 'Prompt', title: p.data.title, description: p.data.description, url: `/prompts/${p.id}/`, keywords: [p.data.category, ...p.data.tags].join(' ') })),
  ];
  return new Response(JSON.stringify(items), { headers: { 'Content-Type': 'application/json' } });
}

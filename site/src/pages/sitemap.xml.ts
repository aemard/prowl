import type { APIRoute } from 'astro';

const pages = ['', 'install/', 'auth/', 'privacy/', 'contributing/', 'changelog/'];

export const GET: APIRoute = ({ site }) => {
  const urls = pages.map((path) => new URL(`${import.meta.env.BASE_URL}${path}`, site).href);
  return new Response(
    `<?xml version="1.0" encoding="UTF-8"?><urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">${urls.map((url) => `<url><loc>${url}</loc></url>`).join('')}</urlset>`,
    { headers: { 'Content-Type': 'application/xml; charset=utf-8' } },
  );
};

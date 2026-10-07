import type { APIRoute } from "astro";

/** One page worth indexing: the home page. The 404 and the share card are not. */
export const GET: APIRoute = ({ site }) => {
  const home = new URL(import.meta.env.BASE_URL.replace(/\/?$/, "/"), site).href;
  const xml = `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
  <url><loc>${home}</loc><changefreq>weekly</changefreq></url>
</urlset>
`;
  return new Response(xml, { headers: { "Content-Type": "application/xml" } });
};

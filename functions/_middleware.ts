// Cloudflare Pages middleware — runs at the edge for every request.
//
// Goal: 301-redirect any visitor hitting *.pages.dev to the canonical
// custom domain (flowtongshu.com). This makes the pages.dev hostnames
// (both the project's main flowtongshu-landing.pages.dev and per-deploy
// preview hashes like 5ca6f935.flowtongshu-landing.pages.dev) inaccessible
// to humans — they're bounced to the production custom domain.

const CANONICAL_HOSTNAME = 'flowtongshu.com';

export const onRequest = async (context: { request: Request; next: () => Promise<Response> }) => {
  const url = new URL(context.request.url);

  if (url.hostname.endsWith('.pages.dev')) {
    const target = `https://${CANONICAL_HOSTNAME}${url.pathname}${url.search}`;
    return Response.redirect(target, 301);
  }

  // The /tracking dashboard was removed. Permanently redirect any lingering
  // requests (search engines, bookmarks, cached references) to the homepage
  // so users don't see a stale cached copy of the old dashboard.
  if (url.pathname === '/tracking' || url.pathname === '/tracking.html' || url.pathname === '/tracking/') {
    return Response.redirect(`https://${CANONICAL_HOSTNAME}/`, 301);
  }

  return context.next();
};

// Cloudflare Pages Function — returns PUBLIC tracking IDs to the browser.
//
// The CF dashboard's "Environment Variables" page is our single admin UI:
// edit a value there, save, and the next page load picks it up. No
// redeploy needed.
//
// Only public IDs are returned — secret tokens (META_CAPI_TOKEN,
// TIKTOK_ACCESS_TOKEN) stay server-only and are used by /api/track.

interface Env {
  META_PIXEL_ID?: string;
  META_TEST_EVENT_CODE?: string;
  GOOGLE_ADS_ID?: string;
  GOOGLE_ADS_LABEL?: string;
  TIKTOK_PIXEL_CODE?: string;
  APP_DOMAIN?: string;
}

interface Ctx { env: Env }

export const onRequestGet = (ctx: Ctx): Response => {
  const body = {
    meta: {
      pixelId: ctx.env.META_PIXEL_ID || '',
      testEventCode: ctx.env.META_TEST_EVENT_CODE || '',
    },
    google: {
      adsId: ctx.env.GOOGLE_ADS_ID || '',
      conversionLabel: ctx.env.GOOGLE_ADS_LABEL || '',
    },
    tiktok: {
      pixelCode: ctx.env.TIKTOK_PIXEL_CODE || '',
    },
    appDomain: ctx.env.APP_DOMAIN || 'app.flowtongshu.com',
    requireConsent: false,
  };
  return new Response(JSON.stringify(body), {
    headers: {
      'Content-Type': 'application/json',
      // Cache 60s at the edge — IDs change rarely, this keeps page loads fast.
      'Cache-Control': 'public, max-age=60, s-maxage=60',
      // Allow the app subdomain to read this too (so we can centralize later)
      'Access-Control-Allow-Origin': '*',
    },
  });
};

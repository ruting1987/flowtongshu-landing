// Returns PUBLIC tracking IDs (no secrets) to the browser.
// IDs are managed via the admin Tracking page in the app
// (app.flowtongshu.com → Settings → Admin → Tracking). Changes propagate
// within ~60s (worker-isolate cache TTL).

import { loadTrackingConfig } from '../_tracking-config';

interface Env {
  SUPABASE_URL?: string;
  SUPABASE_SERVICE_ROLE_KEY?: string;
  APP_DOMAIN?: string;
}

interface Ctx { env: Env }

export const onRequestGet = async (ctx: Ctx): Promise<Response> => {
  const cfg = await loadTrackingConfig(ctx.env);
  const body = {
    meta: {
      pixelId: cfg.meta_pixel_id || '',
      testEventCode: cfg.meta_test_event_code || '',
    },
    google: {
      adsId: cfg.google_ads_id || '',
      conversionLabel: cfg.google_ads_label || '',
    },
    tiktok: {
      pixelCode: cfg.tiktok_pixel_code || '',
    },
    appDomain: ctx.env.APP_DOMAIN || 'app.flowtongshu.com',
    requireConsent: false,
  };
  return new Response(JSON.stringify(body), {
    headers: {
      'Content-Type': 'application/json',
      'Cache-Control': 'public, max-age=60, s-maxage=60',
      'Access-Control-Allow-Origin': '*',
    },
  });
};

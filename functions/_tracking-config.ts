// Shared loader for tracking_config from Supabase.
//
// Both /api/config (returns public IDs to the browser) and /api/track
// (uses CAPI tokens server-side) call loadTrackingConfig() to get the
// current values managed via the admin Tracking page in the app.
//
// 60-second in-memory cache per worker isolate keeps response times low —
// CF Pages Functions run on a fresh isolate on each cold start but warm
// isolates serve many requests, so 60s of cache hits matters.
//
// Required CF Pages env vars (LANDING project):
//   SUPABASE_URL                — your project URL
//   SUPABASE_SERVICE_ROLE_KEY   — encrypted secret, bypasses RLS

export interface TrackingConfig {
  meta_pixel_id: string | null;
  meta_capi_token: string | null;
  meta_test_event_code: string | null;
  google_ads_id: string | null;
  google_ads_label: string | null;
  tiktok_pixel_code: string | null;
  tiktok_access_token: string | null;
}

interface Env {
  SUPABASE_URL?: string;
  SUPABASE_SERVICE_ROLE_KEY?: string;
}

let cache: { value: TrackingConfig; expiresAt: number } | null = null;
const TTL_MS = 60_000;

export async function loadTrackingConfig(env: Env): Promise<TrackingConfig> {
  if (cache && cache.expiresAt > Date.now()) return cache.value;

  const empty: TrackingConfig = {
    meta_pixel_id: null,
    meta_capi_token: null,
    meta_test_event_code: null,
    google_ads_id: null,
    google_ads_label: null,
    tiktok_pixel_code: null,
    tiktok_access_token: null,
  };

  if (!env.SUPABASE_URL || !env.SUPABASE_SERVICE_ROLE_KEY) {
    // Caller will silently skip (CAPI helpers return 'unconfigured')
    return empty;
  }

  try {
    const res = await fetch(
      `${env.SUPABASE_URL}/rest/v1/tracking_config?id=eq.1&select=meta_pixel_id,meta_capi_token,meta_test_event_code,google_ads_id,google_ads_label,tiktok_pixel_code,tiktok_access_token`,
      {
        headers: {
          apikey: env.SUPABASE_SERVICE_ROLE_KEY,
          Authorization: `Bearer ${env.SUPABASE_SERVICE_ROLE_KEY}`,
        },
      }
    );
    if (!res.ok) return empty;
    const rows = (await res.json()) as TrackingConfig[];
    const value = rows[0] ?? empty;
    cache = { value, expiresAt: Date.now() + TTL_MS };
    return value;
  } catch {
    return empty;
  }
}

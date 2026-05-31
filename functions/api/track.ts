// Cloudflare Pages Function — server-side tracking fan-out
//
// Receives { event_name, event_id, event_time, url, user, params, click_ids,
//   fbc, fbp, ttp } from assets/tracking.js and forwards to Meta CAPI,
// TikTok Events API (Google Enhanced Conversions deferred — needs OAuth).
//
// Credentials are loaded from Supabase tracking_config table (managed via
// the admin Tracking page in the app). Required CF Pages env vars on the
// LANDING project — just two:
//   SUPABASE_URL                — your project URL
//   SUPABASE_SERVICE_ROLE_KEY   — encrypted secret
//
// Browser pixel + server CAPI share the same event_id → platforms dedupe.

import { loadTrackingConfig, type TrackingConfig } from '../_tracking-config';

interface Env {
  SUPABASE_URL?: string;
  SUPABASE_SERVICE_ROLE_KEY?: string;
}

interface Ctx {
  request: Request;
  env: Env;
  waitUntil: (p: Promise<unknown>) => void;
}

interface TrackPayload {
  event_name: string;
  event_id: string;
  event_time?: number;
  url?: string;
  referrer?: string;
  params?: Record<string, unknown>;
  user?: {
    email?: string;
    phone?: string;
    first_name?: string;
    last_name?: string;
    external_id?: string;
    dob?: string;
    gender?: string;
  };
  click_ids?: { fbclid?: string; gclid?: string; ttclid?: string };
  fbc?: string;
  fbp?: string;
  ttp?: string;
  value?: number;
  currency?: string;
}

async function sha256(input: string): Promise<string> {
  const data = new TextEncoder().encode(input.trim().toLowerCase());
  const hash = await crypto.subtle.digest('SHA-256', data);
  return Array.from(new Uint8Array(hash)).map((b) => b.toString(16).padStart(2, '0')).join('');
}

async function sendMeta(p: TrackPayload, ip: string, ua: string, cfg: TrackingConfig) {
  if (!cfg.meta_pixel_id || !cfg.meta_capi_token) return { skipped: 'meta_unconfigured' };
  const user_data: Record<string, unknown> = {
    client_ip_address: ip,
    client_user_agent: ua,
  };
  if (p.user?.email) user_data.em = [await sha256(p.user.email)];
  if (p.user?.phone) user_data.ph = [await sha256(p.user.phone.replace(/[^0-9]/g, ''))];
  if (p.user?.first_name) user_data.fn = [await sha256(p.user.first_name)];
  if (p.user?.last_name) user_data.ln = [await sha256(p.user.last_name)];
  if (p.user?.external_id) user_data.external_id = [await sha256(p.user.external_id)];
  if (p.user?.dob) {
    const dobDigits = p.user.dob.replace(/[^0-9]/g, '');
    if (dobDigits.length === 8) user_data.db = [await sha256(dobDigits)];
  }
  if (p.user?.gender) {
    const g = p.user.gender.toLowerCase();
    if (g === 'male' || g === 'm') user_data.ge = [await sha256('m')];
    else if (g === 'female' || g === 'f') user_data.ge = [await sha256('f')];
  }
  if (p.fbc) user_data.fbc = p.fbc;
  if (p.fbp) user_data.fbp = p.fbp;

  const custom_data: Record<string, unknown> = { ...(p.params || {}) };
  if (typeof p.value === 'number') custom_data.value = p.value;
  if (p.currency) custom_data.currency = p.currency;

  const body = {
    data: [
      {
        event_name: p.event_name,
        event_time: p.event_time || Math.floor(Date.now() / 1000),
        event_id: p.event_id,
        action_source: 'website',
        event_source_url: p.url,
        user_data,
        custom_data,
      },
    ],
    ...(cfg.meta_test_event_code ? { test_event_code: cfg.meta_test_event_code } : {}),
  };

  const res = await fetch(
    `https://graph.facebook.com/v21.0/${cfg.meta_pixel_id}/events?access_token=${encodeURIComponent(cfg.meta_capi_token)}`,
    { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) }
  );
  return { status: res.status };
}

async function sendTikTok(p: TrackPayload, ip: string, ua: string, cfg: TrackingConfig) {
  if (!cfg.tiktok_pixel_code || !cfg.tiktok_access_token) return { skipped: 'tiktok_unconfigured' };

  const ttMap: Record<string, string> = {
    Lead: 'SubmitForm', CompleteRegistration: 'CompleteRegistration', InitiateCheckout: 'InitiateCheckout',
    Purchase: 'CompletePayment', ViewContent: 'ViewContent', PageView: 'Pageview',
  };
  const tt_event = ttMap[p.event_name] || p.event_name;

  const user: Record<string, unknown> = { ip, user_agent: ua };
  if (p.user?.email) user.email = await sha256(p.user.email);
  if (p.user?.phone) user.phone = await sha256(p.user.phone);
  if (p.user?.external_id) user.external_id = await sha256(p.user.external_id);
  if (p.click_ids?.ttclid) user.ttclid = p.click_ids.ttclid;
  if (p.ttp) user.ttp = p.ttp;

  const properties: Record<string, unknown> = { ...(p.params || {}) };
  if (typeof p.value === 'number') properties.value = p.value;
  if (p.currency) properties.currency = p.currency;

  const body = {
    event_source: 'web',
    event_source_id: cfg.tiktok_pixel_code,
    data: [
      {
        event: tt_event,
        event_time: p.event_time || Math.floor(Date.now() / 1000),
        event_id: p.event_id,
        user,
        properties,
        page: { url: p.url, referrer: p.referrer },
      },
    ],
  };

  const res = await fetch('https://business-api.tiktok.com/open_api/v1.3/event/track/', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'Access-Token': cfg.tiktok_access_token },
    body: JSON.stringify(body),
  });
  return { status: res.status };
}

export const onRequestPost = async (ctx: Ctx): Promise<Response> => {
  let payload: TrackPayload;
  try {
    payload = (await ctx.request.json()) as TrackPayload;
  } catch {
    return new Response(JSON.stringify({ ok: false, error: 'invalid_json' }), {
      status: 400, headers: { 'Content-Type': 'application/json' },
    });
  }
  if (!payload?.event_name || !payload?.event_id) {
    return new Response(JSON.stringify({ ok: false, error: 'missing_fields' }), {
      status: 400, headers: { 'Content-Type': 'application/json' },
    });
  }

  const ip = ctx.request.headers.get('CF-Connecting-IP') || '';
  const ua = ctx.request.headers.get('User-Agent') || '';

  // Load credentials from tracking_config (60s cache)
  const cfg = await loadTrackingConfig(ctx.env);

  ctx.waitUntil(Promise.allSettled([
    sendMeta(payload, ip, ua, cfg),
    sendTikTok(payload, ip, ua, cfg),
  ]));

  return new Response(JSON.stringify({ ok: true, event_id: payload.event_id }), {
    status: 202, headers: { 'Content-Type': 'application/json' },
  });
};

export const onRequestGet = (): Response =>
  new Response(JSON.stringify({ ok: true, message: 'POST /api/track with { event_name, event_id, ... }' }), {
    headers: { 'Content-Type': 'application/json' },
  });

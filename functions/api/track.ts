// Cloudflare Pages Function — server-side tracking fan-out
//
// Receives { event_name, event_id, event_time, url, user, params, click_ids,
//   fbc, fbp, ttp } from assets/tracking.js and forwards to Meta CAPI,
// Google Ads Enhanced Conversions, and TikTok Events API in parallel.
//
// Same event_id used by the browser pixel ensures the platforms dedupe.
//
// Required encrypted env vars (CF Pages → Settings → Environment Variables):
//   META_PIXEL_ID            (public — also fine on client)
//   META_CAPI_TOKEN          (secret)
//   GOOGLE_ADS_CUSTOMER_ID   (e.g. '1234567890')
//   GOOGLE_ADS_CONVERSION_ID (e.g. 'AW-1234567890')
//   GOOGLE_ADS_CONVERSION_LABEL
//   GOOGLE_ADS_DEVELOPER_TOKEN (for Google Ads API uploads — optional MVP)
//   TIKTOK_PIXEL_CODE        (public)
//   TIKTOK_ACCESS_TOKEN      (secret)

interface Env {
  META_PIXEL_ID?: string;
  META_CAPI_TOKEN?: string;
  GOOGLE_ADS_CONVERSION_ID?: string;
  GOOGLE_ADS_CONVERSION_LABEL?: string;
  TIKTOK_PIXEL_CODE?: string;
  TIKTOK_ACCESS_TOKEN?: string;
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
  user?: { email?: string; phone?: string; first_name?: string; last_name?: string };
  click_ids?: { fbclid?: string; gclid?: string; ttclid?: string };
  fbc?: string;
  fbp?: string;
  ttp?: string;
}

// SHA-256 hex (required by all three platforms for PII)
async function sha256(input: string): Promise<string> {
  const data = new TextEncoder().encode(input.trim().toLowerCase());
  const hash = await crypto.subtle.digest('SHA-256', data);
  return Array.from(new Uint8Array(hash))
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');
}

async function maybeHash(value?: string): Promise<string | undefined> {
  if (!value) return undefined;
  // Already a 64-char hex string — pass through
  if (/^[a-f0-9]{64}$/i.test(value)) return value.toLowerCase();
  return sha256(value);
}

// ── Meta CAPI ────────────────────────────────────────────────────────────
async function sendMeta(p: TrackPayload, ip: string, ua: string, env: Env) {
  if (!env.META_PIXEL_ID || !env.META_CAPI_TOKEN) return { skipped: 'meta_unconfigured' };
  const user_data: Record<string, unknown> = {
    client_ip_address: ip,
    client_user_agent: ua,
  };
  if (p.user?.email) user_data.em = [await sha256(p.user.email)];
  if (p.user?.phone) user_data.ph = [await sha256(p.user.phone)];
  if (p.user?.first_name) user_data.fn = [await sha256(p.user.first_name)];
  if (p.user?.last_name) user_data.ln = [await sha256(p.user.last_name)];
  if (p.fbc) user_data.fbc = p.fbc;
  if (p.fbp) user_data.fbp = p.fbp;

  const body = {
    data: [
      {
        event_name: p.event_name,
        event_time: p.event_time || Math.floor(Date.now() / 1000),
        event_id: p.event_id,
        action_source: 'website',
        event_source_url: p.url,
        user_data,
        custom_data: p.params || {},
      },
    ],
  };

  const res = await fetch(
    `https://graph.facebook.com/v21.0/${env.META_PIXEL_ID}/events?access_token=${encodeURIComponent(env.META_CAPI_TOKEN)}`,
    { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) }
  );
  const json = await res.json().catch(() => ({}));
  return { status: res.status, body: json };
}

// ── Google Ads Enhanced Conversions ──────────────────────────────────────
// Note: Full server-side uploads require Google Ads API + OAuth refresh
// flow. For MVP we just log the payload; the gtag.js side already sends
// user_data via Enhanced Conversions if `gtag('set','user_data',...)` is
// called before the conversion event. Extend this once you set up OAuth.
async function sendGoogle(p: TrackPayload, env: Env) {
  if (!env.GOOGLE_ADS_CONVERSION_ID || !env.GOOGLE_ADS_CONVERSION_LABEL) {
    return { skipped: 'google_unconfigured' };
  }
  // Placeholder — real implementation: customers/{id}:uploadClickConversions
  // with gclid + transaction_id (= event_id) and hashed user identifiers.
  return { skipped: 'google_uploads_not_implemented' };
}

// ── TikTok Events API v1.3 ───────────────────────────────────────────────
async function sendTikTok(p: TrackPayload, ip: string, ua: string, env: Env) {
  if (!env.TIKTOK_PIXEL_CODE || !env.TIKTOK_ACCESS_TOKEN) return { skipped: 'tiktok_unconfigured' };

  const ttMap: Record<string, string> = {
    Lead: 'SubmitForm',
    CompleteRegistration: 'CompleteRegistration',
    InitiateCheckout: 'InitiateCheckout',
    Purchase: 'CompletePayment',
    ViewContent: 'ViewContent',
    PageView: 'Pageview',
  };
  const tt_event = ttMap[p.event_name] || p.event_name;

  const user: Record<string, unknown> = { ip, user_agent: ua };
  if (p.user?.email) user.email = await sha256(p.user.email);
  if (p.user?.phone) user.phone = await sha256(p.user.phone);
  if (p.click_ids?.ttclid) user.ttclid = p.click_ids.ttclid;
  if (p.ttp) user.ttp = p.ttp;

  const body = {
    event_source: 'web',
    event_source_id: env.TIKTOK_PIXEL_CODE,
    data: [
      {
        event: tt_event,
        event_time: p.event_time || Math.floor(Date.now() / 1000),
        event_id: p.event_id,
        user,
        properties: p.params || {},
        page: { url: p.url, referrer: p.referrer },
      },
    ],
  };

  const res = await fetch('https://business-api.tiktok.com/open_api/v1.3/event/track/', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Access-Token': env.TIKTOK_ACCESS_TOKEN,
    },
    body: JSON.stringify(body),
  });
  const json = await res.json().catch(() => ({}));
  return { status: res.status, body: json };
}

// ── Entry ────────────────────────────────────────────────────────────────
export const onRequestPost = async (ctx: Ctx): Promise<Response> => {
  let payload: TrackPayload;
  try {
    payload = (await ctx.request.json()) as TrackPayload;
  } catch {
    return new Response(JSON.stringify({ ok: false, error: 'invalid_json' }), {
      status: 400,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  if (!payload?.event_name || !payload?.event_id) {
    return new Response(JSON.stringify({ ok: false, error: 'missing_fields' }), {
      status: 400,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  const ip = ctx.request.headers.get('CF-Connecting-IP') || '';
  const ua = ctx.request.headers.get('User-Agent') || '';

  // Fan out in parallel — don't block the response on slow CAPIs
  const work = Promise.allSettled([
    sendMeta(payload, ip, ua, ctx.env),
    sendGoogle(payload, ctx.env),
    sendTikTok(payload, ip, ua, ctx.env),
  ]);
  ctx.waitUntil(work);

  return new Response(JSON.stringify({ ok: true, event_id: payload.event_id }), {
    status: 202,
    headers: { 'Content-Type': 'application/json' },
  });
};

// Allow GET for a simple "is /api/track up?" probe
export const onRequestGet = (): Response =>
  new Response(JSON.stringify({ ok: true, message: 'POST /api/track with { event_name, event_id, ... }' }), {
    headers: { 'Content-Type': 'application/json' },
  });

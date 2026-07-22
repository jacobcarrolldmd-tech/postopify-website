const HTML = `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>Postopify</title>
<style>
  body {
    margin: 0;
    font-family: -apple-system, "Inter", sans-serif;
    background: #f5f7fa;
    color: #1a1a2e;
    min-height: 100vh;
    display: flex;
    align-items: center;
    justify-content: center;
    text-align: center;
    padding: 24px;
  }
  .box { max-width: 480px; }
  h1 { color: #1B3A6B; font-size: 28px; margin-bottom: 12px; }
  p { font-size: 16px; color: #444; line-height: 1.6; }
  a { color: #1B3A6B; }
</style>
</head>
<body>
  <div class="box">
    <h1>Postopify</h1>
    <p>A post-operative medication tracking tool for oral surgery practices.</p>
    <p>If you're a patient looking for your practice's instructions, please use the link or QR code provided by your surgeon's office.</p>
  </div>
</body>
</html>`;

// The one place your actual repo content is reachable while postopify.com
// itself isn't live yet. This worker's normal behavior for every other
// hostname is unchanged - it still just returns the placeholder HTML above.
const GITHUB_PAGES_SOURCE = "https://jacobcarrolldmd-tech.github.io/postopify-website";

// ── Office Kickstart passcode gate ────────────────────────────────────────
// Valid codes are read live from the Practice Config sheet via a small
// Apps Script endpoint, cached for 5 minutes (matching the same freshness
// window used elsewhere in Postopify). Editing the kickstart_code column
// for a practice - or flipping its "active" flag - takes effect the next
// time the cache refreshes, with no Worker code changes or redeploys ever.
const KICKSTART_CODES_API =
  "https://script.google.com/macros/s/AKfycbzLacEOnp7uDMuu26PgIeTEBadfyIZjwl_XpBeitw6ZuaFzESSb6IOsb3hj1xMvXiLI/exec";

async function fetchOfficeCodes() {
  const cache = caches.default;
  const cacheKey = new Request("https://internal-cache.postopify/kickstart-codes");

  const cached = await cache.match(cacheKey);
  if (cached) {
    const data = await cached.json();
    return data.codes || [];
  }

  const resp = await fetch(KICKSTART_CODES_API);
  if (!resp.ok) throw new Error("Failed to fetch kickstart codes: " + resp.status);
  const data = await resp.json();

  // Cache-Control here controls how long Cloudflare's Cache API keeps this
  // around - 5 minutes, same as the rest of Postopify's config caching.
  const toCache = new Response(JSON.stringify(data), {
    headers: { "Cache-Control": "max-age=300", "content-type": "application/json" },
  });
  await cache.put(cacheKey, toCache);

  return data.codes || [];
}

const AUTH_COOKIE_NAME = "kickstart_auth";
// Bump this value (e.g. to "granted-v2") if you ever want to force every
// device to re-enter their code - existing cookies stop matching instantly.
const AUTH_COOKIE_VALUE = "granted-v1";
const AUTH_COOKIE_MAX_AGE = 60 * 60 * 24 * 30; // 30 days

function hasValidAuthCookie(request) {
  const cookieHeader = request.headers.get("Cookie") || "";
  return cookieHeader
    .split(";")
    .some((c) => c.trim() === `${AUTH_COOKIE_NAME}=${AUTH_COOKIE_VALUE}`);
}

function buildAuthCookieHeader() {
  return `${AUTH_COOKIE_NAME}=${AUTH_COOKIE_VALUE}; Max-Age=${AUTH_COOKIE_MAX_AGE}; Path=/; Secure; HttpOnly; SameSite=Lax`;
}

function codeFormHtml(errorMsg) {
  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>Office Kickstart — Sign In</title>
<style>
  body{margin:0;min-height:100vh;display:flex;align-items:center;justify-content:center;background:#f6f8f9;font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,sans-serif;padding:24px;}
  .box{max-width:360px;width:100%;background:#fff;border:1px solid #d7dee2;border-radius:16px;padding:28px;}
  h1{font-size:18px;color:#0f2a3f;margin:0 0 6px;}
  p{font-size:13px;color:#5b6b74;margin:0 0 18px;line-height:1.5;}
  input{width:100%;padding:12px;border:1.5px solid #d7dee2;border-radius:10px;font-size:16px;font-family:inherit;margin-bottom:12px;box-sizing:border-box;letter-spacing:2px;text-align:center;}
  button{width:100%;padding:13px;border:none;border-radius:10px;background:#0f2a3f;color:#fff;font-size:15px;font-weight:700;font-family:inherit;cursor:pointer;}
  .error{color:#8a3b12;font-size:13px;margin:-6px 0 12px;}
</style>
</head>
<body>
  <div class="box">
    <h1>Office Kickstart</h1>
    <p>Enter your office's access code to continue.</p>
    ${errorMsg ? `<div class="error">${errorMsg}</div>` : ""}
    <form method="POST">
      <input type="text" name="code" autocomplete="off" placeholder="Office code" autofocus>
      <button type="submit">Continue</button>
    </form>
  </div>
</body>
</html>`;
}

// Returns a Response if the visitor is NOT yet authorized (either the code
// entry form, or a redirect after a correct submission) - or null if they
// already have a valid cookie and should just be shown the real page.
async function handleKickstartAuth(request) {
  if (hasValidAuthCookie(request)) {
    return null;
  }

  if (request.method === "POST") {
    const formData = await request.formData();
    const submitted = (formData.get("code") || "").toString().trim();

    let officeCodes;
    try {
      officeCodes = await fetchOfficeCodes();
    } catch (e) {
      // Google's infrastructure is very reliable, so this should be rare
      // and brief - fail closed (deny) rather than silently letting
      // everyone through if the codes can't be verified right now.
      return new Response(codeFormHtml("Couldn't check codes right now \u2014 please try again in a moment."), {
        status: 503,
        headers: { "content-type": "text/html;charset=UTF-8" },
      });
    }

    const normalizedCodes = officeCodes.map((c) => c.toLowerCase());

    if (normalizedCodes.includes(submitted.toLowerCase())) {
      return new Response(null, {
        status: 302,
        headers: {
          "Location": "/",
          "Set-Cookie": buildAuthCookieHeader(),
        },
      });
    }

    return new Response(codeFormHtml("That code wasn't recognized \u2014 please try again."), {
      status: 401,
      headers: { "content-type": "text/html;charset=UTF-8" },
    });
  }

  return new Response(codeFormHtml(null), {
    status: 401,
    headers: { "content-type": "text/html;charset=UTF-8" },
  });
}

addEventListener("fetch", (event) => {
  const url = new URL(event.request.url);

  // Front-desk staff tool: kickstart.postopify.com serves kickstart.html
  // straight from the postopify-website repo on GitHub Pages, instead of
  // the placeholder every other hostname on this worker still gets - but
  // gated behind a per-office passcode first.
  if (url.hostname === "kickstart.postopify.com") {
    event.respondWith(
      (async () => {
        const authResponse = await handleKickstartAuth(event.request);
        if (authResponse) return authResponse;
        return fetch(`${GITHUB_PAGES_SOURCE}/kickstart.html`);
      })()
    );
    return;
  }

  event.respondWith(
    new Response(HTML, {
      headers: { "content-type": "text/html;charset=UTF-8" },
    })
  );
});

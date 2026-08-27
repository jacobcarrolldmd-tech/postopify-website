// postopify-site — serves the public marketing site from ./site/
//
// SAVE THIS FILE IN THE REPO AS:  src/index.js
//
// Its only job is keeping pre-launch hostnames out of search results.
// Access control is Cloudflare Access, not this file — nothing here should
// ever be load-bearing for privacy.
//
// PRODUCTION IS THE DEFAULT. postopify.com is deliberately absent from the
// list below, so when the launch route is added there is no header to
// remember to switch off. Staging stays hidden; production never was.

const NOINDEX_HOSTS = new Set([
  "staging.postopify.com",
]);

const ROBOTS_DENY = "User-agent: *\nDisallow: /\n";

export default {
  async fetch(request, env) {
    const url = new URL(request.url);

    // *.workers.dev is included because the Worker's free preview URL is
    // publicly reachable and guessable, and would otherwise be indexable.
    const hidden =
      NOINDEX_HOSTS.has(url.hostname) || url.hostname.endsWith(".workers.dev");

    if (hidden && url.pathname === "/robots.txt") {
      return new Response(ROBOTS_DENY, {
        headers: {
          "content-type": "text/plain; charset=utf-8",
          "cache-control": "no-store",
        },
      });
    }

    const response = await env.ASSETS.fetch(request);
    if (!hidden) return response;

    // Headers on an asset response are immutable — clone before editing.
    const headers = new Headers(response.headers);
    headers.set("x-robots-tag", "noindex, nofollow, noarchive");

    return new Response(response.body, {
      status: response.status,
      statusText: response.statusText,
      headers,
    });
  },
};

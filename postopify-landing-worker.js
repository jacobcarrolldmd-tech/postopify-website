// postopify-landing worker
// Serves the marketing site at postopify.com and www.postopify.com
// by proxying to the postopify-website repo on GitHub Pages.
//
// Same pattern as postopify-proxy (which handles practice subdomains) —
// GitHub Pages only allows one custom domain per repo, so this Worker
// stands in for that mapping instead of a second Pages custom domain.

const ORIGIN = "https://jacobcarrolldmd-tech.github.io/postopify-website";

export default {
  async fetch(request) {
    const url = new URL(request.url);
    const originUrl = ORIGIN + url.pathname + url.search;

    const originRequest = new Request(originUrl, {
      method: request.method,
      headers: request.headers,
      redirect: "follow",
    });

    const response = await fetch(originRequest);

    // Return a new Response so headers (like GitHub's own caching headers)
    // don't leak anything unexpected back through your domain.
    const newResponse = new Response(response.body, response);
    newResponse.headers.set("cache-control", "public, max-age=300");
    return newResponse;
  },
};

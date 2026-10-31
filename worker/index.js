/**
 * In front of the static site: sends plain-http and www visitors to
 * https://cade.work (one canonical address, so link previews and search
 * engines see the same page), then hands everything else to the assets.
 */
export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    // Only the live site: in local dev (localhost over http) leave it alone.
    const live = url.hostname === "cade.work" || url.hostname === "www.cade.work";
    if (live && (url.protocol === "http:" || url.hostname === "www.cade.work")) {
      url.protocol = "https:";
      url.hostname = "cade.work";
      return Response.redirect(url.toString(), 301);
    }
    return env.ASSETS.fetch(request);
  },
};

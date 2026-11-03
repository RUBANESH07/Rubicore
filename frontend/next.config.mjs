const API = process.env.API_URL || "http://127.0.0.1:8000";

/** @type {import('next').NextConfig} */
export default {
  reactStrictMode: true,
  distDir: process.env.NEXT_DIST_DIR || ".next",  // lets a second dev server (e.g. a preview) run without sharing the build folder
  // The browser only talks to this origin; /api is proxied to FastAPI so the session cookie stays
  // same-site and no API credentials ever exist in frontend code.
  async rewrites() {
    return [{ source: "/api/:path*", destination: `${API}/api/:path*` }];
  },
};

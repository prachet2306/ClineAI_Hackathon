import path from "node:path";
import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  turbopack: {
    // Repo root (legal-explainer). Lets Turbopack resolve packages/shared, which sits
    // outside this app folder. npm run dev runs with cwd = apps/web. See vercel/next.js#81177.
    root: path.resolve(process.cwd(), "..", ".."),
    rules: {
      "*.css": {
        loaders: ["@tailwindcss/turbopack"],
        as: "*.css",
      },
    },
  },
};

export default nextConfig;


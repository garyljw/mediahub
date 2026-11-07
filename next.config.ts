import type { NextConfig } from "next";

const SHARP_FILES = ["**/node_modules/sharp/**/*", "**/node_modules/@img/**/*"];

const nextConfig: NextConfig = {
  /* config options here */
  output: "standalone",
  cacheComponents: true,
  partialPrefetching: true,
  // MediaHub serves every image as a plain <img>, so Next's image optimiser is off. That keeps sharp
  // (and its LGPL libvips) out of the build, see outputFileTracingExcludes below.
  images: {
    unoptimized: true,
  },
  // Stops Next's file tracing from copying sharp and @img/* (the optimiser's native binaries) into the
  // standalone output. The packaging step checks they are absent, and third-party notices omit them too.
  // "/*" covers every route's trace. Next traces its own server separately and applies only excludes whose key
  // matches "next-server" there (next/dist/build/collect-build-traces.js), so that key is needed as well.
  outputFileTracingExcludes: {
    "/*": SHARP_FILES,
    "next-server": SHARP_FILES,
  },
  turbopack: {
    rules: {
      "*.css": {
        loaders: ["@tailwindcss/turbopack"],
        as: "*.css",
      },
    },
  },
};

export default nextConfig;

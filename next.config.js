// next.config.js
<<<<<<< HEAD
import path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

/** @type {import('next').NextConfig} */
=======
const path = require("path");

>>>>>>> 42fc7bb (Remove NUL file and merge Codex fixes)
const nextConfig = {
  turbopack: {
    resolveAlias: {
      "@": path.resolve(__dirname),
    },
  },
  webpack: (config) => {
    config.resolve.alias = {
      ...(config.resolve.alias || {}),
      "@": path.resolve(__dirname),
    };
    return config;
  },
};


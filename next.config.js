const path = require("path");

const nextConfig = {
  reactStrictMode: true,
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

module.exports = nextConfig;


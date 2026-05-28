import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  experimental: {
    serverActions: { bodySizeLimit: "10mb" },
  },
  serverExternalPackages: ["@anthropic-ai/sdk", "@google/generative-ai"],
};

export default nextConfig;

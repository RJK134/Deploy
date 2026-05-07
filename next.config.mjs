/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  experimental: {
    serverComponentsExternalPackages: ["@neondatabase/serverless"],
  },
};

export default nextConfig;

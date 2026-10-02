/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  output: 'export',
  basePath: process.env.NEXT_PUBLIC_BASE_PATH ?? '',
  trailingSlash: true,
  images: { unoptimized: true },
};

module.exports = nextConfig;

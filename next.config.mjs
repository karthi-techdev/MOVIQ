/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: false,
  swcMinify: true,
  typescript: {
    ignoreBuildErrors: true
  },
  eslint: {
    ignoreDuringBuilds: true
  },
  async rewrites() {
    const backend = (process.env.NEXT_PUBLIC_SERVER_URL || process.env.NEXT_PUBLIC_API_URL || "").replace(/\/$/, "");
    if (backend) {
      return [
        {
          source: "/api/:path*",
          destination: `${backend}/api/:path*`
        }
      ];
    }
    return [];
  }
};

export default nextConfig;

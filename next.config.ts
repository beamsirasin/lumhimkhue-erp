import type { NextConfig } from "next";
import path from "path";

const nextConfig: NextConfig = {
  turbopack: {
    root: path.join(__dirname),
  },
  async redirects() {
    return [
      // (admin) route group does not add /admin/ prefix — redirect legacy URLs
      { source: '/admin/:path*', destination: '/:path*', permanent: true },
    ];
  },
};

export default nextConfig;
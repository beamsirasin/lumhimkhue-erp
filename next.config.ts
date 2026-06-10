import type { NextConfig } from "next";
import path from "path";

const nextConfig: NextConfig = {
  images: {
    remotePatterns: [
      { protocol: 'https', hostname: '*.public.blob.vercel.storage' },
    ],
  },
  turbopack: {
    root: path.join(__dirname),
  },
  experimental: {
    // Tree-shake barrel-file packages so only the imported symbols are bundled.
    // recharts (~350 KB), lucide-react (~1500 icons), date-fns (~80 KB) all export
    // large barrels that inflate the client bundle if not tree-shaken.
    optimizePackageImports: ['recharts', 'lucide-react', 'date-fns', 'date-fns-tz'],
  },
  async redirects() {
    return [
      // (admin) route group does not add /admin/ prefix — redirect legacy URLs
      { source: '/admin/:path*', destination: '/:path*', permanent: true },
    ];
  },
};

export default nextConfig;
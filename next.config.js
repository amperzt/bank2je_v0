/** @type {import('next').NextConfig} */
const nextConfig = {
  // New place for this setting (no longer under experimental)
  serverExternalPackages: ['pdfjs-dist', 'tesseract.js', 'canvas'],

  webpack: (config, { isServer }) => {
    if (isServer) {
      // Extra belt-and-suspenders to keep these libs resolved by Node at runtime
      config.externals = config.externals || [];
      for (const p of ['pdfjs-dist', 'tesseract.js', 'canvas']) {
        if (!config.externals.includes(p)) config.externals.push(p);
      }
    }
    return config;
  },
};

module.exports = nextConfig;

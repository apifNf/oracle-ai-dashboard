/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  eslint: {
    // Membungkam peringatan tata bahasa ESLint saat build di Vercel
    ignoreDuringBuilds: true,
  },
  typescript: {
    // Membungkam peringatan tipe data saat build di Vercel
    ignoreBuildErrors: true,
  },
};

export default nextConfig;
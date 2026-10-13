/** @type {import('next').NextConfig} */
// sharp (reduce las imágenes del Radar) es opcional: si el hosting no lo carga, lib/radar/medios.ts guarda las
// imágenes sin reducir y el Radar sigue andando.
const nextConfig = {
  poweredByHeader: false,
  images: { unoptimized: true },
  async headers() {
    return [{
      source: "/(.*)",
      headers: [
        { key: "Content-Security-Policy", value: "default-src 'self'; base-uri 'self'; object-src 'none'; frame-ancestors 'none'; form-action 'self'; script-src 'self' 'unsafe-inline'; style-src 'self' 'unsafe-inline' https://fonts.googleapis.com; img-src 'self' data: blob: https:; font-src 'self' data: https://fonts.gstatic.com; connect-src 'self'; media-src 'self' blob:" },
        { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
        { key: "X-Content-Type-Options", value: "nosniff" },
        { key: "X-Frame-Options", value: "DENY" },
        { key: "X-Robots-Tag", value: "noindex, nofollow, noarchive" },
      ],
    }]
  },
}

export default nextConfig

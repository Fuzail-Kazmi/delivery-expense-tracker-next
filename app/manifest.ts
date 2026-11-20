import type { MetadataRoute } from "next";
export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "WaterTracker",
    short_name: "WaterTracker",
    description: "Water delivery and payment ledger",
    start_url: "/dashboard",
    display: "standalone",
    background_color: "#f5f7fa",
    theme_color: "#10283a",
    icons: [
      { src: "/water-192.png", sizes: "192x192", type: "image/png" },
      { src: "/water-512.png", sizes: "512x512", type: "image/png" },
    ],
  };
}

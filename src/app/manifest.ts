import type { MetadataRoute } from "next";

export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "Koirakartta",
    short_name: "Koirakartta",
    description: "Koirakkohavainnot kartalla",
    start_url: "/",
    scope: "/",
    display: "standalone",
    background_color: "#dce6e1",
    theme_color: "#18392c",
    icons: [
      {
        src: "/icons/koirakartta-192.svg",
        sizes: "192x192",
        type: "image/svg+xml",
        purpose: "any",
      },
      {
        src: "/icons/koirakartta-512.svg",
        sizes: "512x512",
        type: "image/svg+xml",
        purpose: "any",
      },
    ],
  };
}
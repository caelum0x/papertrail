import type { MetadataRoute } from "next";

const BASE_URL = process.env.NEXT_PUBLIC_SITE_URL ?? "";

const STATIC_PATHS: ReadonlyArray<string> = [
  "/",
  "/about",
  "/api-docs",
  "/batch",
  "/sources",
  "/recent",
  "/dashboard",
  "/eval",
];

export default function sitemap(): MetadataRoute.Sitemap {
  return STATIC_PATHS.map((path) => ({
    url: `${BASE_URL}${path}`,
    lastModified: undefined,
  }));
}

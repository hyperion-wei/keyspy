import type { MetadataRoute } from "next";

export default function robots(): MetadataRoute.Robots {
  const baseUrl = process.env.NEXT_PUBLIC_BASE_URL || "https://keyspy.app";
  return {
    rules: [
      {
        userAgent: "*",
        allow: ["/", "/login"],
        disallow: ["/api/", "/manage/", "/hunt/", "/group/"],
      },
    ],
    sitemap: `${baseUrl}/sitemap.xml`,
  };
}

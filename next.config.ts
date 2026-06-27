import type { NextConfig } from "next";

const useStandalone = process.env.NEXT_DISABLE_STANDALONE !== "1";

const nextConfig: NextConfig = useStandalone
  ? { output: "standalone", allowedDevOrigins: ["127.0.0.1"] }
  : { allowedDevOrigins: ["127.0.0.1"] };

export default nextConfig;

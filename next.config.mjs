import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

/** @type {import('next').NextConfig} */
const nextConfig = {
  // Pin the workspace root to this project. Without it, Turbopack finds a
  // stray package-lock.json in the home folder and guesses the wrong root.
  turbopack: {
    root: __dirname,
  },
};

export default nextConfig;

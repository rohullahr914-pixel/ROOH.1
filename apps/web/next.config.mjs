import {PHASE_DEVELOPMENT_SERVER} from "next/constants.js";

/** @type {import('next').NextConfig} */
const shared={reactStrictMode:true};

export default phase=>({
  ...shared,
  // Development and production builds must never share a cache directory.
  // Running `next build` beside `next dev` otherwise replaces dev manifests
  // and causes every /_next/static CSS/JS request to return 404.
  distDir:process.env.ROOH_BUILD_DIR||(phase===PHASE_DEVELOPMENT_SERVER?".next-dev":".next-build"),
});

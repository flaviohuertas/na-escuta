import nextConfig from "eslint-config-next";

const eslintConfig = [
  ...nextConfig,
  {
    ignores: [
      "src/generated/**",
      ".next/**",
      "public/sw.js",
      "public/swe-worker*.js",
      "playwright-report/**",
      "test-results/**",
    ],
  },
];

export default eslintConfig;

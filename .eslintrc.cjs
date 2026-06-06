module.exports = {
  root: true,
  env: { browser: true, es2020: true },
  extends: [
    "eslint:recommended",
    "plugin:@typescript-eslint/recommended",
    "plugin:react-hooks/recommended",
  ],
  ignorePatterns: [
    "dist",
    ".eslintrc.cjs",
    "contracts/managed/**",
    "public/contracts/managed/**",
    "src/generated/**/*.d.ts",
    "vendor/**",
  ],
  parser: "@typescript-eslint/parser",
  plugins: ["react-hooks"],
  overrides: [
    {
      files: ["tests/**/*.ts"],
      rules: {
        "@typescript-eslint/no-explicit-any": "off",
        "@typescript-eslint/no-unused-vars": "off",
        "@typescript-eslint/prefer-as-const": "off",
      },
    },
  ],
};

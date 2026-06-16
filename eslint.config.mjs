import { defineConfig, globalIgnores } from "eslint/config";
import nextVitals from "eslint-config-next/core-web-vitals";
import nextTs from "eslint-config-next/typescript";

const eslintConfig = defineConfig([
  ...nextVitals,
  ...nextTs,
  // Override default ignores of eslint-config-next.
  globalIgnores([
    // Default ignores of eslint-config-next:
    ".next/**",
    "out/**",
    "build/**",
    "next-env.d.ts",
    // Temp/agent worktree files
    ".claude/**",
    "verify_bill_temp.mjs",
    "verify_render_temp.ts",
    "C\\357\\200\\272UsersUserAppDataLocalTempverify_tables.mjs",
  ]),
]);

export default eslintConfig;

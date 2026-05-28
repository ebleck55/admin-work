/**
 * Next.js owns ESLint for now. Override here when project rules diverge from the default.
 */
const config = [
  {
    ignores: [".next/**", "node_modules/**", "drizzle/**", "scripts/sync-agent/**"],
  },
];

export default config;

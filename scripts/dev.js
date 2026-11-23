import { main } from "../src/cli.js";

// Match the debug-proxy Compose defaults, using the host API directly.
process.env.CCGLASS_CORS_ORIGINS ??= "http://localhost:5173";

main([
  "proxy",
  "--provider", "openai",
  "--upstream", process.env.CCGLASS_UPSTREAM ?? "http://127.0.0.1:6655",
  "--proxy-port", process.env.CCGLASS_PROXY_PORT ?? "6656",
  "--port", process.env.CCGLASS_DASHBOARD_PORT ?? "6657",
  "--dir", ".ccglass",
  "--no-open",
  ...process.argv.slice(2),
]).catch((error) => {
  process.stderr.write(`ccglass: ${error.stack || error.message}\n`);
  process.exit(1);
});

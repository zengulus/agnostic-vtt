# GitHub Pages deployment and recovery

The frontend must be deployed from Vite's generated `dist` directory. Publishing
repository source with the default branch/Jekyll Pages build leaves an empty
application: source `index.html` refers to `/src/main.tsx` and `%BASE_URL%`, neither
of which is a production entrypoint.

## Operator steps

1. In this repository's **Settings → Pages → Build and deployment**, select
   **Source: GitHub Actions**. Do not publish the repository root from a branch.
   This is an account setting; a code change does not change it.
2. Review and merge the repair PR when ready. The workflow runs unit/server
   tests, builds the frontend and server, checks the standalone demo and mocked
   hosted entry flow, then runs browser regressions. Only a successful default
   branch run uploads `dist` and deploys it. Pull request runs only verify code.
3. Confirm the **Deploy frontend** job succeeded for the intended commit and
   inspect its Pages deployment URL. A successful PR build alone is not evidence
   of deployment. A failed verification job leaves the previous site deployed.
4. At the deployed URL, check that the HTML has a generated
   `/agnostic-vtt/assets/*.js` module entrypoint (or the configured base path),
   and that it loads successfully. It must not contain `%BASE_URL%` or reference
   `/src/main.tsx`. Open the standalone demo, then verify live entry if the
   service variables are configured.

The workflow defaults to `VITE_BASE_PATH=/agnostic-vtt/` for this repository.
Use `/` only for a root site or custom domain. Public service variables are
compiled at build time; changing them requires another build. See the README's
live-play setup for the separate Render and Supabase requirements.

Failed browser runs retain screenshots and Playwright traces in the
`browser-failure-evidence-*` Actions artifacts for seven days. Each browser suite
runs against a fresh backend and browser in its own CI job, so campaign data and
rate-limit buckets do not leak between suites. Traces retain DOM, action, network,
and source diagnostics without continuous video capture; failure screenshots
remain enabled. These use test
campaigns and mocked credentials. Inspect the trace before changing timeouts or
retry settings; a green result must still exercise the real behavior.

See [GitHub's custom Pages workflow documentation](https://docs.github.com/en/pages/getting-started-with-github-pages/using-custom-workflows-with-github-pages).

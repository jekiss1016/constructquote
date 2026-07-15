# Project Rules & Customizations

- **CRITICAL - Production Deployments:** You must NEVER automatically push, merge, or deploy to the `main` branch. ALL development must be committed solely to the `dev` branch. You must explicitly ask the user for permission before executing a push or merge to production (`main`). There are NO exceptions to this rule.
- **Development Workflow:** Any request for new features, bug fixes, or enhancements should be implemented, committed, and tested in the development branch (`dev`) first. Wait for user feedback on the `dev` branch before proceeding.
- **Check-In Verification:** At every check-in/push to production, you must verify and confirm:
  1. The cache-busting version query parameter (`?v=N`) is incremented across all asset references (HTML files and ESM JavaScript imports) and the global footer version text is synchronized.
  2. The user guide (`help.html`) is updated with matching anchors and explanations for any modified/added views or layout changes.
  3. The local E2E test suite (`js/tests.js`) is updated to cover any selector/layout modifications and runs successfully.


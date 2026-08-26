/**
 * Whether cookies should carry the `Secure` attribute (sent only over HTTPS).
 *
 * Deliberately keyed off APP_URL's scheme, not NODE_ENV: this app's Docker image
 * always runs with NODE_ENV=production (self-hosted or not), but a self-hosted
 * deployment is often served over plain HTTP first — a bare IP address with no
 * domain/TLS cert yet (see docs/DEPLOYMENT_AWS.md). A `Secure` cookie set under
 * those conditions is silently dropped by the browser on anything but
 * `http://localhost` (which browsers special-case as a secure context), which is
 * why this broke in production but not in local dev — both run the same
 * NODE_ENV=production image. Set APP_URL to an "https://" URL once TLS is added
 * and this flips on automatically.
 */
export const SECURE_COOKIES = process.env.APP_URL?.startsWith("https://") ?? false;

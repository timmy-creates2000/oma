import { httpRouter } from "convex/server";
import { auth } from "./auth.js";

/**
 * Convex Auth verifies incoming JWTs by fetching OIDC discovery + JWKS from the
 * deployment's site URL, and those endpoints are only served once the
 * deployment has an HTTP router. This also handles `/api/auth/signin/*` and
 * `/api/auth/callback/*` if an OAuth provider is added later.
 */
const http = httpRouter();

auth.addHttpRoutes(http);

export default http;

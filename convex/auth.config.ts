import type { AuthConfig } from "convex/server";

/**
 * Tells the Convex runtime which auth provider issued the JWTs it should
 * accept. Convex Auth signs with the deployment's own site domain and the
 * "convex" audience, so without this every authenticated call fails with
 * `NoAuthProvider` even though the client holds a perfectly valid token.
 *
 * CONVEX_SITE_URL is provided by the platform (https://<deployment>.convex.site)
 * and is exactly the issuer Convex Auth uses, so this needs no extra setup.
 */
const authConfig: AuthConfig = {
  providers: [
    {
      domain:
        process.env.CONVEX_SITE_URL ?? "https://flexible-pig-338.convex.site",
      applicationID: "convex",
    },
  ],
};

export default authConfig;

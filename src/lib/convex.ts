import { ConvexReactClient } from "convex/react";

const configured = import.meta.env.VITE_CONVEX_URL as string | undefined;

/** Falls back to the deployment this project is already connected to. */
export const CONVEX_URL =
  configured ?? "https://flexible-pig-338.convex.cloud";

export const convex = new ConvexReactClient(CONVEX_URL);

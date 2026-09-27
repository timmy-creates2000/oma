/* eslint-disable */
/**
 * Generated `api` utility.
 *
 * THIS CODE IS AUTOMATICALLY GENERATED.
 *
 * To regenerate, run `npx convex dev`.
 * @module
 */

import type * as analytics from "../analytics.js";
import type * as attendance from "../attendance.js";
import type * as audit from "../audit.js";
import type * as auth from "../auth.js";
import type * as companies from "../companies.js";
import type * as corrections from "../corrections.js";
import type * as devices from "../devices.js";
import type * as helpers from "../helpers.js";
import type * as http from "../http.js";
import type * as leave from "../leave.js";
import type * as me from "../me.js";
import type * as notifications from "../notifications.js";
import type * as org from "../org.js";

import type {
  ApiFromModules,
  FilterApi,
  FunctionReference,
} from "convex/server";

declare const fullApi: ApiFromModules<{
  analytics: typeof analytics;
  attendance: typeof attendance;
  audit: typeof audit;
  auth: typeof auth;
  companies: typeof companies;
  corrections: typeof corrections;
  devices: typeof devices;
  helpers: typeof helpers;
  http: typeof http;
  leave: typeof leave;
  me: typeof me;
  notifications: typeof notifications;
  org: typeof org;
}>;

/**
 * A utility for referencing Convex functions in your app's public API.
 *
 * Usage:
 * ```js
 * const myFunctionReference = api.myModule.myFunction;
 * ```
 */
export declare const api: FilterApi<
  typeof fullApi,
  FunctionReference<any, "public">
>;

/**
 * A utility for referencing Convex functions in your app's internal API.
 *
 * Usage:
 * ```js
 * const myFunctionReference = internal.myModule.myFunction;
 * ```
 */
export declare const internal: FilterApi<
  typeof fullApi,
  FunctionReference<any, "internal">
>;

export declare const components: {};

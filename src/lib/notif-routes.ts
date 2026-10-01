/** Where a notification should take the user when it is clicked. */
export function notifRoute(type: string, isAdmin: boolean): string {
  if (type.startsWith("leave_")) return isAdmin ? "/leave-admin" : "/me";
  if (type.startsWith("correction_") || type.startsWith("early_clockout_")) {
    return isAdmin ? "/corrections" : "/me";
  }
  if (type.startsWith("device_")) return isAdmin ? "/devices" : "/me";
  if (type === "employee_late" || type === "employee_absent" || type === "forgot_clock_out") {
    return isAdmin ? "/live" : "/me";
  }
  if (type === "security_alert") return isAdmin ? "/audit" : "/me";
  return "/notifications";
}

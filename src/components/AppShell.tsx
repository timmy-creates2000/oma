import { Button } from "@/components/ui/button";
import {
  DropdownMenu, DropdownMenuContent, DropdownMenuItem,
  DropdownMenuLabel, DropdownMenuSeparator, DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  Popover, PopoverContent, PopoverTrigger,
} from "@/components/ui/popover";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { GlassCard } from "@/components/glass";
import { useSession } from "@/hooks/use-auth";
import { useWorkspace } from "@/hooks/use-workspace";
import { supabase, type Notification } from "@/lib/sb";
import {
  LayoutDashboard, Radio, Users, Fingerprint, QrCode, CalendarDays,
  Wrench, BarChart3, FileText, Bell, ScrollText, Settings, ScanLine,
  LogOut, Building2, ClipboardCheck, Timer, CheckCheck,
} from "lucide-react";
import { useEffect, useState, type ReactNode } from "react";
import { Link, NavLink, useLocation, useNavigate } from "react-router";

// employeeOnly = show ONLY to employees; perm = show only to roles that have that perm
const NAV: Array<{
  to: string;
  label: string;
  icon: React.ComponentType<{ className?: string }>;
  perm?: string;
  employeeOnly?: boolean;
}> = [
  { to: "/dashboard",        label: "Dashboard",       icon: LayoutDashboard },
  { to: "/me",               label: "My workspace",    icon: CheckCheck, employeeOnly: true },
  { to: "/live",             label: "Live attendance", icon: Radio,         perm: "view_reports" },
  { to: "/employees",        label: "Employees",       icon: Users,         perm: "manage_employees" },
  { to: "/attendance-admin", label: "Attendance",      icon: ClipboardCheck,perm: "view_reports" },
  { to: "/leave-admin",      label: "Leave",           icon: CalendarDays,  perm: "view_reports" },
  { to: "/corrections",      label: "Corrections",     icon: Timer,         perm: "view_reports" },
  { to: "/devices",          label: "Devices",         icon: Fingerprint,   perm: "manage_devices" },
  { to: "/qr",               label: "QR displays",     icon: QrCode,        perm: "manage_qr" },
  { to: "/kiosk",            label: "Kiosk",           icon: ScanLine },
  { to: "/analytics",        label: "Analytics",       icon: BarChart3,     perm: "view_reports" },
  { to: "/reports",          label: "Reports",         icon: FileText,      perm: "view_reports" },
  { to: "/notifications",    label: "Notifications",   icon: Bell },
  { to: "/audit",            label: "Audit logs",      icon: ScrollText,    perm: "view_audit" },
  { to: "/settings",         label: "Settings",        icon: Settings,      perm: "manage_settings" },
];

/** Client-side mirror of the permission matrix enforced by Supabase functions. */
export function hasPerm(role: string | undefined, perm: string): boolean {
  const map: Record<string, string[]> = {
    company_admin: [
      "manage_company", "manage_employees", "manage_attendance", "manage_leave",
      "manage_devices", "manage_qr", "view_reports", "view_audit", "manage_settings",
      "approve_leave", "approve_corrections", "approve_devices",
    ],
    hr_admin: [
      "manage_employees", "manage_attendance", "manage_leave", "manage_devices",
      "manage_qr", "view_reports", "approve_leave", "approve_corrections", "approve_devices",
    ],
    manager: ["view_reports", "approve_leave", "approve_corrections"],
    employee: [],
  };
  return (map[role ?? "employee"] ?? []).includes(perm);
}

export function AppShell({ children, title }: { children: ReactNode; title?: string }) {
  const { user, signOut } = useSession();
  const location = useLocation();
  const { ws } = useWorkspace();
  const [notifications, setNotifications] = useState<Notification[]>([]);
  const navigate = useNavigate();
  const [open, setOpen] = useState(false);

  const role = ws?.employee.role ?? "employee";
  const isEmployee = role === "employee";
  const visibleNav = NAV.filter((item) => {
    // items with a perm are hidden from pure employees
    if (item.perm && !hasPerm(role, item.perm)) return false;
    // employeeOnly items are hidden from admins/managers
    if (item.employeeOnly && !isEmployee) return false;
    return true;
  });
  const unread = notifications.filter((n) => !n.read_at).length;

  useEffect(() => {
    if (!ws) return;
    supabase.from("notifications")
      .select("*")
      .eq("company_id", ws.employee.company_id)
      .order("created_at", { ascending: false })
      .limit(20)
      .then(({ data }) => setNotifications((data ?? []) as Notification[]));
  }, [ws]);

  const handleSignOut = async () => {
    await signOut();
    navigate("/");
  };

  return (
    <div className="relative min-h-screen">
      <div aria-hidden className="pointer-events-none fixed inset-0 overflow-hidden">
        <div className="absolute -top-40 -left-32 size-[30rem] rounded-full bg-blue-300/30 blur-3xl" />
        <div className="absolute top-1/3 -right-40 size-[32rem] rounded-full bg-violet-300/30 blur-3xl" />
        <div className="absolute bottom-0 left-1/4 size-[26rem] rounded-full bg-cyan-200/30 blur-3xl" />
      </div>

      <div className="relative z-10 mx-auto flex max-w-[1500px] gap-6 px-4 py-4 lg:px-6">
        {/* sidebar */}
        <aside className="sticky top-4 hidden h-[calc(100vh-2rem)] w-60 shrink-0 flex-col lg:flex">
          <GlassCard strong className="flex h-full flex-col p-4">
            <Link to="/dashboard" className="mb-6 flex items-center gap-2.5 px-1">
              <div className="glass-inset flex size-9 items-center justify-center rounded-xl">
                <ScanLine className="size-4.5 text-primary" />
              </div>
              <div>
                <div className="text-sm font-bold leading-tight">OfficeFlow</div>
                <div className="max-w-[9rem] truncate text-[11px] text-muted-foreground">
                  {ws?.company?.name ?? "Workspace"}
                </div>
              </div>
            </Link>
            <nav className="flex-1 space-y-0.5 overflow-y-auto pr-1">
              {visibleNav.map((item) => (
                <NavLink
                  key={item.to}
                  to={item.to}
                  className={({ isActive }) =>
                    `glass-soft flex items-center gap-2.5 rounded-xl px-3 py-2 text-sm transition-colors ${
                      isActive
                        ? "glass-strong font-semibold text-primary shadow-sm"
                        : "text-foreground/75 hover:text-foreground"
                    }`
                  }
                >
                  <item.icon className="size-4" />
                  {item.label}
                </NavLink>
              ))}
            </nav>
            <div className="glass-soft mt-4 rounded-xl p-3">
              <div className="flex items-center gap-2.5">
                <Avatar className="size-8">
                  <AvatarFallback className="bg-primary/15 text-xs font-bold text-primary">
                    {(ws?.employee.name ?? user?.email ?? "?").slice(0, 2).toUpperCase()}
                  </AvatarFallback>
                </Avatar>
                <div className="min-w-0 flex-1">
                  <p className="truncate text-xs font-semibold">{ws?.employee.name ?? user?.email}</p>
                  <p className="truncate text-[10px] capitalize text-muted-foreground">
                    {(role ?? "").replace("_", " ")}
                  </p>
                </div>
                <Button variant="ghost" size="icon" className="size-7" onClick={handleSignOut} title="Sign out">
                  <LogOut className="size-3.5" />
                </Button>
              </div>
            </div>
          </GlassCard>
        </aside>

        {/* main */}
        <div className="min-w-0 flex-1">
          {/* topbar */}
          <header className="glass sticky top-4 z-20 mb-6 flex items-center justify-between rounded-2xl px-4 py-3">
            <div className="flex items-center gap-3">
              <div className="lg:hidden">
                <DropdownMenu open={open} onOpenChange={setOpen}>
                  <DropdownMenuTrigger asChild>
                    <Button variant="ghost" size="icon" className="size-9">
                      <Wrench className="size-4.5" />
                    </Button>
                  </DropdownMenuTrigger>
                  <DropdownMenuContent align="start" className="w-56">
                    {visibleNav.map((item) => (
                      <DropdownMenuItem key={item.to} onClick={() => navigate(item.to)}>
                        <item.icon className="size-4" /> {item.label}
                      </DropdownMenuItem>
                    ))}
                  </DropdownMenuContent>
                </DropdownMenu>
              </div>
              <div>
                <p className="text-[11px] text-muted-foreground">{ws?.company?.name}</p>
                <p className="text-sm font-semibold leading-tight">
                  {title ?? visibleNav.find((n) => location.pathname.startsWith(n.to))?.label ?? "OfficeFlow"}
                </p>
              </div>
            </div>
            <div className="flex items-center gap-2">
              <Popover>
                <PopoverTrigger asChild>
                  <Button variant="ghost" size="icon" className="glass-soft relative size-9 rounded-xl">
                    <Bell className="size-4.5" />
                    {unread > 0 && (
                      <span className="absolute -right-1 -top-1 flex size-4.5 items-center justify-center rounded-full bg-primary text-[10px] font-bold text-primary-foreground">
                        {unread > 9 ? "9+" : unread}
                      </span>
                    )}
                  </Button>
                </PopoverTrigger>
                <PopoverContent align="end" className="w-80 p-0">
                  <div className="flex items-center justify-between border-b px-4 py-3">
                    <p className="text-sm font-semibold">Notifications</p>
                    <Button
                      variant="link"
                      size="sm"
                      className="h-auto p-0 text-xs"
                       onClick={async () => {
                         await supabase.rpc("mark_notifications_read", { p_all: true });
                         setNotifications((items) => items.map((n) => ({ ...n, read_at: new Date().toISOString() })));
                       }}
                    >
                      <CheckCheck className="mr-1 size-3.5" /> Mark all read
                    </Button>
                  </div>
                  <div className="max-h-80 overflow-y-auto">
                    {notifications.length === 0 && (
                      <p className="px-4 py-8 text-center text-sm text-muted-foreground">You&rsquo;re all caught up.</p>
                    )}
                    {notifications.slice(0, 8).map((n) => (
                     <div key={n.id} className={`border-b px-4 py-3 last:border-0 ${n.read_at ? "opacity-55" : ""}`}>
                        <p className="text-xs font-semibold">{n.title}</p>
                         <p className="mt-0.5 text-xs text-muted-foreground">{n.body}</p>
                      </div>
                    ))}
                  </div>
                  <div className="border-t px-4 py-2 text-center">
                    <Link to="/notifications" className="text-xs text-primary hover:underline">View all</Link>
                  </div>
                </PopoverContent>
              </Popover>
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <Button variant="ghost" className="glass-soft h-9 gap-2 rounded-xl px-2">
                    <Avatar className="size-6">
                      <AvatarFallback className="bg-primary/15 text-[10px] font-bold text-primary">
                        {(ws?.employee.name ?? user?.email ?? "?").slice(0, 2).toUpperCase()}
                      </AvatarFallback>
                    </Avatar>
                    <Building2 className="size-3.5 text-muted-foreground lg:hidden" />
                  </Button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="end" className="w-48">
                  <DropdownMenuLabel className="text-xs">{user?.email ?? "Signed in"}</DropdownMenuLabel>
                  <DropdownMenuSeparator />
                  <DropdownMenuItem onClick={() => navigate("/settings")}>
                    <Settings className="size-4" /> Settings
                  </DropdownMenuItem>
                  <DropdownMenuItem onClick={handleSignOut} className="text-destructive">
                    <LogOut className="size-4" /> Sign out
                  </DropdownMenuItem>
                </DropdownMenuContent>
              </DropdownMenu>
            </div>
          </header>

          <main className="pb-12">{children}</main>
        </div>
      </div>
    </div>
  );
}

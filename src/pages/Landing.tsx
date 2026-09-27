import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  QrCode, ShieldCheck, Clock, BarChart3, Users, CalendarDays,
  Smartphone, Fingerprint, ArrowRight, Check, ScanLine,
} from "lucide-react";
import { Link } from "react-router";
import { motion } from "framer-motion";

const features = [
  {
    icon: QrCode,
    title: "Rotating QR attendance",
    body: "Cryptographically secure codes rotate every 30–60 seconds. Expired and replayed tokens are rejected on the server.",
  },
  {
    icon: Smartphone,
    title: "Device-bound check-in",
    body: "Employees scan from a registered device. Lost device? HR revokes it instantly and approves replacements.",
  },
  {
    icon: Clock,
    title: "Automatic status math",
    body: "Late, early departure, overtime, half-day and missing clock-out — all computed from the attendance engine, not trusted clients.",
  },
  {
    icon: BarChart3,
    title: "Live analytics & reports",
    body: "Attendance rate, punctuality, trends by department and branch — exportable to CSV, Excel and PDF.",
  },
  {
    icon: CalendarDays,
    title: "Leave that understands attendance",
    body: "Balances, approval workflow and leave-aware daily attendance without manual spreadsheets.",
  },
  {
    icon: ShieldCheck,
    title: "Tenant-isolated & audited",
    body: "Company data is fully isolated; every sensitive action lands in an immutable audit trail.",
  },
];

const flow = [
  { step: "1", title: "Display the QR", body: "HR opens a kiosk screen at the office entrance. The code rotates automatically." },
  { step: "2", title: "Employee scans", body: "The registered mobile device scans the current code — expired or reused codes fail." },
  { step: "3", title: "Server validates", body: "Token, device, geofence and duplicate checks run server-side before the session is written." },
  { step: "4", title: "HR sees it live", body: "Dashboards, analytics and reports update in real time for the whole company." },
];

export default function Landing() {
  return (
    <div className="relative min-h-screen overflow-hidden">
      {/* ambient orbs */}
      <div aria-hidden className="pointer-events-none absolute inset-0 overflow-hidden">
        <div className="absolute -top-32 -left-24 size-[28rem] rounded-full bg-blue-300/40 blur-3xl" />
        <div className="absolute top-40 -right-32 size-[30rem] rounded-full bg-violet-300/40 blur-3xl" />
        <div className="absolute bottom-0 left-1/3 size-[26rem] rounded-full bg-cyan-200/40 blur-3xl" />
      </div>

      {/* nav */}
      <header className="relative z-10 mx-auto flex max-w-6xl items-center justify-between px-6 py-5">
        <div className="flex items-center gap-2.5">
          <div className="glass-strong relative flex size-10 items-center justify-center rounded-xl">
            <ScanLine className="size-5 text-primary" />
          </div>
          <span className="text-lg font-bold tracking-tight">OfficeFlow</span>
        </div>
        <nav className="flex items-center gap-2">
          <Button asChild variant="ghost" className="text-foreground/80">
            <Link to="/auth">Sign in</Link>
          </Button>
          <Button asChild className="shadow-lg shadow-primary/25">
            <Link to="/auth">
              Get started <ArrowRight className="size-4" />
            </Link>
          </Button>
        </nav>
      </header>

      {/* hero */}
      <main className="relative z-10">
        <section className="mx-auto max-w-6xl px-6 pt-14 pb-20 text-center">
          <motion.div initial={{ opacity: 0, y: 16 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.5 }}>
            <Badge variant="outline" className="glass mb-6 gap-2 rounded-full px-4 py-1.5 text-xs font-medium">
              <Fingerprint className="size-3.5 text-primary" />
              Device-bound QR attendance for modern teams
            </Badge>
            <h1 className="mx-auto max-w-3xl text-4xl font-extrabold leading-[1.08] tracking-tight sm:text-6xl">
              Clock in with a scan.
              <br />
              <span className="text-gradient">Run the office with clarity.</span>
            </h1>
            <p className="mx-auto mt-6 max-w-2xl text-base leading-7 text-muted-foreground sm:text-lg">
              OfficeFlow replaces paper sheets and buddy-punching with rotating QR codes,
              registered devices and a live HR dashboard — attendance, leave, analytics and
              audit trails in one place.
            </p>
            <div className="mt-9 flex flex-col items-center justify-center gap-3 sm:flex-row">
              <Button asChild size="lg" className="h-12 px-7 text-base shadow-xl shadow-primary/25">
                <Link to="/auth">
                  Start free <ArrowRight className="size-4" />
                </Link>
              </Button>
              <Button asChild size="lg" variant="outline" className="glass h-12 px-7 text-base">
                <Link to="/auth?demo=1">Explore the live demo</Link>
              </Button>
            </div>
          </motion.div>

          {/* hero mock */}
          <motion.div
            initial={{ opacity: 0, y: 32 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.6, delay: 0.15 }}
            className="glass-strong glass-edge relative mx-auto mt-16 max-w-4xl overflow-hidden rounded-3xl p-3"
          >
            <div className="glass-inset rounded-2xl p-6 sm:p-8">
              <div className="grid gap-4 sm:grid-cols-3">
                {[
                  { label: "Present today", value: "142", tone: "text-emerald-600" },
                  { label: "Late arrivals", value: "9", tone: "text-amber-600" },
                  { label: "On leave", value: "6", tone: "text-sky-600" },
                ].map((s) => (
                  <div key={s.label} className="glass rounded-2xl p-5 text-left">
                    <p className="text-xs font-medium text-muted-foreground">{s.label}</p>
                    <p className={`mt-1 text-3xl font-bold ${s.tone}`}>{s.value}</p>
                  </div>
                ))}
              </div>
              <div className="mt-4 grid gap-4 sm:grid-cols-[1fr_auto]">
                <div className="glass flex items-end gap-1.5 rounded-2xl p-5">
                  {[42, 65, 50, 78, 60, 84, 70, 90, 62, 76, 58, 82].map((h, i) => (
                    <div
                      key={i}
                      className="flex-1 rounded-t-md bg-gradient-to-t from-primary/70 to-primary/30"
                      style={{ height: `${h}px` }}
                    />
                  ))}
                </div>
                <div className="glass flex w-full flex-col items-center justify-center rounded-2xl p-5 sm:w-44">
                  <div className="grid grid-cols-4 gap-1.5">
                    {Array.from({ length: 16 }).map((_, i) => (
                      <div key={i} className={`size-4 rounded-[3px] ${[0,1,2,4,6,7,9,10,13,15].includes(i) ? "bg-foreground/80" : "bg-transparent"}`} />
                    ))}
                  </div>
                  <p className="mt-3 text-[10px] font-medium text-muted-foreground">rotates every 30s</p>
                </div>
              </div>
            </div>
          </motion.div>
        </section>

        {/* features */}
        <section className="mx-auto max-w-6xl px-6 pb-24">
          <div className="mb-10 text-center">
            <h2 className="text-2xl font-bold tracking-tight sm:text-3xl">Everything attendance touches</h2>
            <p className="mt-2 text-muted-foreground">One platform from scan to report.</p>
          </div>
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {features.map((f, i) => (
              <motion.div
                key={f.title}
                initial={{ opacity: 0, y: 20 }}
                whileInView={{ opacity: 1, y: 0 }}
                viewport={{ once: true, margin: "-60px" }}
                transition={{ duration: 0.45, delay: (i % 3) * 0.08 }}
                className="glass group relative overflow-hidden rounded-2xl p-6 transition-transform hover:-translate-y-1"
              >
                <div className="glass-inset mb-4 flex size-11 items-center justify-center rounded-xl">
                  <f.icon className="size-5 text-primary" />
                </div>
                <h3 className="font-semibold">{f.title}</h3>
                <p className="mt-1.5 text-sm leading-6 text-muted-foreground">{f.body}</p>
              </motion.div>
            ))}
          </div>
        </section>

        {/* flow */}
        <section className="mx-auto max-w-6xl px-6 pb-24">
          <div className="glass-strong glass-edge relative overflow-hidden rounded-3xl p-8 sm:p-12">
            <h2 className="text-center text-2xl font-bold tracking-tight sm:text-3xl">How a workday starts</h2>
            <div className="mt-10 grid gap-6 sm:grid-cols-2 lg:grid-cols-4">
              {flow.map((s) => (
                <div key={s.step} className="relative">
                  <div className="glass mb-3 flex size-9 items-center justify-center rounded-full text-sm font-bold text-primary">
                    {s.step}
                  </div>
                  <h3 className="font-semibold">{s.title}</h3>
                  <p className="mt-1 text-sm leading-6 text-muted-foreground">{s.body}</p>
                </div>
              ))}
            </div>
          </div>
        </section>

        {/* cta */}
        <section className="mx-auto max-w-3xl px-6 pb-28 text-center">
          <h2 className="text-2xl font-bold tracking-tight sm:text-3xl">Ready to see your office clearly?</h2>
          <p className="mt-3 text-muted-foreground">
            Create a company in under a minute — or load the demo workspace with a month of realistic data.
          </p>
          <div className="mt-7 flex justify-center gap-3">
            <Button asChild size="lg" className="shadow-xl shadow-primary/25">
              <Link to="/auth">Get started now</Link>
            </Button>
          </div>
          <div className="mt-10 flex flex-wrap items-center justify-center gap-x-6 gap-y-2 text-sm text-muted-foreground">
            {["No credit card", "Multi-tenant isolation", "Audit-ready by design"].map((t) => (
              <span key={t} className="inline-flex items-center gap-1.5">
                <Check className="size-4 text-emerald-600" /> {t}
              </span>
            ))}
          </div>
        </section>
      </main>

      <footer className="relative z-10 border-t border-white/40 py-8 text-center text-sm text-muted-foreground backdrop-blur-sm">
        <div className="mb-1 flex items-center justify-center gap-2 font-semibold text-foreground">
          <Users className="size-4" /> OfficeFlow
        </div>
        Workforce attendance & office management · {new Date().getFullYear()}
      </footer>
    </div>
  );
}

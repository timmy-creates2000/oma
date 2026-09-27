import { Button } from "@/components/ui/button";
import {
  Card, CardContent, CardDescription, CardFooter,
  CardHeader, CardTitle,
} from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import {
  InputOTP, InputOTPGroup, InputOTPSlot,
} from "@/components/ui/input-otp";
import { useSupabaseAuth } from "@/hooks/use-supabase-auth";
import { ArrowRight, Loader2, Mail, UserX, ScanLine, Sparkles } from "lucide-react";
import { Suspense, useEffect, useState } from "react";
import { useNavigate, useSearchParams } from "react-router";

interface AuthProps {
  redirectAfterAuth?: string;
}

function resolveRedirectAfterAuth(returnTo: string | null, fallback = "/dashboard") {
  if (returnTo?.startsWith("/") && !returnTo.startsWith("//")) {
    return returnTo;
  }
  return fallback;
}

function Auth({ redirectAfterAuth }: AuthProps = {}) {
  const { session, sendOtp, verifyOtp, signInAsGuest } = useSupabaseAuth();
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const redirect = resolveRedirectAfterAuth(
    searchParams.get("returnTo"),
    redirectAfterAuth,
  );
  const [step, setStep] = useState<"signIn" | { email: string }>("signIn");
  const [otp, setOtp] = useState("");
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (session) navigate(redirect);
  }, [session, navigate, redirect]);

  const handleEmailSubmit = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setIsLoading(true);
    setError(null);
    try {
      const email = (new FormData(event.currentTarget).get("email") as string).trim();
      await sendOtp(email);
      setStep({ email });
      setIsLoading(false);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to send code");
      setIsLoading(false);
    }
  };

  const handleOtpSubmit = async () => {
    if (step === "signIn" || otp.length !== 6) return;
    setIsLoading(true);
    setError(null);
    try {
      await verifyOtp(step.email, otp);
      navigate(redirect);
    } catch {
      setError("The verification code you entered is incorrect.");
      setIsLoading(false);
      setOtp("");
    }
  };

  const handleGuestLogin = async () => {
    setIsLoading(true);
    setError(null);
    try {
      await signInAsGuest();
      navigate(redirect);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Guest sign-in failed. It may be disabled in your Supabase project — enable Anonymous sign-ins in Auth settings, or use email sign-in.");
      setIsLoading(false);
    }
  };

  return (
    <div className="relative flex min-h-screen flex-col">
      <div aria-hidden className="pointer-events-none absolute inset-0 overflow-hidden">
        <div className="absolute -top-32 -left-24 size-[28rem] rounded-full bg-blue-300/40 blur-3xl" />
        <div className="absolute bottom-0 -right-24 size-[26rem] rounded-full bg-violet-300/40 blur-3xl" />
        <div className="absolute left-1/3 top-1/2 size-[22rem] rounded-full bg-cyan-200/40 blur-3xl" />
      </div>

      <div className="relative z-10 flex flex-1 items-center justify-center p-6">
        <Card className="glass-strong glass-edge min-w-[350px] overflow-hidden rounded-3xl border-0">
          {step === "signIn" ? (
            <>
              <CardHeader className="text-center">
                <div className="flex justify-center">
                  <div className="glass-inset mb-4 flex size-14 items-center justify-center rounded-2xl">
                    <ScanLine className="size-6 text-primary" />
                  </div>
                </div>
                <CardTitle className="text-xl">Welcome to OfficeFlow</CardTitle>
                <CardDescription>
                  Enter your email to log in or sign up
                </CardDescription>
              </CardHeader>
              <form onSubmit={handleEmailSubmit}>
                <CardContent>
                  <div className="relative flex items-center gap-2">
                    <div className="relative flex-1">
                      <Mail className="absolute left-3 top-3 h-4 w-4 text-muted-foreground" />
                      <Input
                        name="email"
                        placeholder="name@example.com"
                        type="email"
                        className="glass-soft pl-9"
                        disabled={isLoading}
                        required
                      />
                    </div>
                    <Button type="submit" variant="outline" size="icon" className="glass" disabled={isLoading}>
                      {isLoading ? <Loader2 className="h-4 w-4 animate-spin" /> : <ArrowRight className="h-4 w-4" />}
                    </Button>
                  </div>
                  {error && <p className="mt-2 text-sm text-red-500">{error}</p>}

                  <div className="mt-4">
                    <div className="relative">
                      <div className="absolute inset-0 flex items-center">
                        <span className="w-full border-t border-white/50" />
                      </div>
                      <div className="relative flex justify-center text-xs uppercase">
                        <span className="bg-transparent px-2 text-muted-foreground backdrop-blur-sm">Or</span>
                      </div>
                    </div>

                    <Button
                      type="button" variant="outline" className="glass mt-4 w-full"
                      onClick={handleGuestLogin} disabled={isLoading}
                    >
                      <UserX className="mr-2 h-4 w-4" />
                      Continue as Guest
                    </Button>
                    <p className="mt-3 flex items-center justify-center gap-1.5 text-[11px] text-muted-foreground">
                      <Sparkles className="size-3 text-primary" />
                      Guest sign-in lets you create or explore a workspace instantly
                    </p>
                  </div>
                </CardContent>
              </form>
            </>
          ) : (
            <>
              <CardHeader className="mt-4 text-center">
                <CardTitle>Check your email</CardTitle>
                <CardDescription>We've sent a 6-digit code to {step.email}</CardDescription>
              </CardHeader>
              <CardContent className="pb-4">
                <div className="flex justify-center">
                  <InputOTP value={otp} onChange={setOtp} maxLength={6} disabled={isLoading}>
                    <InputOTPGroup>
                      {Array.from({ length: 6 }).map((_, index) => (
                        <InputOTPSlot key={index} index={index} />
                      ))}
                    </InputOTPGroup>
                  </InputOTP>
                </div>
                {error && <p className="mt-2 text-center text-sm text-red-500">{error}</p>}
                <p className="mt-4 text-center text-sm text-muted-foreground">
                  Didn't receive a code?{" "}
                  <Button variant="link" className="h-auto p-0" onClick={() => setStep("signIn")}>
                    Try again
                  </Button>
                </p>
              </CardContent>
              <CardFooter className="flex-col gap-2">
                <Button className="w-full" disabled={isLoading || otp.length !== 6} onClick={handleOtpSubmit}>
                  {isLoading ? (
                    <><Loader2 className="mr-2 h-4 w-4 animate-spin" /> Verifying...</>
                  ) : (
                    <>Verify code <ArrowRight className="ml-2 h-4 w-4" /></>
                  )}
                </Button>
                <Button type="button" variant="ghost" onClick={() => setStep("signIn")} disabled={isLoading} className="w-full">
                  Use different email
                </Button>
              </CardFooter>
            </>
          )}

          <div className="rounded-b-3xl border-t border-white/50 bg-white/30 px-6 py-4 text-center text-xs text-muted-foreground backdrop-blur-sm">
            Secured by Supabase Auth
          </div>
        </Card>
      </div>
    </div>
  );
}

export default function AuthPage(props: AuthProps) {
  return (
    <Suspense>
      <Auth {...props} />
    </Suspense>
  );
}

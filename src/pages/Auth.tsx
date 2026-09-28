import { Button } from "@/components/ui/button";
import {
  Card, CardContent, CardDescription, CardFooter,
  CardHeader, CardTitle,
} from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useSession } from "@/hooks/use-auth";
import { supabase } from "@/lib/sb";
import { err } from "@/lib/sb";
import { ArrowRight, Loader2, Lock, Mail, ScanLine, UserPlus } from "lucide-react";
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
  const { isAuthenticated } = useSession();
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const redirect = resolveRedirectAfterAuth(
    searchParams.get("returnTo"),
    redirectAfterAuth,
  );

  const [mode, setMode] = useState<"signIn" | "signUp">("signIn");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (isAuthenticated) navigate(redirect, { replace: true });
  }, [isAuthenticated, navigate, redirect]);

  const handleSubmit = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setIsLoading(true);
    setError(null);
    try {
      const result = mode === "signIn"
        ? await supabase.auth.signInWithPassword({ email: email.trim(), password })
        : await supabase.auth.signUp({ email: email.trim(), password });
      if (result.error) throw result.error;
      if (mode === "signUp" && !result.data.session) {
        setError("Check your email to confirm your account, then sign in.");
        setIsLoading(false);
      } else {
        navigate(redirect, { replace: true });
      }
    } catch (e) {
      setError(err(e));
      setIsLoading(false);
    }
  };

  const switchMode = (next: "signIn" | "signUp") => {
    setMode(next);
    setError(null);
  };

  return (
    <div className="relative flex min-h-screen flex-col">
      <div aria-hidden className="pointer-events-none absolute inset-0 overflow-hidden">
        <div className="absolute -top-32 -left-24 size-[28rem] rounded-full bg-blue-300/40 blur-3xl" />
        <div className="absolute bottom-0 -right-24 size-[26rem] rounded-full bg-violet-300/40 blur-3xl" />
        <div className="absolute left-1/3 top-1/2 size-[22rem] rounded-full bg-cyan-200/40 blur-3xl" />
      </div>

      <div className="relative z-10 flex flex-1 items-center justify-center p-6">
        <Card className="glass-strong glass-edge w-full max-w-md overflow-hidden rounded-3xl border-0">
          <form onSubmit={handleSubmit}>
            <CardHeader className="text-center">
              <div className="flex justify-center">
                <div className="glass-inset mb-4 flex size-14 items-center justify-center rounded-2xl">
                  <ScanLine className="size-6 text-primary" />
                </div>
              </div>
              <CardTitle className="text-xl">
                {mode === "signIn" ? "Welcome back" : "Create your account"}
              </CardTitle>
              <CardDescription>
                {mode === "signIn"
                  ? "Sign in to your OfficeFlow workspace"
                  : "Set up an account, then create or join a company"}
              </CardDescription>
            </CardHeader>

            <CardContent className="space-y-4">
              <div className="space-y-1.5">
                <Label htmlFor="email">Work email</Label>
                <div className="relative">
                  <Mail className="absolute left-3 top-3 h-4 w-4 text-muted-foreground" />
                  <Input
                    id="email"
                    name="email"
                    type="email"
                    autoComplete="email"
                    placeholder="name@company.com"
                    className="glass-soft pl-9"
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                    disabled={isLoading}
                    required
                  />
                </div>
              </div>

              <div className="space-y-1.5">
                <Label htmlFor="password">Password</Label>
                <div className="relative">
                  <Lock className="absolute left-3 top-3 h-4 w-4 text-muted-foreground" />
                  <Input
                    id="password"
                    name="password"
                    type="password"
                    autoComplete={mode === "signIn" ? "current-password" : "new-password"}
                    placeholder="At least 8 characters"
                    className="glass-soft pl-9"
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    disabled={isLoading}
                    minLength={8}
                    required
                  />
                </div>
                {mode === "signUp" && (
                  <p className="text-[11px] text-muted-foreground">
                    Use at least 8 characters. You&rsquo;ll create a company on the next step.
                  </p>
                )}
              </div>

              {error && (
                <p className="glass-soft rounded-xl px-3 py-2 text-sm text-destructive">{error}</p>
              )}

              <Button type="submit" className="w-full" disabled={isLoading}>
                {isLoading ? (
                  <>
                    <Loader2 className="mr-2 h-4 w-4 animate-spin" /> Please wait...
                  </>
                ) : mode === "signIn" ? (
                  <>
                    Sign in <ArrowRight className="ml-2 h-4 w-4" />
                  </>
                ) : (
                  <>
                    <UserPlus className="mr-2 h-4 w-4" /> Create account
                  </>
                )}
              </Button>
            </CardContent>

            <CardFooter className="flex-col gap-2">
              <Button
                type="button"
                variant="ghost"
                className="w-full"
                disabled={isLoading}
                onClick={() => switchMode(mode === "signIn" ? "signUp" : "signIn")}
              >
                {mode === "signIn"
                  ? "New to OfficeFlow? Create an account"
                  : "Already have an account? Sign in"}
              </Button>
            </CardFooter>
          </form>

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

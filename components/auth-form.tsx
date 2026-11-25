"use client";
import { useEffect, useState } from "react";
import { Droplet, Eye, EyeOff, Waves, WalletCards } from "lucide-react";
import { Brand } from "./brand";
type Mode = "signin" | "signup" | "forgot" | "reset";
const labels = {
  signin: "Sign in",
  signup: "Create account",
  forgot: "Send reset link",
  reset: "Reset password",
};
export default function AuthForm() {
  const [mode, modeTo] = useState<Mode>("signin");
  const [email, setEmail] = useState("");
  const [code, setCode] = useState("");
  const [notice, setNotice] = useState("");
  const [busy, setBusy] = useState(false);
  const [revealed, reveal] = useState(false);
  const [key, setKey] = useState("");
  function switchTo(next: Mode) {
    modeTo(next);
    setNotice("");
    reveal(false);
  }
  useEffect(() => {
    if (new URLSearchParams(location.search).get("reason") === "sync") {
      const frame = requestAnimationFrame(() =>
        setNotice("Sign in to the original account to sync its saved entries."),
      );
      return () => cancelAnimationFrame(frame);
    }
    const hash = new URLSearchParams(location.hash.slice(1));
    if (hash.has("reset")) {
      const frame = requestAnimationFrame(() => {
        modeTo("reset");
        setCode(hash.get("reset")!);
        setEmail(hash.get("email") || "");
        history.replaceState(null, "", "/signin");
      });
      return () => cancelAnimationFrame(frame);
    }
  }, []);
  async function submit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setNotice("");
    setBusy(true);
    const form = new FormData(e.currentTarget);
    try {
      const res = await fetch("/api/auth/" + mode, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          email,
          username: form.get("username"),
          password: form.get("password"),
          code,
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error);
      if (data.recovery) setKey(data.recovery);
      else if (mode === "forgot")
        setNotice(
          "If your account exists, a reset link will arrive by email. It expires in 20 minutes.",
        );
      else location.replace("/dashboard");
    } catch (err) {
      setNotice(err instanceof Error ? err.message : "Please try again.");
    } finally {
      setBusy(false);
    }
  }
  return (
    <div className="auth-layout">
      <section className="auth-cover">
        <Brand />
        <div className="cover-center">
          <div className="example-card">
            <div className="sample-head">
              <WalletCards size={20} /> Example statement
            </div>
            <small>Remaining amount</small>
            <strong>Rs. 500</strong>
            <div className="sample-row">
              <span>Bottles delivered</span>
              <b>10 × Rs. 150</b>
            </div>
            <div className="sample-row">
              <span>Latest payment</span>
              <b>Rs. 1,000</b>
            </div>
          </div>
          <h2>
            Your water ledger,
            <br />
            in one place.
          </h2>
          <p>Track each delivery, payment and remaining rupee.</p>
        </div>
        <Waves className="cover-wave" size={54} />
      </section>
      <section className="auth-pane">
        <div className="auth-box">
          <div className="auth-mobile-brand">
            <Brand />
          </div>
          <span className="section-icon">
            <Droplet size={24} />
          </span>
          <h1>
            {key
              ? "Save your recovery key"
              : mode === "signin"
                ? "Welcome back"
                : mode === "signup"
                  ? "Create your account"
                  : mode === "forgot"
                    ? "Forgot your password?"
                    : "Set a new password"}
          </h1>
          <p className="auth-sub">
            {key
              ? "Keep this key somewhere private. You can use it to reset your password."
              : mode === "signin"
                ? "Sign in to your water delivery ledger."
                : mode === "signup"
                  ? "Start a personal ledger for your water deliveries."
                  : mode === "forgot"
                    ? "Enter your account email to request a reset link."
                    : "Use your emailed link or saved recovery key."}
          </p>
          {key ? (
            <>
              <code className="recovery-code">{key}</code>
              <button
                className="primary wide"
                onClick={() => {
                  if (mode === "reset") {
                    setKey("");
                    setCode("");
                    switchTo("signin");
                  } else location.replace("/dashboard");
                }}
              >
                {mode === "reset" ? "Continue to sign in" : "Open dashboard"}
              </button>
            </>
          ) : (
            <>
              <form className="fields" key={mode} onSubmit={submit}>
                {mode === "signup" && (
                  <label>
                    Username
                    <input
                      name="username"
                      autoComplete="username"
                      required
                      minLength={3}
                      maxLength={32}
                    />
                  </label>
                )}
                <label>
                  {mode === "signin" ? "Email or username" : "Email address"}
                  <input
                    required
                    type={mode === "signin" ? "text" : "email"}
                    autoComplete={mode === "signin" ? "username" : "email"}
                    placeholder="you@example.com"
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                  />
                </label>
                {mode === "reset" && (
                  <label>
                    Recovery key or reset code
                    <input
                      required
                      value={code}
                      onChange={(e) => setCode(e.target.value)}
                    />
                  </label>
                )}
                {mode !== "forgot" && (
                  <label>
                    {mode === "reset" ? "New password" : "Password"}
                    <span className="password-field">
                      <input
                        required
                        type={revealed ? "text" : "password"}
                        name="password"
                        minLength={mode === "signin" ? 1 : 8}
                        maxLength={128}
                        autoComplete={
                          mode === "signin"
                            ? "current-password"
                            : "new-password"
                        }
                        placeholder={
                          mode === "signin"
                            ? "Enter your password"
                            : "At least 8 characters"
                        }
                      />
                      <button
                        aria-label={
                          revealed ? "Hide password" : "Show password"
                        }
                        type="button"
                        onClick={() => reveal(!revealed)}
                      >
                        {revealed ? <EyeOff size={18} /> : <Eye size={18} />}
                      </button>
                    </span>
                  </label>
                )}
                {mode === "signin" && (
                  <button
                    type="button"
                    className="link forgot"
                    onClick={() => switchTo("forgot")}
                  >
                    Forgot password?
                  </button>
                )}
                {notice && (
                  <p role="status" className="inline-msg">
                    {notice}
                  </p>
                )}
                <button className="primary wide" disabled={busy}>
                  {busy ? "Please wait…" : labels[mode]}
                </button>
              </form>
              {mode === "forgot" && (
                <button
                  className="secondary wide"
                  onClick={() => switchTo("reset")}
                >
                  Use a recovery key
                </button>
              )}
              <p className="auth-switch">
                {mode === "signin" ? "New to WaterTracker? " : ""}
                <button
                  className="link"
                  onClick={() =>
                    switchTo(mode === "signin" ? "signup" : "signin")
                  }
                >
                  {mode === "signin" ? "Create an account" : "Back to sign in"}
                </button>
              </p>
            </>
          )}
        </div>
      </section>
    </div>
  );
}

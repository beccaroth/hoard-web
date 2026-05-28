import { useEffect, useState } from "react";
import { toast } from "sonner";
import { Cloud, LogOut, User, X } from "lucide-react";
import { supabase } from "../lib/supabase.js";

export default function AuthControl({ session }) {
  const [open, setOpen] = useState(false);
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [mode, setMode] = useState("signin"); // "signin" | "signup"
  const [sending, setSending] = useState(false);

  // Password-recovery state — set when Supabase fires PASSWORD_RECOVERY
  // after the user lands from a reset email link.
  const [recovering, setRecovering] = useState(false);
  const [newPwd, setNewPwd] = useState("");
  const [confirmPwd, setConfirmPwd] = useState("");
  const [updating, setUpdating] = useState(false);

  useEffect(() => {
    if (!open) return;
    function onDoc(e) { if (!e.target.closest(".auth")) setOpen(false); }
    document.addEventListener("click", onDoc);
    return () => document.removeEventListener("click", onDoc);
  }, [open]);

  useEffect(() => {
    if (!supabase) return;
    const { data: sub } = supabase.auth.onAuthStateChange((event) => {
      if (event === "PASSWORD_RECOVERY") setRecovering(true);
    });
    return () => sub.subscription.unsubscribe();
  }, []);

  if (!supabase) return null; // sync not configured

  function reset() {
    setOpen(false);
    setEmail("");
    setPassword("");
    setMode("signin");
  }

  async function submitPassword(e) {
    e.preventDefault();
    const addr = email.trim();
    if (!addr || !password) return;
    setSending(true);
    const fn = mode === "signup" ? "signUp" : "signInWithPassword";
    const { data, error } = await supabase.auth[fn]({
      email: addr,
      password,
      ...(mode === "signup" ? { options: { emailRedirectTo: window.location.origin } } : {}),
    });
    setSending(false);
    if (error) {
      toast(mode === "signup" ? "Couldn't sign up" : "Couldn't sign in", { description: error.message });
      return;
    }
    if (mode === "signup" && !data.session) {
      toast("Check your email", { description: "Confirm your address to finish signing up" });
    }
    reset();
  }

  async function sendLink() {
    const addr = email.trim();
    if (!addr) return;
    setSending(true);
    const { error } = await supabase.auth.signInWithOtp({
      email: addr,
      options: { emailRedirectTo: window.location.origin },
    });
    setSending(false);
    if (error) {
      toast("Couldn't send link", { description: error.message });
    } else {
      toast("Check your email", { description: "Magic link sent to " + addr });
      reset();
    }
  }

  async function sendReset() {
    const addr = email.trim();
    if (!addr) {
      toast("Enter your email first");
      return;
    }
    setSending(true);
    const { error } = await supabase.auth.resetPasswordForEmail(addr, {
      redirectTo: window.location.origin,
    });
    setSending(false);
    if (error) {
      toast("Couldn't send reset", { description: error.message });
    } else {
      toast("Check your email", { description: "Password reset link sent to " + addr });
      reset();
    }
  }

  async function submitNewPassword(e) {
    e.preventDefault();
    if (!newPwd || newPwd !== confirmPwd) return;
    setUpdating(true);
    const { error } = await supabase.auth.updateUser({ password: newPwd });
    setUpdating(false);
    if (error) {
      toast("Couldn't update password", { description: error.message });
      return;
    }
    toast("Password updated");
    setRecovering(false);
    setNewPwd("");
    setConfirmPwd("");
  }

  async function cancelRecovery() {
    setRecovering(false);
    setNewPwd("");
    setConfirmPwd("");
    await supabase.auth.signOut({ scope: "local" });
  }

  const recoveryModal = recovering && (
    <div className="reset-backdrop" onClick={cancelRecovery}>
      <form
        className="help-modal auth-reset"
        onClick={(e) => e.stopPropagation()}
        onSubmit={submitNewPassword}
        role="dialog"
        aria-label="Set a new password"
      >
        <div className="help-head">
          <span>Set a new password</span>
          <button type="button" className="help-close" aria-label="Cancel" onClick={cancelRecovery}>
            <X size={16} />
          </button>
        </div>
        <div className="auth-reset-body">
          <input
            className="auth-input"
            type="password"
            placeholder="New password"
            value={newPwd}
            onChange={(e) => setNewPwd(e.target.value)}
            autoComplete="new-password"
            minLength={6}
            autoFocus
          />
          <input
            className="auth-input"
            type="password"
            placeholder="Confirm new password"
            value={confirmPwd}
            onChange={(e) => setConfirmPwd(e.target.value)}
            autoComplete="new-password"
            minLength={6}
          />
          {confirmPwd && newPwd !== confirmPwd && (
            <div className="auth-reset-error">Passwords don't match</div>
          )}
          <button
            className="btn-primary"
            type="submit"
            disabled={updating || !newPwd || newPwd !== confirmPwd}
          >
            {updating ? "Updating…" : "Update password"}
          </button>
        </div>
      </form>
    </div>
  );

  if (session) {
    return (
      <div className="auth">
        <button
          className="btn-ghost icon-btn auth-trigger"
          title={session.user.email}
          onClick={(e) => { e.stopPropagation(); setOpen((o) => !o); }}
        >
          <User size={15} />
        </button>
        {open && (
          <div className="menu show auth-menu" onClick={(e) => e.stopPropagation()}>
            <div className="auth-email" title={session.user.email}>{session.user.email}</div>
            <div className="sep" />
            <button onClick={async () => {
              setOpen(false);
              const { error } = await supabase.auth.signOut({ scope: "local" });
              if (error) toast("Couldn't sign out", { description: error.message });
            }}>
              <LogOut size={15} /> Sign out
            </button>
          </div>
        )}
        {recoveryModal}
      </div>
    );
  }

  const isSignup = mode === "signup";
  return (
    <div className="auth">
      <button className="btn-ghost icon-btn" title="Sync across devices"
        onClick={(e) => { e.stopPropagation(); setOpen((o) => !o); }}>
        <Cloud size={15} /> Sync
      </button>
      {open && (
        <form className="menu show auth-form" onClick={(e) => e.stopPropagation()} onSubmit={submitPassword}>
          <label className="auth-label">
            {isSignup ? "Create an account to sync" : "Sign in to sync across devices"}
          </label>
          <input
            className="auth-input"
            type="email"
            placeholder="you@email.com"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            autoComplete="email"
            autoFocus
          />
          <input
            className="auth-input"
            type="password"
            placeholder="Password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            autoComplete={isSignup ? "new-password" : "current-password"}
            minLength={6}
          />
          <button className="btn-primary" type="submit" disabled={sending || !email || !password}>
            {sending ? "…" : isSignup ? "Create account" : "Sign in"}
          </button>
          {!isSignup && (
            <button
              type="button"
              className="auth-switch auth-forgot"
              onClick={sendReset}
              disabled={sending}
            >
              Forgot password?
            </button>
          )}
          <div className="auth-divider"><span>or</span></div>
          <button
            type="button"
            className="btn-ghost auth-alt"
            onClick={sendLink}
            disabled={sending || !email}
          >
            Email me a magic link
          </button>
          <button
            type="button"
            className="auth-switch"
            onClick={() => setMode(isSignup ? "signin" : "signup")}
          >
            {isSignup ? "Already have an account? Sign in" : "Need an account? Sign up"}
          </button>
        </form>
      )}
      {recoveryModal}
    </div>
  );
}

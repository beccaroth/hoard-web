import { useEffect, useState } from "react";
import { toast } from "sonner";
import { Cloud, LogOut, User } from "lucide-react";
import { supabase } from "../lib/supabase.js";

export default function AuthControl({ session }) {
  const [open, setOpen] = useState(false);
  const [email, setEmail] = useState("");
  const [sending, setSending] = useState(false);

  useEffect(() => {
    if (!open) return;
    function onDoc(e) { if (!e.target.closest(".auth")) setOpen(false); }
    document.addEventListener("click", onDoc);
    return () => document.removeEventListener("click", onDoc);
  }, [open]);

  if (!supabase) return null; // sync not configured

  async function sendLink(e) {
    e.preventDefault();
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
      setOpen(false);
      setEmail("");
    }
  }

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
            <button onClick={() => { setOpen(false); supabase.auth.signOut(); }}>
              <LogOut size={15} /> Sign out
            </button>
          </div>
        )}
      </div>
    );
  }

  return (
    <div className="auth">
      <button className="btn-ghost icon-btn" title="Sync across devices"
        onClick={(e) => { e.stopPropagation(); setOpen((o) => !o); }}>
        <Cloud size={15} /> Sync
      </button>
      {open && (
        <form className="menu show auth-form" onClick={(e) => e.stopPropagation()} onSubmit={sendLink}>
          <label className="auth-label">Sign in to sync across devices</label>
          <input
            className="auth-input"
            type="email"
            placeholder="you@email.com"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            autoFocus
          />
          <button className="btn-primary" type="submit" disabled={sending}>
            {sending ? "Sending…" : "Send magic link"}
          </button>
        </form>
      )}
    </div>
  );
}

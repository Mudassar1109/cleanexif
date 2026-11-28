import { useEffect, useRef, useState } from "react";
import { CreditCard, LockKeyhole, LogOut, Settings, Sparkles, UserRound } from "lucide-react";
import { cleanexifSupabase } from "./planAccess";
type UserShape = { id: string; email?: string; user_metadata?: Record<string, unknown> };

const avatarOf = (user: UserShape | null) => {
  const meta = user?.user_metadata ?? {};
  const value = meta.avatar_url ?? meta.picture;
  return typeof value === "string" ? value : "";
};
const initials = (name: string, email: string) => {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  return (parts.length > 1 ? parts[0][0] + parts[parts.length - 1][0] : (parts[0]?.slice(0, 2) || email.slice(0, 2))).toUpperCase();
};

export function AccountMenu({ email }: { email: string | null }) {
  const [open, setOpen] = useState(false);
  const [user, setUser] = useState<UserShape | null>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    if (!cleanexifSupabase) return;
    cleanexifSupabase.auth.getUser().then(({ data }) => setUser(data.user as UserShape | null));
    const { data: { subscription } } = cleanexifSupabase.auth.onAuthStateChange((_event, session) => setUser(session?.user as UserShape ?? null));
    return () => subscription.unsubscribe();
  }, []);
  useEffect(() => {
    const close = (event: PointerEvent) => {
      const target = event.target;
      if (target instanceof Element && !target.closest(".account-menu-wrap")) setOpen(false);
    };
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        setOpen(false);
        triggerRef.current?.focus();
      }
    };
    document.addEventListener("pointerdown", close);
    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.removeEventListener("pointerdown", close);
      document.removeEventListener("keydown", onKeyDown);
    };
  }, []);
  const name = String(user?.user_metadata?.full_name ?? user?.user_metadata?.name ?? "");
  const avatar = avatarOf(user);
  return <div className="account-menu-wrap">
    <button ref={triggerRef} className="account-avatar-trigger" type="button" aria-label={open ? "Close account menu" : "Open account menu"} aria-haspopup="true" aria-controls="cleanexif-account-popover" aria-expanded={open} onClick={() => setOpen(v => !v)}>
      {avatar ? <img src={avatar} alt="" /> : <span>{email ? initials(name, email) : <UserRound size={19}/>}</span>}
    </button>
    {open && <div id="cleanexif-account-popover" className="account-popover">
      {email ? <>
        <div className="account-popover-user"><b>{name || "CleanExif member"}</b><span>{email}</span></div>
        <a href="/account"><UserRound size={17}/> Profile</a>
        <a href="/account?tab=subscription"><CreditCard size={17}/> Subscription</a>
        <a href="/account?tab=settings"><Settings size={17}/> Settings</a>
        <button type="button" onClick={() => void cleanexifSupabase?.auth.signOut().then(() => { window.location.href = "/"; })}><LogOut size={17}/> Sign out</button>
      </> : <>
        <a href="/login"><LockKeyhole size={17}/> Sign in</a>
        <a href="/signup"><Sparkles size={17}/> Create account</a>
      </>}
    </div>}
  </div>;
}

import { useEffect, useState, type FormEvent } from "react";
import {
  ArrowLeft, Camera, ChevronRight, CreditCard, HelpCircle, Image,
  LockKeyhole, LogOut, Mail, Menu, Settings, ShieldCheck, UserRound, X,
  Eye, EyeOff, Sparkles, Gauge
} from "lucide-react";
import { cleanexifSupabase, usePlanAccess } from "./planAccess";
import "./account.css";

type View = "profile" | "subscription" | "settings";
type AuthMode = "signin" | "signup";
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

function Brand() {
  return <a className="brand" href="/" aria-label="CleanExif home"><img className="brand-logo-image" src="/cleanexif-logo-v2.svg" alt="CleanExif" /></a>;
}

export function AccountMenu({ email }: { email: string | null }) {
  const [open, setOpen] = useState(false);
  const [user, setUser] = useState<UserShape | null>(null);
  const [authLoading, setAuthLoading] = useState(true);
  useEffect(() => {
    if (!cleanexifSupabase) return;
    cleanexifSupabase.auth.getUser().then(({ data }) => setUser(data.user as UserShape | null));
    const { data: { subscription } } = cleanexifSupabase.auth.onAuthStateChange((_event, session) => setUser(session?.user as UserShape ?? null));
    return () => subscription.unsubscribe();
  }, []);
  useEffect(() => {
    const close = (event: MouseEvent) => {
      if (!(event.target as HTMLElement).closest(".account-menu-wrap")) setOpen(false);
    };
    document.addEventListener("click", close);
    return () => document.removeEventListener("click", close);
  }, []);
  const name = String(user?.user_metadata?.full_name ?? user?.user_metadata?.name ?? "");
  const avatar = avatarOf(user);
  return <div className="account-menu-wrap">
    <button className="account-avatar-trigger" type="button" aria-label="Open account menu" aria-expanded={open} onClick={() => setOpen(v => !v)}>
      {avatar ? <img src={avatar} alt="" /> : <span>{email ? initials(name, email) : <UserRound size={19}/>}</span>}
    </button>
    {open && <div className="account-popover">
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

export default function AccountPage({ initialMode }: { initialMode?: AuthMode }) {
  const [user, setUser] = useState<UserShape | null>(null);
  const [authMode, setAuthMode] = useState<AuthMode>(initialMode ?? "signup");
  const [view, setView] = useState<View>(() => {
    const tab = new URLSearchParams(window.location.search).get("tab");
    return tab === "subscription" || tab === "settings" ? tab : "profile";
  });
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [fullName, setFullName] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [mobileNav, setMobileNav] = useState(false);
  const metadata = usePlanAccess("metadata");
  const watermark = usePlanAccess("watermark");

  useEffect(() => {
    if (!cleanexifSupabase) return;
    cleanexifSupabase.auth.getUser().then(({ data }) => {
      const next = data.user as UserShape | null;
      setUser(next);
      setAuthLoading(false);
      if (next) setFullName(String(next.user_metadata?.full_name ?? next.user_metadata?.name ?? ""));
    });
    const { data: { subscription } } = cleanexifSupabase.auth.onAuthStateChange((_event, session) => {
      const next = session?.user as UserShape ?? null;
      setUser(next);
      setAuthLoading(false);
      if (next) setFullName(String(next.user_metadata?.full_name ?? next.user_metadata?.name ?? ""));
    });
    return () => subscription.unsubscribe();
  }, []);

  const userEmail = user?.email ?? "";
  const displayName = String(user?.user_metadata?.full_name ?? user?.user_metadata?.name ?? "");
  const avatar = avatarOf(user);
  const initialsText = initials(displayName, userEmail);
  const tabLabel = view === "profile" ? "Profile" : view === "subscription" ? "Subscription" : "Settings";

  async function signInOrUp(event: FormEvent) {
    event.preventDefault();
    if (!cleanexifSupabase) { setError("Account service is not configured. Please contact support."); return; }
    setBusy(true); setError(""); setNotice("");
    try {
      const cleanEmail = email.trim().toLowerCase();
      const result = authMode === "signup"
        ? await cleanexifSupabase.auth.signUp({ email: cleanEmail, password, options: { data: { full_name: fullName.trim() }, emailRedirectTo: window.location.origin + "/account" } })
        : await cleanexifSupabase.auth.signInWithPassword({ email: cleanEmail, password });
      if (result.error) setError(result.error.message);
      else if (authMode === "signup" && !result.data.session) setNotice("Account created. Check your email for a confirmation link, then sign in.");
      else { setPassword(""); setNotice("You are signed in. Your account is ready."); }
    } catch (e) { setError(e instanceof Error ? e.message : "Authentication failed. Please try again."); }
    finally { setBusy(false); }
  }

  async function googleSignIn() {
    if (!cleanexifSupabase) { setError("Account service is not configured."); return; }
    setBusy(true); setError(""); setNotice("");
    const { error: authError } = await cleanexifSupabase.auth.signInWithOAuth({
      provider: "google",
      options: { redirectTo: window.location.origin + "/account", queryParams: { prompt: "select_account" } }
    });
    if (authError) { setError(authError.message); setBusy(false); }
  }

  async function saveProfile(event: FormEvent) {
    event.preventDefault();
    if (!cleanexifSupabase) return;
    setBusy(true); setError(""); setNotice("");
    const { data, error: updateError } = await cleanexifSupabase.auth.updateUser({ data: { full_name: fullName.trim() } });
    if (updateError) setError(updateError.message);
    else { setUser(data.user as UserShape); setNotice("Profile updated successfully."); }
    setBusy(false);
  }

  async function updatePassword(event: FormEvent) {
    event.preventDefault();
    if (!cleanexifSupabase) return;
    if (newPassword.length < 8) { setError("Use at least 8 characters for your new password."); return; }
    if (newPassword !== confirmPassword) { setError("New password and confirmation do not match."); return; }
    setBusy(true); setError(""); setNotice("");
    const { error: updateError } = await cleanexifSupabase.auth.updateUser({ password: newPassword });
    if (updateError) setError(updateError.message);
    else { setNewPassword(""); setConfirmPassword(""); setNotice("Password changed successfully."); }
    setBusy(false);
  }

  async function resetPassword() {
    if (!cleanexifSupabase || !userEmail) return;
    setBusy(true); setError(""); setNotice("");
    const { error: resetError } = await cleanexifSupabase.auth.resetPasswordForEmail(userEmail, { redirectTo: window.location.origin + "/account?tab=settings" });
    if (resetError) setError(resetError.message);
    else setNotice("If the account is eligible, a password reset email has been sent.");
    setBusy(false);
  }

  async function signOut() {
    await cleanexifSupabase?.auth.signOut();
    setUser(null);
    window.location.href = "/";
  }

  if (authLoading) return <div className="account-auth-page"><header className="account-topbar"><div className="container"><Brand/></div></header><div className="account-loading">Loading your secure account…</div></div>;

  if (!user) return <div className="account-auth-page">
    <header className="account-topbar"><div className="container"><Brand/><a href="/" className="account-back"><ArrowLeft size={16}/> Back to CleanExif</a></div></header>
    <main className="account-auth-layout">
      <section className="account-auth-story">
        <span className="account-kicker"><ShieldCheck size={15}/> YOUR PRIVATE WORKSPACE</span>
        <h1>One account.<br/><span>More control.</span></h1>
        <p>Manage your CleanExif profile, check your plan and keep track of your daily image allowance in one secure place.</p>
        <div className="account-story-points">
          <div><ShieldCheck/><span><b>Privacy-first</b><small>Your images stay in your browser during processing.</small></span></div>
          <div><Gauge/><span><b>Usage at a glance</b><small>See your current plan and daily limits.</small></span></div>
          <div><CreditCard/><span><b>Clear plan access</b><small>Review your subscription status and expiry.</small></span></div>
        </div>
      </section>
      <section className="account-auth-card">
        <div className="account-auth-card-head"><div className="account-auth-icon"><LockKeyhole/></div><span className="account-kicker">CLEANEXIF ACCOUNT</span><h2>{authMode === "signup" ? "Create your account" : "Welcome back"}</h2><p>{authMode === "signup" ? "Set up your account to manage your CleanExif access." : "Sign in to continue to your account."}</p></div>
        <div className="account-auth-switch"><button className={authMode === "signin" ? "active" : ""} onClick={() => {setAuthMode("signin");setError("");setNotice("");}}>Sign in</button><button className={authMode === "signup" ? "active" : ""} onClick={() => {setAuthMode("signup");setError("");setNotice("");}}>Create account</button></div>
        <button className="account-google" type="button" onClick={() => void googleSignIn()} disabled={busy}><svg viewBox="0 0 48 48" aria-hidden="true"><path fill="#EA4335" d="M24 9.5c3.54 0 6.71 1.22 9.21 3.6l6.85-6.85C35.9 2.38 30.47 0 24 0 14.62 0 6.51 5.38 2.56 13.22l7.98 6.19C12.43 13.72 17.74 9.5 24 9.5z"/><path fill="#4285F4" d="M46.98 24.55c0-1.57-.15-3.09-.38-4.55H24v9.02h12.94c-.58 2.96-2.25 5.48-4.73 7.18l7.28 5.64c4.25-3.92 7.49-9.72 7.49-17.29z"/><path fill="#FBBC05" d="M10.53 28.59A14.4 14.4 0 0 1 9.75 24c0-1.59.27-3.13.76-4.59l-7.98-6.19A23.9 23.9 0 0 0 0 24c0 3.87.93 7.54 2.56 10.78l7.97-6.19z"/><path fill="#34A853" d="M24 48c6.48 0 11.93-2.13 15.9-5.8l-7.28-5.64c-2.02 1.35-4.6 2.15-8.62 2.15-6.26 0-11.57-4.22-13.47-9.91l-7.98 6.19C6.51 43.62 14.62 48 24 48z"/></svg>Continue with Google</button>
        <div className="account-auth-divider"><span>or use your email</span></div>
        <form onSubmit={signInOrUp}>
          {authMode === "signup" && <label>Full name<input value={fullName} onChange={e=>setFullName(e.target.value)} autoComplete="name" placeholder="Your name" required/></label>}
          <label>Email address<input type="email" value={email} onChange={e=>setEmail(e.target.value)} autoComplete="email" placeholder="you@example.com" required/></label>
          <label>Password<span className="account-password-wrap"><input type={showPassword?"text":"password"} value={password} onChange={e=>setPassword(e.target.value)} minLength={8} autoComplete={authMode==="signup"?"new-password":"current-password"} placeholder="At least 8 characters" required/><button type="button" aria-label={showPassword?"Hide password":"Show password"} onClick={()=>setShowPassword(v=>!v)}>{showPassword?<EyeOff size={17}/>:<Eye size={17}/>}</button></span></label>
          <button className="account-submit" disabled={busy}>{busy?"Please wait…":authMode==="signup"?"Create account":"Sign in securely"}</button>
        </form>
        {authMode === "signin" && <button className="account-forgot" type="button" onClick={async()=>{if(!cleanexifSupabase||!email.trim()){setError("Enter your email address first.");return;}setBusy(true);setError("");const {error:e}=await cleanexifSupabase.auth.resetPasswordForEmail(email.trim().toLowerCase(),{redirectTo:window.location.origin+"/account?tab=settings"});if(e)setError(e.message);else setNotice("If the account exists, a password reset email has been sent.");setBusy(false);}}>Forgot password?</button>}
        {error&&<p className="account-message error">{error}</p>}{notice&&<p className="account-message success">{notice}</p>}
        <p className="account-auth-foot">By continuing, you agree to use CleanExif responsibly. Your image files are processed locally in your browser.</p>
      </section>
    </main>
  </div>;

  const usage = [
    { label: "Metadata Inspector", value: metadata.dailyUsage, icon: <Image size={18}/> },
    { label: "Watermark Maker", value: watermark.dailyUsage, icon: <Camera size={18}/> }
  ];
  const menuItems: { id: View; label: string; icon: JSX.Element }[] = [
    { id: "profile", label: "Profile", icon: <UserRound size={19}/> },
    { id: "subscription", label: "Subscription", icon: <CreditCard size={19}/> },
    { id: "settings", label: "Settings", icon: <Settings size={19}/> }
  ];
  return <div className="account-page">
    <header className="account-topbar"><div className="container"><Brand/><div className="account-top-actions"><span><ShieldCheck size={15}/> Secure account</span><button type="button" onClick={()=>void signOut()}><LogOut size={16}/> Sign out</button></div></div></header>
    <main className="account-dashboard">
      <aside className={"account-sidebar"+(mobileNav?" mobile-open":"")}>
        <div className="account-sidebar-user">{avatar?<img src={avatar} alt="Profile"/>:<span className="account-avatar-fallback">{initialsText}</span>}<div><b>{displayName||"CleanExif member"}</b><small>{userEmail}</small></div><button className="account-sidebar-close" onClick={()=>setMobileNav(false)} aria-label="Close menu"><X size={17}/></button></div>
        <nav>{menuItems.map(item=><button key={item.id} className={view===item.id?"active":""} onClick={()=>{setView(item.id);setMobileNav(false);window.history.replaceState({}, "", "/account"+(item.id==="profile"?"":"?tab="+item.id));}}>{item.icon}{item.label}</button>)}</nav>
        <div className="account-sidebar-bottom"><a href="/#faq"><HelpCircle size={18}/> Help center</a><button onClick={()=>void signOut()}><LogOut size={18}/> Sign out</button></div>
      </aside>
      <section className="account-content">
        <button className="account-mobile-menu" onClick={()=>setMobileNav(true)}><Menu size={18}/> Account menu</button>
        <div className="account-content-heading"><div><span className="account-kicker">YOUR ACCOUNT</span><h1>{tabLabel}</h1><p>Manage your CleanExif account and preferences.</p></div><a href="/" className="account-return"><ArrowLeft size={16}/> Back to CleanExif</a></div>
        {error&&<p className="account-message error">{error}</p>}{notice&&<p className="account-message success">{notice}</p>}
        {view==="profile"&&<div className="account-panel">
          <form onSubmit={saveProfile}>
            <div className="account-section-title"><div><h2>Personal information</h2><p>Keep your account details up to date.</p></div></div>
            <div className="account-profile-photo">{avatar?<img src={avatar} alt="Profile"/>:<span>{initialsText}</span>}<div><b>Profile photo</b><small>{avatar?"Photo provided by your connected sign-in provider.":"Your initials are shown until a profile photo is available."}</small></div></div>
            <label>Full name<input value={fullName} onChange={e=>setFullName(e.target.value)} placeholder="Your name" autoComplete="name"/></label>
            <label>Email address<input value={userEmail} disabled readOnly/><small className="account-field-help">Your sign-in email is managed securely by your authentication provider.</small></label>
            <div className="account-form-actions"><button className="account-submit" disabled={busy}>{busy?"Saving…":"Save profile"}</button></div>
          </form>
        </div>}
        {view==="subscription"&&<div className="account-subscription-stack">
          <div className="account-plan-summary"><div><span className="account-kicker">CURRENT PLAN</span><h2>{metadata.limits.name}</h2><p>{metadata.limits.code==="free"?"You are currently using the free CleanExif plan.":"Your paid access is managed by CleanExif support."}</p></div><span className={"account-plan-badge "+(metadata.limits.code==="free"?"free":"paid")}>{metadata.limits.code.toUpperCase()}</span></div>
          {metadata.limits.expiresAt&&<div className="account-expiry"><CreditCard size={18}/><span><b>Plan expiry</b><small>{new Date(metadata.limits.expiresAt).toLocaleString(undefined,{dateStyle:"medium",timeStyle:"short"})}</small></span></div>}
          <div className="account-usage-grid">{usage.map(item=><article key={item.label}><div>{item.icon}<span>{item.label}</span></div><strong>{item.value?item.value.remaining+" / "+item.value.limit:"—"}</strong><small>Images remaining today</small><div className="account-usage-track"><span style={{width:item.value?Math.max(0,Math.min(100,(item.value.remaining/item.value.limit)*100))+"%":"0%"}}/></div></article>)}</div>
          <div className="account-subscription-foot"><p>Need a higher daily allowance? Compare the available plans or contact us for activation.</p><a href="/plans">View plans <ChevronRight size={16}/></a></div>
        </div>}
        {view==="settings"&&<div className="account-panel">
          <form onSubmit={updatePassword}>
            <div className="account-section-title"><div><h2>Security</h2><p>Change your password for email and password sign-in.</p></div></div>
            <label>New password<input type="password" value={newPassword} onChange={e=>setNewPassword(e.target.value)} minLength={8} autoComplete="new-password" placeholder="At least 8 characters"/></label>
            <label>Confirm new password<input type="password" value={confirmPassword} onChange={e=>setConfirmPassword(e.target.value)} minLength={8} autoComplete="new-password" placeholder="Re-enter new password"/></label>
            <div className="account-form-actions"><button className="account-submit" disabled={busy}>{busy?"Updating…":"Update password"}</button></div>
          </form>
          <div className="account-settings-divider"/>
          <div className="account-section-title"><div><h2>Password recovery</h2><p>Send a password reset link to {userEmail}.</p></div></div>
          <button type="button" className="account-secondary-action" onClick={()=>void resetPassword()} disabled={busy}><Mail size={17}/> Send password reset email</button>
          <div className="account-settings-divider"/>
          <div className="account-section-title"><div><h2>Sign out</h2><p>End your current CleanExif session on this browser.</p></div></div>
          <button type="button" className="account-danger-action" onClick={()=>void signOut()}><LogOut size={17}/> Sign out</button>
        </div>}
      </section>
    </main>
  </div>;
}

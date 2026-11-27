import { useEffect,useState,type FormEvent } from "react";
import { Check,ShieldCheck,LogIn,LogOut,MessageCircle,Sparkles,LockKeyhole } from "lucide-react";
import {cleanexifSupabase,usePlanAccess} from "./planAccess";
import "./plans.css";
import { SiteHeader, SiteFooter } from "./SiteChrome";

const WA="https://wa.me/923197013743";
const prices:Record<string,string>={free:"$0",pro:"$4.99",business:"$12.99"};
const bullets:Record<string,string[]>={free:["10 metadata-cleaning images per day","10 images per batch","100 MB total batch size","25 MB maximum per file","Core cleaner and watermark workflow","GPS remover, privacy scanner and EXIF editor"],pro:["50 metadata-cleaning images per day","100 images per batch","500 MB total batch size","50 MB maximum per file","Higher daily and batch limits","All five image tools"],business:["200 metadata-cleaning images per day","200 images per batch","1 GB total batch size","100 MB maximum per file","High-volume batch workflows","All five image tools"]};
export default function PlansPage({accountOnly=false}:{accountOnly?:boolean}){
 const {limits,email,loading,expiryCountdown,isPlanExpired}=usePlanAccess();const [plans,setPlans]=useState<any[]>([]),[authEmail,setAuthEmail]=useState(""),[password,setPassword]=useState("");
 const [mode,setMode]=useState<"signin"|"signup">("signup"),[busy,setBusy]=useState(false),[notice,setNotice]=useState(""),[error,setError]=useState("");
 useEffect(()=>{if(cleanexifSupabase)void cleanexifSupabase.from("cleanexif_plans").select("code,name,description,active").eq("active",true).order("sort_order").then(({data})=>setPlans(data||[]));},[]);
 async function submit(e:FormEvent){
  e.preventDefault();
  if(!cleanexifSupabase){setError("Account service is not configured. Please contact support.");return;}
  setBusy(true);setError("");setNotice("");
  try{
   const cleanEmail=authEmail.trim().toLowerCase();
   const result=mode==="signup"
    ?await cleanexifSupabase.auth.signUp({email:cleanEmail,password,options:{emailRedirectTo:window.location.origin+"/"}})
    :await cleanexifSupabase.auth.signInWithPassword({email:cleanEmail,password});
   if(result.error){
    const msg=result.error.message;
    if(mode==="signin"&&/invalid login credentials/i.test(msg))setError("This email/password was not accepted. If you have not created and verified a CleanExif account yet, choose Create account first. Otherwise use Forgot password.");
    else if(/already registered|already been registered|user already registered/i.test(msg))setError("An account already exists with this email. Choose Sign in, or use Forgot password if needed.");
    else if(/email not confirmed/i.test(msg))setError("Your email is not verified yet. Open the confirmation email from Supabase, verify it, then sign in.");
    else setError(msg);
   }else if(mode==="signup"&&!result.data.session){
    setNotice("Account request received. Check your inbox and spam folder for the Supabase confirmation email. Verify it before signing in. If no email arrives, ask support to check Supabase email settings.");
   }else{
    setNotice("Successfully signed in. Your plan access is loading.");
    setPassword("");
   }
  }catch(err){
   setError(err instanceof Error?err.message:"Could not reach the account service. Check your internet connection and try again.");
  }finally{setBusy(false);}
 }
 async function signInWithGoogle(){
  if(!cleanexifSupabase){setError("Account service is not configured. Please contact support.");return;}
  setBusy(true);setError("");setNotice("");
  try{
   const {error}=await cleanexifSupabase.auth.signInWithOAuth({provider:"google",options:{redirectTo:window.location.origin+"/",queryParams:{access_type:"offline",prompt:"select_account"}}});
   if(error){setError(error.message);setBusy(false);}
  }catch(err){setError(err instanceof Error?err.message:"Google sign-in could not be started. Please try again.");setBusy(false);}
 }
 async function resetPassword(){
  if(!cleanexifSupabase){setError("Account service is not configured. Please contact support.");return;}
  if(!authEmail.trim()){setError("Enter your account email first, then choose Forgot password.");return;}
  setBusy(true);setError("");setNotice("");
  try{
   const {error}=await cleanexifSupabase.auth.resetPasswordForEmail(authEmail.trim().toLowerCase(),{redirectTo:window.location.origin+"/plans"});
   if(error)setError(error.message);else setNotice("If an account exists for this email, a password-reset link has been sent. Check your inbox and spam folder.");
  }catch(err){setError(err instanceof Error?err.message:"Password reset request failed. Please try again.");}
  finally{setBusy(false);}
 }
 const wa=(code:string)=>WA+"?text="+encodeURIComponent("Hi CleanExif, I want to activate the "+code+" plan. My account email: "+(email||authEmail||"Not registered yet")+". Please share payment instructions.");
 return <div className="plans-page"><SiteHeader />
 <main className="container plans-main"><div className="plans-intro"><span className="eyebrow"><Sparkles size={14}/> SIMPLE, PRIVATE IMAGE TOOLS</span><h1>{accountOnly?"Your CleanExif account":<>Choose the plan that <span>fits your workflow.</span></>}</h1><p>{accountOnly?"Sign in or create an account to manage your CleanExif access.":"Start free with all five tools. Upgrade for larger daily allowances, bigger batches and higher file-size limits. Image processing stays in your browser."}</p><div className="plans-trust-row"><span><ShieldCheck size={15}/> Private browser processing</span><span><Check size={15}/> No auto-renewal</span><span><MessageCircle size={15}/> WhatsApp-assisted activation</span></div></div>
 {!accountOnly&&<><div className="current-plan"><ShieldCheck size={18}/><span>{email?<>Signed in as <b>{email}</b> · Current access: <b>{limits.name}</b>{expiryCountdown&&<> · {isPlanExpired?"Previous subscription expired":"Plan expires in"}: <b>{expiryCountdown}</b></>}</>:<>You are using the <b>Free plan</b>. Create an account to connect a manually activated subscription.</>}</span></div>
 <section className="plans-grid">{["free","pro","business"].map(code=>{const p=plans.find(x=>x.code===code);const title=p?.name||code[0].toUpperCase()+code.slice(1);return <article className={"pricing-card "+(code==="pro"?"pricing-featured":"")} key={code}>{code==="pro"&&<span className="pricing-tag">MOST POPULAR</span>}<div className="pricing-topline"><span className="pricing-name">{title}</span>{code==="free"&&<span className="pricing-current">START HERE</span>}{code==="pro"&&<span className="pricing-current">BEST VALUE</span>}</div><h2>{prices[code]}<small>{code==="free"?" forever":"/ month"}</small></h2><p>{p?.description||(code==="free"?"For personal image privacy and everyday cleaning.":code==="pro"?"For creators processing larger image batches.":"For high-volume image workflows.")}</p><div className="pricing-fit">{code==="free"?"All five tools included":code==="pro"?"Larger batches and ZIP export":"Highest daily and batch limits"}</div><ul>{(bullets[code]||[]).map(item=><li key={item}><Check size={16}/>{item}</li>)}</ul>{loading?<button className="button button-secondary" type="button" disabled>Checking current plan…</button>:email&&!isPlanExpired&&(["free","pro","business"].indexOf(code)<=["free","pro","business"].indexOf(limits.code))?<button className="button button-secondary" type="button" disabled aria-current={code===limits.code?"true":undefined}><LockKeyhole size={16}/>{code===limits.code?"Current plan":"Included in "+limits.name}</button>:code==="free"?<a className="button button-secondary" href="/watermark">Continue free</a>:<a className="button button-primary" href={wa(code)} target="_blank" rel="noreferrer"><svg className="whatsapp-brand-icon" viewBox="0 0 24 24" aria-hidden="true"><path fill="currentColor" d="M20.52 3.48A11.86 11.86 0 0 0 12.08 0C5.5 0 .15 5.35.15 11.93c0 2.1.55 4.15 1.6 5.96L0 24l6.27-1.64a11.9 11.9 0 0 0 5.8 1.48h.01c6.58 0 11.93-5.35 11.93-11.93 0-3.19-1.24-6.19-3.49-8.43ZM12.08 21.8h-.01a9.88 9.88 0 0 1-5.03-1.37l-.36-.21-3.72.98.99-3.63-.24-.37a9.88 9.88 0 0 1-1.52-5.27c0-5.46 4.44-9.9 9.9-9.9 2.65 0 5.14 1.03 7.01 2.9a9.84 9.84 0 0 1 2.9 7.01c0 5.46-4.44 9.9-9.9 9.9Zm5.43-7.41c-.3-.15-1.77-.87-2.05-.97-.27-.1-.47-.15-.67.15-.2.3-.77.97-.94 1.17-.17.2-.35.22-.65.07-.3-.15-1.26-.46-2.4-1.47-.89-.79-1.49-1.77-1.67-2.07-.17-.3-.02-.46.13-.61.13-.13.3-.35.45-.52.15-.17.2-.3.3-.5.1-.2.05-.37-.02-.52-.08-.15-.67-1.62-.92-2.22-.24-.58-.48-.5-.67-.51h-.57c-.2 0-.52.07-.8.37-.27.3-1.04 1.02-1.04 2.49s1.07 2.89 1.22 3.09c.15.2 2.1 3.2 5.08 4.49.71.31 1.27.5 1.7.64.72.23 1.37.2 1.88.12.57-.08 1.77-.72 2.02-1.42.25-.7.25-1.3.17-1.42-.07-.13-.27-.2-.57-.35Z"/></svg>{email?"Upgrade via WhatsApp":"Activate via WhatsApp"}</a>}</article>})}</section>
 <section className="plans-tool-access"><div><span className="eyebrow">INCLUDED WITH EVERY PLAN</span><h2>All five tools stay available</h2><p>Every plan includes the Metadata Cleaner, Watermark Maker, GPS Location Remover, Image Privacy Scanner and EXIF Metadata Editor. Daily allowances apply to metadata-cleaning and watermark workflows. The standalone GPS remover, scanner and editor do not currently consume daily image credits.</p></div><a href="/#all-tools">Explore all tools <span>→</span></a></section>
 </>}{accountOnly&&<section className="plans-account"><div><span className="eyebrow">CUSTOMER ACCOUNT</span><h2>{email?"Your CleanExif account":"Create an account before activation"}</h2><p>Create your account first, then message us on WhatsApp using the same email. After payment verification, an admin activates your plan and your limits update automatically.</p><div className="activation-steps"><span><b>01</b> Create your account</span><span><b>02</b> Contact us on WhatsApp</span><span><b>03</b> Admin verifies payment and activates access</span></div>{email&&<p className="plans-account-state">Signed in: {email}</p>}</div>{email?<button className="button button-secondary" onClick={()=>void cleanexifSupabase?.auth.signOut()}><LogOut size={16}/> Sign out</button>:<form onSubmit={submit}><div className="plans-auth-toggle"><button type="button" className={mode==="signup"?"active":""} onClick={()=>setMode("signup")}>Create account</button><button type="button" className={mode==="signin"?"active":""} onClick={()=>setMode("signin")}>Sign in</button></div><button type="button" className="google-auth-button" onClick={()=>void signInWithGoogle()} disabled={busy}><svg viewBox="0 0 48 48" aria-hidden="true"><path fill="#EA4335" d="M24 9.5c3.54 0 6.71 1.22 9.21 3.6l6.85-6.85C35.9 2.38 30.47 0 24 0 14.62 0 6.51 5.38 2.56 13.22l7.98 6.19C12.43 13.72 17.74 9.5 24 9.5z"/><path fill="#4285F4" d="M46.98 24.55c0-1.57-.15-3.09-.38-4.55H24v9.02h12.94c-.58 2.96-2.25 5.48-4.73 7.18l7.28 5.64c4.25-3.92 7.49-9.72 7.49-17.29z"/><path fill="#FBBC05" d="M10.53 28.59A14.4 14.4 0 0 1 9.75 24c0-1.59.27-3.13.76-4.59l-7.98-6.19A23.9 23.9 0 0 0 0 24c0 3.87.93 7.54 2.56 10.78l7.97-6.19z"/><path fill="#34A853" d="M24 48c6.48 0 11.93-2.13 15.9-5.8l-7.28-5.64c-2.02 1.35-4.6 2.15-8.62 2.15-6.26 0-11.57-4.22-13.47-9.91l-7.98 6.19C6.51 43.62 14.62 48 24 48z"/></svg>Continue with Google</button><div className="auth-divider"><span>or continue with email</span></div><label>Email address<input type="email" value={authEmail} onChange={e=>setAuthEmail(e.target.value)} required autoComplete="email"/></label><label>Password<input type="password" minLength={8} value={password} onChange={e=>setPassword(e.target.value)} required autoComplete={mode==="signup"?"new-password":"current-password"}/></label><button className="button button-primary" disabled={busy}><LogIn size={16}/>{busy?"Please wait…":mode==="signup"?"Create account":"Sign in"}</button>{error&&<p className="plans-error">{error}</p>}{mode==="signin"&&<button type="button" className="plans-forgot" onClick={()=>void resetPassword()} disabled={busy}>Forgot password?</button>}{notice&&<p className="plans-notice">{notice}</p>}</form>}</section>}
 {!accountOnly&&<p className="plans-note">Payments are handled manually through WhatsApp at launch. Paid access begins only after payment verification and admin activation. Access expires at the date recorded by the admin.</p>}</main>
 <SiteFooter /></div>;
}

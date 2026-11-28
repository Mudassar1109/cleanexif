import { useEffect } from "react";
import { ArrowRight, BookOpen, CheckCircle2, MessageCircle, ShieldCheck } from "lucide-react";
import { SiteHeader, SiteFooter } from "./SiteChrome";

const inquiryUrl="https://wa.me/923197013743?text="+encodeURIComponent("Hi CleanExif, I would like to request the current sponsorship media kit and available sponsored guide placements.");

const placements=[
 {title:"In-guide sponsorship",slot:"Blog inline",detail:"A clearly labelled sponsor placement inside a relevant educational guide, next to useful context for the reader."},
 {title:"Guide-end sponsorship",slot:"Blog end",detail:"A sponsor message after the article, keeping the editorial explanation separate from the paid placement."},
 {title:"Resource sidebar",slot:"Blog sidebar",detail:"A compact sponsor card alongside an educational article, labelled as sponsored and linked to the approved destination."}
];

export default function AdvertisePage(){
 useEffect(()=>{
  const title="Advertise with CleanExif | Sponsored Guide Partnerships";
  const description="Request CleanExif's current sponsorship media kit and available sponsored placements in relevant image privacy and metadata education guides.";
  document.title=title;
  let meta=document.head.querySelector('meta[name="description"]') as HTMLMetaElement|null;
  if(!meta){meta=document.createElement("meta");meta.name="description";document.head.appendChild(meta);}
  meta.content=description;
  let canonical=document.head.querySelector('link[rel="canonical"]') as HTMLLinkElement|null;
  if(!canonical){canonical=document.createElement("link");canonical.rel="canonical";document.head.appendChild(canonical);}
  canonical.href=window.location.origin+"/advertise";
  let schema=document.getElementById("cleanexif-advertise-jsonld");
  if(!schema){schema=document.createElement("script");schema.id="cleanexif-advertise-jsonld";schema.setAttribute("type","application/ld+json");document.head.appendChild(schema);}
  schema.textContent=JSON.stringify({
   "@context":"https://schema.org",
   "@type":"WebPage",
   name:title,
   description,
   url:window.location.origin+"/advertise",
   isPartOf:{"@type":"WebSite",name:"CleanExif",url:window.location.origin}
  });
 },[]);
 return <div className="advertise-page">
  <SiteHeader/>
  <main className="container advertise-main">
   <a className="privacy-tools-back" href="/">← Back to CleanExif</a>
   <section className="advertise-hero">
    <span className="eyebrow"><ShieldCheck size={15}/> PARTNERSHIPS & SPONSORSHIPS</span>
    <h1>Reach readers who care about <span>image privacy.</span></h1>
    <p>CleanExif offers clearly labelled sponsorship placements within relevant educational content about photo metadata, GPS privacy and safer image sharing.</p>
    <a className="button button-primary" href={inquiryUrl} target="_blank" rel="noopener noreferrer"><MessageCircle size={17}/> Request current media kit <ArrowRight size={15}/></a>
    <small>Availability and verified audience information are shared on request.</small>
   </section>

   <section className="advertise-section">
    <div className="advertise-section-heading"><span className="eyebrow">AVAILABLE FORMATS</span><h2>Sponsored placements</h2><p>Paid placements appear in educational article areas—not disguised as tool controls or download buttons.</p></div>
    <div className="advertise-placement-grid">
     {placements.map((item,index)=><article className="advertise-placement-card" key={item.slot}>
      <span className="advertise-placement-number">0{index+1}</span>
      <span className="advertise-placement-slot">{item.slot}</span>
      <h3>{item.title}</h3>
      <p>{item.detail}</p>
      <span className="advertise-label">SPONSORED</span>
     </article>)}
    </div>
   </section>

   <section className="advertise-process">
    <div><span className="eyebrow">HOW IT WORKS</span><h2>Relevant, reviewed and transparent.</h2><p>Every campaign is checked for relevance, destination quality and clear disclosure before it is scheduled.</p></div>
    <div className="advertise-process-list">
     <div><b>01</b><span><strong>Share your brand</strong><small>Tell us your website, product, intended audience and campaign objective.</small></span></div>
     <div><b>02</b><span><strong>Review and availability</strong><small>We review fit, destination quality, available article placements and campaign dates.</small></span></div>
     <div><b>03</b><span><strong>Approve and schedule</strong><small>Approved content placements are labelled Sponsored and link to the agreed destination.</small></span></div>
    </div>
   </section>

   <section className="advertise-standards">
    <div className="advertise-standard-icon"><CheckCircle2 size={22}/></div>
    <div><h2>Editorial trust comes first</h2><p>Sponsored placements are visibly disclosed. Payment does not buy a product review, a positive recommendation, a search ranking, or guaranteed traffic, clicks, leads or sales. We share audience figures only when current data has been verified.</p></div>
   </section>

   <section className="advertise-cta">
    <BookOpen size={22}/>
    <h2>Planning a campaign?</h2>
    <p>Ask for current availability, placement details and the latest verified media kit.</p>
    <a className="button button-primary" href={inquiryUrl} target="_blank" rel="noopener noreferrer">Contact CleanExif on WhatsApp <ArrowRight size={15}/></a>
   </section>
  </main>
  <SiteFooter/>
 </div>;
}

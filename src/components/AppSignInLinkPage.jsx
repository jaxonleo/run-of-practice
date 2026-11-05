import React, { useState } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import { supabase } from "../supabase.js";

// /app/signin -- the target of the "Sign in to Run of Practice" button in
// sign-in emails the iPhone app requested (the app passes this URL as its
// redirect; the magic_link/confirmation templates only show the button for
// it). On an iPhone with the app installed, iOS opens the app instead of
// this page (Universal Link, public/.well-known/apple-app-site-association)
// and the app finishes sign-in itself.
//
// Anyone who lands here instead -- no app on this device, a desktop mail
// client, or an email security scanner fetching the link -- gets an
// explanation, never an automatic sign-in: the one-time token is only spent
// if a person taps "Sign in on this browser", so a scanner opening the link
// can't use it up before the coach does.
export default function AppSignInLinkPage() {
  const [params] = useSearchParams();
  const navigate = useNavigate();
  const tokenHash = params.get("token_hash");
  const type = params.get("type") || "email";
  const [working, setWorking] = useState(false);
  const [error, setError] = useState("");

  const signInHere = async () => {
    if (!tokenHash || working) return;
    setWorking(true); setError("");
    const { error } = await supabase.auth.verifyOtp({ token_hash: tokenHash, type });
    setWorking(false);
    if (error) { setError("This link has expired or was already used. Use the code from the email instead."); return; }
    navigate("/", { replace: true });
  };

  return (<div style={{minHeight:"100dvh",display:"flex",flexDirection:"column",background:"var(--ink)"}}>
    <div style={{flex:1,display:"flex",flexDirection:"column",alignItems:"center",justifyContent:"center",padding:"40px 24px 24px"}}>
      <div style={{width:80,height:80,borderRadius:18,overflow:"hidden",marginBottom:18,boxShadow:"0 8px 32px rgba(0,0,0,.4)"}}>
        <img src="/apple-touch-icon.png" style={{width:"100%",height:"100%",objectFit:"cover"}} alt="Run of Practice"/>
      </div>
      <div style={{fontFamily:"Barlow Condensed,sans-serif",fontSize:34,fontWeight:900,color:"#fff",lineHeight:1,textAlign:"center"}}>Run of Practice</div>
    </div>
    <div style={{background:"#fff",borderRadius:"24px 24px 0 0",padding:"28px 20px 48px"}}>
      <div style={{fontFamily:"Barlow Condensed,sans-serif",fontSize:24,fontWeight:900,marginBottom:8}}>Open this on your iPhone</div>
      <div style={{fontSize:15,color:"var(--text-muted)",lineHeight:1.55,marginBottom:18}}>
        This sign-in link is for the Run of Practice iPhone app. Tap it in the email on the iPhone where the app is installed and it signs you in there.
        Or enter the code from the same email in the app.
      </div>
      {tokenHash&&<>
        {error&&<div style={{fontSize:13,color:"var(--danger)",marginBottom:10}}>{error}</div>}
        <button className="btn outline bmd bfull" onClick={signInHere} disabled={working}>{working?"Signing in...":"Sign in on this browser instead"}</button>
      </>}
    </div>
  </div>);
}

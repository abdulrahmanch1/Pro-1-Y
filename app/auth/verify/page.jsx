export const metadata = { title: 'Account verified — Subtitle AI' }

export default function VerifyPage() {
  return (
    <section className="section center" style={{minHeight:'60vh'}}>
      <div className="auth-card" style={{maxWidth:'520px'}}>
        <span className="tag tag--success">Email confirmed</span>
        <h2>Your creator space is ready.</h2>
        <p>Sign in to access your AI review queue, wallet, and upcoming Supabase-powered dashboard.</p>
        <div className="flex" style={{justifyContent:'center', marginTop:'1rem'}}>
          <a className="btn btn-primary" href="/auth/sign-in">Go to sign in</a>
          <a className="btn btn-ghost" href="/">Back home</a>
        </div>
      </div>
    </section>
  )
}

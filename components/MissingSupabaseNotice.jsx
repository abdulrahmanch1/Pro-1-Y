export default function MissingSupabaseNotice({ action = 'use this feature' }) {
  return (
    <section className="section">
      <div className="section-header">
        <span className="eyebrow">Configuration required</span>
        <h2>Connect Supabase to {action}.</h2>
        <p>Environment variables are missing. Provide your Supabase project URL and keys to unlock authenticated features.</p>
      </div>
      <div className="card" style={{marginTop:'2rem'}}>
        <span className="tag">Next steps</span>
        <p className="mt-2">
          Copy `.env.example` to `.env.local` and fill in `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY`, and `SUPABASE_SERVICE_ROLE_KEY`.
          Refer to the README for detailed setup instructions.
        </p>
        <pre className="review-line" style={{marginTop:'1.2rem', whiteSpace:'pre-wrap'}}>
NEXT_PUBLIC_SUPABASE_URL=&quot;https://YOUR-PROJECT.supabase.co&quot;
NEXT_PUBLIC_SUPABASE_ANON_KEY=&quot;public-anon-key&quot;
SUPABASE_SERVICE_ROLE_KEY=&quot;service-role-key&quot;
        </pre>
        <p className="mt-2">Restart the dev server after updating the environment to apply changes.</p>
      </div>
    </section>
  )
}

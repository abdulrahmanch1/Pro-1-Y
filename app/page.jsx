export default function HomePage() {
  return (
    <div className="section">
      <section className="hero">
        <div className="hero__content">
          <span className="tag tag--primary">Subtitle control center</span>
          <h1>Give every caption a <span className="gradient-text">studio polish</span>.</h1>
          <p className="hero__meta">Subtitle AI previews every AI correction line-by-line, so you keep creative direction while the assistant cleans grammar, timing, and tone for you.</p>
          <div className="hero__actions">
            <a className="btn btn-primary" href="/upload">Start refining</a>
            <a className="btn btn-ghost" href="/auth/sign-up">Create account</a>
          </div>
          <div className="hero__badges">
            <span className="tag">SRT • VTT • WebVTT</span>
            <span className="tag">AI + Manual control</span>
            <span className="tag tag--success">Export-ready</span>
          </div>
        </div>
        <div className="hero-bento float">
          <article className="hero-card hero-card--accent">
            <div className="hero-card__header">
              <span className="tag tag--success">Readability score</span>
              <span className="hero-metric">98.4%</span>
            </div>
            <p className="hero-note">Average clarity after running through Subtitle AI review flow.</p>
          </article>
          <article className="hero-card hero-card--fix">
            <div className="hero-card__header">
              <span className="tag">Live AI fix</span>
              <span className="badge badge--warn">Original</span>
            </div>
            <div className="hero-card__body">
              <pre className="review-line original">It was beautifull night.</pre>
              <pre className="review-line">It was a beautiful night.</pre>
            </div>
          </article>
          <article className="hero-card hero-card--actions">
            <div className="hero-card__header">
              <span className="tag">Auto accept</span>
            </div>
            <div className="hero-card__body">
              <div className="hero-card__control">
                <div className="review-toggle" data-on="true" aria-hidden />
                <span className="hero-card__label">Accept suggestion</span>
              </div>
              <p className="hero-note">99% queued fixes default to accept. You can flip any line in a tap.</p>
            </div>
          </article>
          <article className="hero-card hero-card--wallet">
            <div className="hero-card__header">
              <span className="tag">Wallet snapshot</span>
            </div>
            <div className="hero-card__body">
              <span className="hero-metric hero-metric--wallet">$24</span>
              <p className="hero-note">Credits ready for exports. Recharge with $5 / $10 / $50 / $100 packs.</p>
            </div>
          </article>
        </div>
      </section>

      <section className="section">
        <div className="section-header">
          <span className="eyebrow">Workflow</span>
          <h2>Keep momentum with a guided, creator-first flow.</h2>
          <p>Subtitle AI gives you granular oversight without the tedious rewrites. Glide through each step with cinematic feedback and inline editing.</p>
        </div>
        <div className="flow-list">
          <div className="flow-step flow-step--animated" data-step="01">
            <h3>Drop in your files</h3>
            <p>Upload SRT or VTT, we auto-detect encoding, merge tracks, and prep segments for AI review.</p>
          </div>
          <div className="flow-step flow-step--animated" data-step="02">
            <h3>AI pre-check</h3>
            <p>GPT analyzes grammar, phrasing, tone, and timing mismatches to propose better matches for your voice.</p>
          </div>
          <div className="flow-step flow-step--animated" data-step="03">
            <h3>Swipe through suggestions</h3>
            <p>Accept by default, flip to keep original, or edit inline — all inside a minimalist timeline panel.</p>
          </div>
          <div className="flow-step flow-step--animated" data-step="04">
            <h3>Download & publish</h3>
            <p>Export clean SRT/VTT instantly, charge $1 per export from your wallet, and upload to YouTube or Shorts.</p>
          </div>
        </div>
      </section>

      <section className="section">
        <div className="section-header">
          <span className="eyebrow">For creators</span>
          <h2>Future-ready subtitling built for YouTubers and storytellers.</h2>
        </div>
        <div className="grid grid-auto" style={{marginTop:'1.6rem'}}>
          <article className="card card-feature">
            <span className="tag">Neon clarity</span>
            <h3>Lightning-fast readability checks</h3>
            <p className="mt-2">Our AI scores each caption against clarity best practices so you publish with confidence.</p>
          </article>
          <article className="card card-feature">
            <span className="tag">Creative control</span>
            <h3>Edit inline, instantly</h3>
            <p className="mt-2">Type directly inside the AI proposal, keep your tone intact, and preview changes as you go.</p>
          </article>
          <article className="card card-feature">
            <span className="tag">Wallet aware</span>
            <h3>Wallet that respects your scale</h3>
            <p className="mt-2">Top up once and track every $1 export. Designed for high-volume production schedules.</p>
          </article>
          <article className="card card-feature">
            <span className="tag">Collab ready</span>
            <h3>Share review states</h3>
            <p className="mt-2">Tomorrow we’ll add Supabase sync so editors, producers, and freelancers stay aligned.</p>
          </article>
        </div>
      </section>

      <section className="section panel">
        <div className="section-header">
          <span className="eyebrow">What you see</span>
          <h2>Preview the review cockpit.</h2>
          <p>Experience the sleek control room tomorrow with live data. Today’s design shows the final look and feel.</p>
        </div>
        <div className="grid grid-2" style={{marginTop:'1.8rem'}}>
          <div className="card">
            <span className="tag">Timeline excerpt</span>
            <pre className="review-line original">00:00:01,000 → 00:00:03,000 | It was beautifull night.</pre>
            <pre className="review-line">00:00:01,000 → 00:00:03,000 | It was a beautiful night.</pre>
            <pre className="review-line">00:00:03,200 → 00:00:05,500 | I can’t believe it worked.</pre>
          </div>
          <div className="card">
            <span className="tag">Wallet & status</span>
            <p className="wallet-balance">$24 balance</p>
            <div className="wallet-quick" style={{marginTop:'1rem'}}>
              {[5,10,50,100].map(v => (
                <div key={v} className="wallet-chip">+ ${v}</div>
              ))}
            </div>
            <p className="mt-3">Download caption outputs for $1 each. Recharge in one tap.</p>
          </div>
        </div>
      </section>
    </div>
  )
}

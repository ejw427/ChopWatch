const FEATURES = [
  {
    title: "Live Chopping status",
    body: "Finding / Downloading / Initializing / Running from Bowl lifecycle logs — without opening customer containers.",
  },
  {
    title: "Hardware pulse",
    body: "GPU util, VRAM, temp, and power via nvidia-smi, plus host CPU and RAM.",
  },
  {
    title: "Wallet + official API",
    body: "Bowl Wallet lines for quick balance/prediction, with optional Salad web API for official balance and 30-day history.",
  },
  {
    title: "Chopping hours",
    body: "Log-estimated hours chart and rough Star Chef progress from state samples.",
  },
  {
    title: "Phase alerts",
    body: "Windows toast and browser notifications when Chopping phase changes.",
  },
  {
    title: "Read-only by design",
    body: "No WSL shelling into jobs, no token.txt scraping, no customer workload inspection.",
  },
];

export default function AboutTab({ snap }) {
  return (
    <div className="about">
      <section className="about-hero">
        <img
          className="about-mark"
          src="/chopwatch-mark.jpg"
          alt="ChopWatch mark"
          width={160}
          height={160}
        />
        <div className="about-copy">
          <p className="phase-kicker">About</p>
          <h2 className="about-title">ChopWatch</h2>
          <p className="about-lead">
            A local, read-only cockpit for Salad Chopping — built so you can see
            what your machine is doing without crossing into customer workloads.
          </p>
          <p className="about-by">
            Created by <strong>Eric Welch</strong>
          </p>
          <div className="meta">
            <span>v{snap?.product?.version || "0.3"}</span>
            <span>mode {snap?.product?.mode || "read-only"}</span>
            <span>unofficial · unaffiliated with Salad Technologies</span>
          </div>
        </div>
      </section>

      <section className="panel wide about-features">
        <h2>Features</h2>
        <div className="feature-grid">
          {FEATURES.map((f) => (
            <article key={f.title} className="feature-card">
              <h3>{f.title}</h3>
              <p>{f.body}</p>
            </article>
          ))}
        </div>
      </section>

      <section className="panel wide">
        <h2>Privacy stance</h2>
        <p className="hint" style={{ margin: 0 }}>
          ChopWatch stays on this PC. Optional Salad <span className="mono">auth</span>{" "}
          cookies never leave your machine except when calling{" "}
          <span className="mono">app-api.salad.com</span> for your own account
          data. Customer container images, payloads, and secrets are out of scope
          on purpose.
        </p>
      </section>
    </div>
  );
}

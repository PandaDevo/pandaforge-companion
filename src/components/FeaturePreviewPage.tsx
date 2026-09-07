import "./FeaturePreviewPage.css";

type FeaturePreviewPageProps = {
  feature: string;
  onNavigate: (destination: string) => void;
};

const descriptions: Record<string, {
  kicker: string;
  title: string;
  description: string;
}> = {
  News: {
    kicker: "PERSONALISED GAMING INTELLIGENCE",
    title: "Gaming News",
    description:
      "PandaVault News will combine PC gaming coverage, updates about games you own and optional PlayStation, Xbox and Nintendo news.",
  },
  "Game Health": {
    kicker: "YOUR GAMES. READY.",
    title: "Game Health",
    description:
      "Game Health is being expanded into PandaVault's readiness centre for updates, mods, saves, storage and game health.",
  },
  Mods: {
    kicker: "CONTROL YOUR SETUP",
    title: "Mods",
    description:
      "A dedicated place for installed mods, updates and future conflict or dependency checks.",
  },
  Deals: {
    kicker: "SPEND SMARTER",
    title: "Deals",
    description:
      "Deals will focus on games and wishlists you care about rather than filling PandaVault with generic advertising.",
  },
};

export default function FeaturePreviewPage({
  feature,
  onNavigate,
}: FeaturePreviewPageProps) {
  const content =
    descriptions[feature] ?? {
      kicker: "PANDAVAULT",
      title: feature,
      description:
        "This PandaVault feature is currently being developed.",
    };

  return (
    <section className="pv-feature-preview">
      <div className="pv-feature-preview-glow" />

      <span>{content.kicker}</span>

      <h2>{content.title}</h2>

      <p>{content.description}</p>

      {feature === "News" ? (
        <div className="pv-feature-preview-platforms">
          <strong>PC</strong>
          <strong>PLAYSTATION</strong>
          <strong>XBOX</strong>
          <strong>NINTENDO</strong>
        </div>
      ) : null}

      <div className="pv-feature-preview-status">
        <small>PANDAVAULT ALPHA</small>
        <strong>IN DEVELOPMENT</strong>
      </div>

      <button
        type="button"
        onClick={() => onNavigate("Home")}
      >
        {"\u2190"} BACK TO HOME
      </button>
    </section>
  );
}
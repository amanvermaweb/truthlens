import { ClaimPayload } from "@/lib/types";
import { verdictTone } from "./dashboard-utils";

type ClaimSidebarProps = {
  claimData: ClaimPayload;
};

export function ClaimSidebar({ claimData }: ClaimSidebarProps) {
  const dimensions = claimData.dimensions;
  const biasProfile = claimData.biasProfile;

  return (
    <aside className="glass-panel p-5">
      <p className="label-sm text-muted">Extracted Claim</p>
      <p className="headline-md mt-3 leading-tight text-high">{claimData.claim}</p>

      <div className="mt-5 flex flex-wrap gap-2">
        {(claimData.tags ?? ["General"]).map((tag) => (
          <span key={tag} className="rounded-full bg-(--surface-container-high) px-3 py-1 text-xs text-high">
            {tag}
          </span>
        ))}
      </div>

      <div className={`mt-6 rounded-2xl px-4 py-3 text-sm font-medium ${verdictTone(claimData.verdict)}`}>
        {claimData.verdict}
      </div>

      <div className="mt-6 rounded-2xl bg-(--surface-container-lowest) p-4">
        <div className="mx-auto grid h-28 w-28 place-items-center rounded-full bg-(--surface-container-low) ring-4 ring-(--accent)/35">
          <span className="headline-md text-high">{claimData.confidence}%</span>
        </div>
        <p className="label-sm mt-3 text-center text-muted">Confidence</p>
      </div>

      <div className="insight-panel mt-6 p-4 text-sm leading-6 text-muted">{claimData.analysisSummary}</div>

      {dimensions ? (
        <div className="mt-6 rounded-2xl bg-(--surface-container-lowest) p-4">
          <p className="label-sm text-muted">Analysis Dimensions</p>
          <div className="mt-3 space-y-2 text-sm text-high">
            <p>Factual Accuracy: {dimensions.factualAccuracy}%</p>
            <p>Source Agreement: {dimensions.sourceAgreement}%</p>
            <p>Recency Score: {dimensions.recencyScore}%</p>
            <p>Bias Risk: {dimensions.biasRisk}</p>
          </div>
        </div>
      ) : null}

      {biasProfile ? (
        <div className="mt-4 rounded-2xl bg-(--surface-container-lowest) p-4 text-sm">
          <p className="label-sm text-muted">Bias Detection</p>
          <p className="mt-2 text-high">Political: {biasProfile.politicalBias}</p>
          <p className="mt-1 text-high">Emotional Language: {biasProfile.emotionalLanguage}</p>
          <p className="mt-1 text-high">Manipulation Risk: {biasProfile.manipulationRisk}</p>
        </div>
      ) : null}
    </aside>
  );
}

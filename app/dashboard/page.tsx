"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { computeDashboardMetrics, type AuditDerivedMetrics } from "@/lib/metrics/dashboard";
import { RuleFireChart } from "@/app/_components/RuleFireChart";
import { LoadingState } from "@/app/_components/LoadingState";
import diagnosisAccuracy from "@/docs/metrics/diagnosis_accuracy.json";
import type { BatchCaseResult } from "@/lib/batch/run-batch";

type BatchResponse =
  | { hasRun: false }
  | { hasRun: true; createdAt: string; cases: BatchCaseResult[]; auditMetrics: AuditDerivedMetrics };

function inr(n: number): string {
  return `Rs ${n.toLocaleString("en-IN", { maximumFractionDigits: 0 })}`;
}

export default function DashboardPage() {
  const [data, setData] = useState<BatchResponse | null>(null);

  useEffect(() => {
    fetch("/api/batch", { cache: "no-store" })
      .then((r) => r.json())
      .then(setData);
  }, []);

  if (!data) return <LoadingState label="Loading the latest batch run…" />;

  if (!data.hasRun) {
    return (
      <div className="mx-auto max-w-3xl px-6 py-16 text-center">
        <h1 className="text-2xl font-extrabold">No batch run yet</h1>
        <p className="mt-2 text-navy-muted">Run the batch from the home page first — every number here is computed live from that run.</p>
        <Link href="/" className="mt-6 inline-block rounded-md bg-brass-gold px-5 py-2.5 font-semibold text-ink-navy-deep">
          Go to batch view
        </Link>
      </div>
    );
  }

  const metrics = computeDashboardMetrics(data.cases);
  const auditMetrics = data.auditMetrics;

  return (
    <div className="mx-auto max-w-6xl px-6 py-10">
      <h1 className="text-3xl font-extrabold tracking-tight">Dashboard</h1>
      <p className="mt-1 text-sm text-navy-muted">
        Computed live from the {data.cases.length}-case batch run at {new Date(data.createdAt).toLocaleString("en-IN")}.
      </p>

      <section className="mt-8 grid grid-cols-1 gap-4 sm:grid-cols-3">
        <MetricCard label="Total revenue at risk" value={inr(metrics.totalRevenueAtRiskInr)} />
        <MetricCard label="Gross recovered" value={inr(metrics.grossRecoveredInr)} />
        <MetricCard label="Net recovered yield" value={inr(metrics.netRecoveredYieldInr)} gold />
      </section>
      <p className="mt-2 text-xs text-navy-muted">
        Gross/net figures are a <strong>modeled outcome on synthetic data</strong> — each executed action is rolled against a
        documented, fixed success probability (see lib/metrics/resolution-simulation.ts), not a real payment result.
      </p>

      <section className="mt-6 grid grid-cols-2 gap-4 sm:grid-cols-4">
        <MetricCard label="Recovery rate" value={`${metrics.recoveryRatePercent}%`} small />
        <MetricCard label="Discounts issued" value={inr(metrics.totalDiscountsIssuedInr)} small />
        <MetricCard label="Action cost" value={inr(metrics.totalActionCostInr)} small />
        <MetricCard label="False-positive cost" value={inr(metrics.falsePositiveCostInr)} small sub={`${metrics.falsePositiveCount} cases`} />
      </section>

      <section className="mt-6 grid grid-cols-2 gap-4 sm:grid-cols-4">
        <MetricCard label="Circuit breaker trips" value={String(auditMetrics.circuitBreakerTripCount)} small />
        <MetricCard label="Paused by breaker" value={String(metrics.circuitBreakerPausedCount)} small />
        <MetricCard label="Human review queue" value={String(metrics.humanReviewQueueCount)} small />
        <MetricCard label="Needs human review" value={String(metrics.needsHumanReviewCount)} small />
      </section>

      <section className="mt-6">
        <MetricCard
          label="Promise-to-pay fulfillment rate"
          value={`${auditMetrics.promiseFulfillmentRatePercent}%`}
          sub={`${auditMetrics.promiseFulfilledCount} fulfilled / ${auditMetrics.promiseBrokenCount} broken`}
        />
      </section>

      <section className="mt-10">
        <h2 className="text-lg font-bold">Compliance rule fire counts</h2>
        <p className="text-sm text-navy-muted">How often each rule actually blocked or rescheduled an action — shown as a working safeguard, not hidden as a limitation.</p>
        <div className="ledger-card mt-4 rounded-md p-4">
          <RuleFireChart counts={metrics.complianceRuleFireCounts} />
        </div>
      </section>

      <section className="mt-10">
        <h2 className="text-lg font-bold">Diagnosis accuracy</h2>
        <p className="text-sm text-navy-muted">
          Overall {Math.round(diagnosisAccuracy.overall_accuracy * 100)}% on {diagnosisAccuracy.total_records_diagnosed} diagnosed
          records ({diagnosisAccuracy.seed_version}). {diagnosisAccuracy.ai_fallback.note ?? ""}
        </p>
        <div className="ledger-card mt-4 overflow-x-auto rounded-md">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-ledger-line text-left text-xs uppercase tracking-wide text-paper-muted">
                <th className="px-4 py-2">Category</th>
                <th className="px-4 py-2">Precision</th>
                <th className="px-4 py-2">Recall</th>
                <th className="px-4 py-2">Support</th>
              </tr>
            </thead>
            <tbody>
              {Object.entries(diagnosisAccuracy.per_category).map(([label, stats]) => (
                <tr key={label} className="border-b border-ledger-line last:border-0">
                  <td className="ledger-numerals px-4 py-2">{label}</td>
                  <td className="ledger-numerals px-4 py-2">{stats.precision !== null ? `${Math.round(stats.precision * 100)}%` : "—"}</td>
                  <td className="ledger-numerals px-4 py-2">{stats.recall !== null ? `${Math.round(stats.recall * 100)}%` : "—"}</td>
                  <td className="ledger-numerals px-4 py-2">{stats.support}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      <section className="mt-10">
        <Link href="/counterfactual" className="text-sm text-brass-gold hover:underline">
          See what a naive agent with no compliance gate would have done on the same batch →
        </Link>
      </section>
    </div>
  );
}

function MetricCard({ label, value, sub, gold, small }: { label: string; value: string; sub?: string; gold?: boolean; small?: boolean }) {
  return (
    <div className="ledger-card rounded-md p-4">
      <div className="text-xs uppercase tracking-wide text-paper-muted">{label}</div>
      <div className={`ledger-numerals font-bold ${small ? "text-xl" : "text-3xl"} ${gold ? "text-brass-gold" : ""}`}>{value}</div>
      {sub && <div className="mt-1 text-xs text-paper-muted">{sub}</div>}
    </div>
  );
}

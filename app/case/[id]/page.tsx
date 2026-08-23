"use client";

import { use, useEffect, useState } from "react";
import Link from "next/link";
import { deriveCaseStatus, isStampCleared } from "@/lib/ui/case-status";
import { StampBadge } from "@/app/_components/StampBadge";
import { VoicePlayback } from "@/app/_components/VoicePlayback";
import { formatIST } from "@/lib/time/ist";
import { findSeedRecord } from "@/lib/ui/find-seed-record";
import type { BatchCaseResult } from "@/lib/batch/run-batch";
import type { AuditRow } from "@/lib/audit/log";

const LAYER_LABELS: Record<string, string> = {
  circuit_breaker: "Circuit breaker",
  diagnosis: "Diagnosis",
  decision: "Decision",
  compliance: "Compliance gate",
  promise_tracker: "Promise tracker",
  execution: "Execution",
  claude: "Claude API",
};

function titleCase(s: string): string {
  return s.replace(/_/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());
}

export default function CaseDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const [caseResult, setCaseResult] = useState<BatchCaseResult | null | undefined>(undefined);
  const [rows, setRows] = useState<AuditRow[]>([]);

  useEffect(() => {
    fetch(`/api/case/${id}`, { cache: "no-store" })
      .then((r) => r.json())
      .then((json) => {
        setCaseResult(json.caseResult);
        setRows(json.auditRows ?? []);
      });
  }, [id]);

  const seedLookup = findSeedRecord(id);

  if (!seedLookup) {
    return (
      <div className="mx-auto max-w-3xl px-6 py-16 text-center">
        <h1 className="text-2xl font-extrabold">Case not found</h1>
        <Link href="/" className="mt-4 inline-block text-brass-gold hover:underline">
          ← Back to batch
        </Link>
      </div>
    );
  }

  const displayName = seedLookup.recordType === "b2b_receivable" ? seedLookup.record.business_name : seedLookup.record.customer_name;
  const language = seedLookup.record.preferred_language;
  const status = caseResult ? deriveCaseStatus(caseResult) : null;

  return (
    <div className="mx-auto max-w-4xl px-6 py-10">
      <Link href="/" className="text-sm text-navy-muted hover:text-navy-text">
        ← Back to batch
      </Link>

      <div className="mt-4 flex flex-wrap items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-extrabold tracking-tight">{displayName}</h1>
          <p className="ledger-numerals mt-1 text-sm text-navy-muted">{id}</p>
        </div>
        {status && <StampBadge cleared={isStampCleared(status)} label={status.replace("_", " ")} animate />}
      </div>

      {caseResult && (
        <div className="mt-4 ledger-card rounded-md p-4">
          <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
            <Field label="Root cause" value={caseResult.rootCause} />
            <Field label="Diagnosis confidence" value={`${Math.round(caseResult.diagnosisConfidence * 100)}%`} />
            <Field label="Diagnosis source" value={titleCase(caseResult.diagnosisSource)} />
            <Field label="Needs human review" value={caseResult.needsHumanReview ? "Yes" : "No"} />
          </div>
        </div>
      )}

      {caseResult && caseResult.actions.some((a) => a.execution?.message) && (
        <section className="mt-8">
          <h2 className="text-lg font-bold">Messages</h2>
          <div className="mt-3 flex flex-col gap-3">
            {caseResult.actions
              .filter((a) => a.execution?.message)
              .map((a, i) => (
                <div key={i} className="max-w-lg ledger-card rounded-2xl rounded-tl-sm px-4 py-3">
                  <p className="text-sm whitespace-pre-wrap">{a.execution!.message!.text}</p>
                  <div className="mt-2 flex items-center justify-between text-xs text-paper-muted">
                    <span>
                      via {a.proposedAction.contactTarget?.channel ?? "internal"} · {titleCase(a.execution!.message!.source)}
                    </span>
                    {!a.execution!.message!.toneCheckAllowed && <span className="text-stamp-rust">blocked — tone check</span>}
                  </div>
                </div>
              ))}
          </div>
          <VoicePlayback
            caseId={id}
            messageText={caseResult.actions.find((a) => a.execution?.message)?.execution?.message?.text}
            language={language}
          />
        </section>
      )}

      <section className="mt-8">
        <h2 className="text-lg font-bold">Audit trail</h2>
        <p className="text-sm text-navy-muted">Every layer&apos;s decision on this case, in order — readable with zero code knowledge.</p>
        <ol className="mt-4 flex flex-col gap-3 border-l-2 border-border-soft pl-5">
          {rows.length === 0 && <li className="text-sm text-navy-muted">No audit events yet — run the batch from the home page.</li>}
          {rows.map((row) => (
            <li key={row.id} className="relative">
              <span className="absolute -left-[27px] top-1.5 h-2.5 w-2.5 rounded-full bg-brass-gold" />
              <div className="ledger-card rounded-md px-4 py-3">
                <div className="flex flex-wrap items-center justify-between gap-2 text-xs text-paper-muted">
                  <span className="font-semibold uppercase tracking-wide">{LAYER_LABELS[row.layer] ?? row.layer}</span>
                  <span className="ledger-numerals">{formatIST(new Date(row.timestamp))}</span>
                </div>
                <p className="mt-1 text-sm">{row.reasoning_text ?? titleCase(row.event_type)}</p>
              </div>
            </li>
          ))}
        </ol>
      </section>
    </div>
  );
}

function Field({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <div className="text-xs uppercase tracking-wide text-paper-muted">{label}</div>
      <div className="ledger-numerals font-medium">{value}</div>
    </div>
  );
}

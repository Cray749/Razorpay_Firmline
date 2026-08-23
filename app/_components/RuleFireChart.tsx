"use client";

import { BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer, CartesianGrid, Cell } from "recharts";

const RULE_LABELS: Record<string, string> = {
  "opt-out": "R4 Opt-out",
  "dispute-freeze": "R13 Dispute freeze",
  "contact-window": "R1 Contact window",
  "frequency-cap": "R2 Frequency cap",
  "cooling-off": "R3 Cooling-off",
  "verified-contact": "R5 Verified contact",
  "pre-debit-notice": "R6 Pre-debit notice",
  "one-charge-per-day": "R7 One charge/day",
  "npci-window": "R8 NPCI window",
  "discount-fairness": "R10 Discount fairness",
  "stop-loss": "R11 Stop-loss",
  "bounce-suppression": "R12 Bounce suppression",
};

export function RuleFireChart({ counts }: { counts: Record<string, number> }) {
  const data = Object.entries(RULE_LABELS).map(([key, label]) => ({ label, count: counts[key] ?? 0 }));

  return (
    <ResponsiveContainer width="100%" height={320}>
      <BarChart data={data} layout="vertical" margin={{ left: 24, right: 24 }}>
        <CartesianGrid strokeDasharray="3 3" stroke="var(--border-soft)" horizontal={false} />
        <XAxis type="number" stroke="var(--navy-muted)" fontSize={12} />
        <YAxis type="category" dataKey="label" stroke="var(--navy-muted)" fontSize={12} width={140} />
        <Tooltip
          contentStyle={{ background: "var(--ledger-paper)", border: "1px solid var(--ledger-line)", color: "var(--ink-text)", borderRadius: 6 }}
        />
        <Bar dataKey="count" radius={[0, 4, 4, 0]}>
          {data.map((entry, i) => (
            <Cell key={i} fill={entry.count > 0 ? "var(--stamp-rust)" : "var(--border-soft)"} />
          ))}
        </Bar>
      </BarChart>
    </ResponsiveContainer>
  );
}

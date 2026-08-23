// app/api/case/[id]/route.ts — one case's full result plus its audit trail.
import { NextResponse } from "next/server";
import { getCaseResult } from "@/lib/db/case-results";
import { queryAuditLogForCase } from "@/lib/audit/log";

export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const [caseResult, auditRows] = await Promise.all([getCaseResult(id), queryAuditLogForCase(id)]);
  return NextResponse.json({ caseResult, auditRows });
}

import {
  BLOCKER_CODES,
  LATE_CODES,
  PENDING_CODE,
  SENTINEL_DATE,
  type AnalyticsFlags,
  type UtilityResponse,
} from '../types';

export function isLateCode(code: string | null | undefined): boolean {
  return !!code && LATE_CODES.has(code);
}

export function scanHadLateResponse(codes: (string | null | undefined)[]): boolean {
  return codes.some((c) => isLateCode(c));
}

export function deriveDigAlertCurrentResponses(
  rows: {
    utility_code: string;
    utility_name: string | null;
    response_code: string | null;
    response_description: string | null;
    responded_at: string | null;
    comments: string | null;
  }[]
): UtilityResponse[] {
  const byCode = new Map<string, (typeof rows)[0]>();
  for (const row of rows) {
    if (!row.responded_at || row.responded_at < SENTINEL_DATE) continue;
    const prev = byCode.get(row.utility_code);
    if (!prev || row.responded_at > (prev.responded_at ?? '')) {
      byCode.set(row.utility_code, row);
    }
  }
  return [...byCode.values()].map((r) => ({
    code: r.utility_code,
    name: r.utility_name ?? undefined,
    responseCode: r.response_code ?? '',
    responseDescription: r.response_description ?? undefined,
    responseDate: r.responded_at ?? undefined,
    comment: r.comments ?? undefined,
  }));
}

export function computeAnalytics(
  current: UtilityResponse[],
  hadLateResponseStored: boolean,
  allHistoryCodes: (string | null | undefined)[]
): AnalyticsFlags {
  const pendingUtilities = current
    .filter((u) => u.responseCode === PENDING_CODE)
    .map((u) => ({ code: u.code, name: u.name, responseCode: u.responseCode }));
  const blockerUtilities = current
    .filter((u) => BLOCKER_CODES.has(u.responseCode))
    .map((u) => ({ code: u.code, name: u.name, responseCode: u.responseCode }));

  return {
    isPending: pendingUtilities.length > 0,
    hasBlockers: blockerUtilities.length > 0,
    hadLateResponse: hadLateResponseStored || scanHadLateResponse(allHistoryCodes),
    pendingUtilities,
    blockerUtilities,
  };
}

export function listBadges(analytics: AnalyticsFlags) {
  return {
    isPending: analytics.isPending,
    hasBlockers: analytics.hasBlockers,
    hadLateResponse: analytics.hadLateResponse,
  };
}

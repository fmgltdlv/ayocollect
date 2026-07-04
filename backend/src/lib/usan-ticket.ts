/** USAN ticket numbers are `{base}-{revisionSuffix}` e.g. `2025102400123-001`. */

export function usanTicketBase(ticketNumber: string): string {
  const i = ticketNumber.indexOf('-');
  return i >= 0 ? ticketNumber.slice(0, i) : ticketNumber;
}

export function usanRevisionSuffix(requestNumber: string | null | undefined): string | null {
  if (!requestNumber) return null;
  const i = requestNumber.lastIndexOf('-');
  return i >= 0 ? requestNumber.slice(i + 1) : requestNumber;
}

export function usanRequestNumber(ticketNumber: string, revisionSuffix: string | null | undefined): string | null {
  if (!revisionSuffix) return null;
  return `${usanTicketBase(ticketNumber)}-${revisionSuffix}`;
}

export function enrichUsanHistoryRow(
  ticketNumber: string,
  row: Record<string, unknown>
): Record<string, unknown> {
  const suffix = row.revision_suffix as string | null | undefined;
  const requestNumber = usanRequestNumber(ticketNumber, suffix);
  return {
    ...row,
    request_number: requestNumber,
    requestNumber,
  };
}

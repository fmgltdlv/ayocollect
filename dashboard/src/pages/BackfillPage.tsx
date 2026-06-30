import { useState } from 'react';
import {
  BACKFILL_REGIONS,
  fetchBackfillQueueStatus,
  fetchBackfillRuns,
  startBackfill,
  type BackfillQueueStatus,
  type BackfillRegion,
  type BackfillRun,
} from '../api';

const REGION_LABELS: Record<string, string> = Object.fromEntries(
  BACKFILL_REGIONS.map((r) => [r.id, r.label]),
);

const REGION_TICKET_FORMAT: Record<BackfillRegion, string> = {
  NV: 'YYYYMMDD + 5-digit seq (e.g. 2025062900001)',
  CA: 'YYYYMMDD + 5-digit seq (e.g. 2025062900001)',
  DA: 'AYYJDD0XXX Julian day + counter (e.g. A252180042)',
};

function formatSnapshotTime(iso: string): string {
  try {
    return new Date(iso).toLocaleString();
  } catch {
    return iso;
  }
}

export default function BackfillPage() {
  const [startDate, setStartDate] = useState('');
  const [endDate, setEndDate] = useState('');
  const [selectedRegions, setSelectedRegions] = useState<BackfillRegion[]>(['NV']);
  const [runs, setRuns] = useState<BackfillRun[]>([]);
  const [loading, setLoading] = useState(false);
  const [statusLoading, setStatusLoading] = useState(false);
  const [error, setError] = useState('');
  const [message, setMessage] = useState('');
  const [queueSnapshot, setQueueSnapshot] = useState<BackfillQueueStatus | null>(null);

  const loadRuns = () => {
    fetchBackfillRuns()
      .then((data) => setRuns(data.runs))
      .catch((err) => setError(err.message));
  };

  const toggleRegion = (region: BackfillRegion) => {
    setSelectedRegions((prev) =>
      prev.includes(region) ? prev.filter((r) => r !== region) : [...prev, region],
    );
  };

  const handleCheckStatus = async () => {
    setStatusLoading(true);
    setError('');
    try {
      const snapshot = await fetchBackfillQueueStatus();
      setQueueSnapshot(snapshot);
      loadRuns();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to fetch queue status');
    } finally {
      setStatusLoading(false);
    }
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (selectedRegions.length === 0) {
      setError('Select at least one system to backfill.');
      return;
    }

    setLoading(true);
    setError('');
    setMessage('');
    try {
      const result = await startBackfill({ startDate, endDate, regions: selectedRegions });
      const systems = selectedRegions.map((r) => REGION_LABELS[r] ?? r).join(', ');
      setMessage(`Queued ${result.queuedDates.length} run(s) for ${systems}`);
      loadRuns();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed');
    } finally {
      setLoading(false);
    }
  };

  const retry = async (date: string, region: BackfillRegion) => {
    setLoading(true);
    setError('');
    try {
      await startBackfill({ dates: [date], regions: [region] });
      loadRuns();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed');
    } finally {
      setLoading(false);
    }
  };

  const hasActiveWork =
    queueSnapshot?.active ||
    runs.some((run) => run.status === 'running' || run.status === 'queued');

  return (
    <>
      <div className="card">
        <h2>Historical backfill</h2>
        <p>
          Enter calendar dates (YYYYMMDD). Runs are processed one date and system at a time,
          fetching up to 6 tickets in parallel per system.
        </p>
        <form onSubmit={handleSubmit}>
          <fieldset className="region-picker">
            <legend>Systems</legend>
            <div className="region-options">
              {BACKFILL_REGIONS.map(({ id, label }) => (
                <label key={id} className="region-option">
                  <input
                    type="checkbox"
                    checked={selectedRegions.includes(id)}
                    onChange={() => toggleRegion(id)}
                  />
                  <span>{label}</span>
                  <code>{id}</code>
                </label>
              ))}
            </div>
            {selectedRegions.length > 0 ? (
              <ul className="region-formats">
                {selectedRegions.map((id) => (
                  <li key={id}>
                    <strong>{REGION_LABELS[id]}:</strong> {REGION_TICKET_FORMAT[id]}
                  </li>
                ))}
              </ul>
            ) : null}
          </fieldset>
          <div className="form-row">
            <label>
              Start date
              <input
                value={startDate}
                onChange={(e) => setStartDate(e.target.value)}
                placeholder="20260301"
                pattern="\d{8}"
                required
              />
            </label>
            <label>
              End date
              <input
                value={endDate}
                onChange={(e) => setEndDate(e.target.value)}
                placeholder="20260331"
                pattern="\d{8}"
                required
              />
            </label>
            <button type="submit" disabled={loading || selectedRegions.length === 0}>
              {loading ? 'Starting…' : 'Start backfill'}
            </button>
            <button
              type="button"
              className="secondary"
              disabled={statusLoading}
              onClick={handleCheckStatus}
            >
              {statusLoading ? 'Checking…' : 'Check queue status'}
            </button>
          </div>
        </form>
        {error ? <p className="error">{error}</p> : null}
        {message ? <p>{message}</p> : null}
      </div>

      {queueSnapshot ? (
        <div className="card queue-status">
          <div className="queue-status-header">
            <h3>Queue snapshot</h3>
            <p className="muted">Captured {formatSnapshotTime(queueSnapshot.capturedAt)}</p>
          </div>

          <div className="queue-counts">
            <span><strong>{queueSnapshot.counts.running}</strong> running</span>
            <span><strong>{queueSnapshot.counts.queued}</strong> queued</span>
            <span><strong>{queueSnapshot.counts.completed}</strong> completed</span>
            <span><strong>{queueSnapshot.counts.failed}</strong> failed</span>
          </div>

          {queueSnapshot.currentlyRunning ? (
            <div className="queue-section">
              <h4>Currently processing</h4>
              <p>
                {queueSnapshot.currentlyRunning.target_date} ·{' '}
                {REGION_LABELS[queueSnapshot.currentlyRunning.region] ??
                  queueSnapshot.currentlyRunning.region}
                {queueSnapshot.currentlyRunning.started_at
                  ? ` · started ${formatSnapshotTime(queueSnapshot.currentlyRunning.started_at)}`
                  : ''}
              </p>
            </div>
          ) : queueSnapshot.active ? null : (
            <p className="muted">No backfill jobs are running or queued.</p>
          )}

          {queueSnapshot.queued.length > 0 ? (
            <div className="queue-section">
              <h4>Up next</h4>
              <ol className="queue-list">
                {queueSnapshot.queued.map((item) => (
                  <li key={item.id}>
                    #{item.queuePosition} — {item.target_date} ·{' '}
                    {REGION_LABELS[item.region] ?? item.region}
                  </li>
                ))}
              </ol>
              {queueSnapshot.counts.queued > queueSnapshot.queued.length ? (
                <p className="muted">
                  Showing first {queueSnapshot.queued.length} of {queueSnapshot.counts.queued}{' '}
                  queued runs.
                </p>
              ) : null}
            </div>
          ) : null}
        </div>
      ) : hasActiveWork ? (
        <div className="card queue-status-hint">
          <p className="muted">
            Backfill work may be in progress. Click <strong>Check queue status</strong> for a
            snapshot of where the queue is right now.
          </p>
        </div>
      ) : null}

      <div className="card">
        <div className="table-header">
          <h3>Backfill runs</h3>
          <button type="button" className="secondary" onClick={loadRuns}>
            Refresh list
          </button>
        </div>
        <table>
          <thead>
            <tr>
              <th>Date</th>
              <th>System</th>
              <th>Status</th>
              <th>Synced</th>
              <th>Failed</th>
              <th>Error</th>
              <th></th>
            </tr>
          </thead>
          <tbody>
            {runs.length === 0 ? (
              <tr>
                <td colSpan={7} className="muted">
                  No runs yet. Start a backfill or refresh the list.
                </td>
              </tr>
            ) : (
              runs.map((run) => (
                <tr key={run.id}>
                  <td>{run.target_date}</td>
                  <td>{REGION_LABELS[run.region] ?? run.region}</td>
                  <td><span className={`badge ${run.status}`}>{run.status}</span></td>
                  <td>{run.tickets_synced}</td>
                  <td>{run.tickets_failed}</td>
                  <td>{run.error ?? '—'}</td>
                  <td>
                    {run.status === 'failed' ? (
                      <button
                        type="button"
                        className="secondary"
                        onClick={() => retry(run.target_date, run.region as BackfillRegion)}
                      >
                        Re-run
                      </button>
                    ) : null}
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>
    </>
  );
}

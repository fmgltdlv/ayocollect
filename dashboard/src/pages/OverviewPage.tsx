import { useEffect, useState } from 'react';
import { fetchOverview, fetchSyncStatus, fetchUtilities } from '../api';

export default function OverviewPage() {
  const [overview, setOverview] = useState<Record<string, number> | null>(null);
  const [sync, setSync] = useState<Record<string, unknown> | null>(null);
  const [utilities, setUtilities] = useState<Array<Record<string, unknown>>>([]);
  const [error, setError] = useState('');

  useEffect(() => {
    Promise.all([fetchOverview(), fetchSyncStatus(), fetchUtilities()])
      .then(([o, s, u]) => {
        setOverview(o.overview);
        setSync(s.syncState as Record<string, unknown>);
        setUtilities(u.utilities.slice(0, 5) as Array<Record<string, unknown>>);
      })
      .catch((err) => setError(err.message));
  }, []);

  if (error) return <p className="error">{error}</p>;

  const onTime = overview?.on_time_count ?? 0;
  const late = overview?.late_count ?? 0;
  const pending = overview?.pending_count ?? 0;
  const total = onTime + late + pending;
  const onTimePct = total ? Math.round((onTime / total) * 100) : 0;

  return (
    <>
      <div className="grid card">
        <div>
          <div className="stat">{overview?.ticket_count ?? 0}</div>
          <div className="stat-label">Tickets</div>
        </div>
        <div>
          <div className="stat">{onTimePct}%</div>
          <div className="stat-label">On-time rate</div>
        </div>
        <div>
          <div className="stat">{late}</div>
          <div className="stat-label">Late responses</div>
        </div>
        <div>
          <div className="stat">{pending}</div>
          <div className="stat-label">Pending</div>
        </div>
      </div>

      <div className="card">
        <h2>Sync status</h2>
        {sync ? (
          <ul>
            <li>Last run: {String(sync.last_success_at ?? 'Never')}</li>
            <li>Last date: {String(sync.last_target_date ?? '—')}</li>
            <li>Tickets synced: {String(sync.tickets_synced ?? 0)}</li>
            {sync.last_error ? <li className="error">Error: {String(sync.last_error)}</li> : null}
          </ul>
        ) : (
          <p>Loading…</p>
        )}
      </div>

      <div className="card">
        <h2>Utilities with most late responses</h2>
        <table>
          <thead>
            <tr>
              <th>Utility</th>
              <th>On-time</th>
              <th>Late</th>
              <th>Pending</th>
            </tr>
          </thead>
          <tbody>
            {utilities.map((u) => (
              <tr key={String(u.station_code)}>
                <td>{String(u.station_name)}</td>
                <td>{String(u.on_time_count)}</td>
                <td>{String(u.late_count)}</td>
                <td>{String(u.pending_count)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </>
  );
}

import { useEffect, useState } from 'react';
import { fetchUtilities, type UtilityMetric } from '../api';

export default function UtilitiesPage() {
  const [utilities, setUtilities] = useState<UtilityMetric[]>([]);
  const [error, setError] = useState('');

  useEffect(() => {
    fetchUtilities()
      .then((data) => setUtilities(data.utilities))
      .catch((err) => setError(err.message));
  }, []);

  return (
    <div className="card">
      <h2>Utility scorecards</h2>
      {error ? <p className="error">{error}</p> : null}
      <table>
        <thead>
          <tr>
            <th>Code</th>
            <th>Utility</th>
            <th>On-time %</th>
            <th>Late</th>
            <th>Pending</th>
            <th>Total</th>
          </tr>
        </thead>
        <tbody>
          {utilities.map((u) => {
            const pct = u.total ? Math.round((u.on_time_count / u.total) * 100) : 0;
            return (
              <tr key={u.station_code}>
                <td>{u.station_code}</td>
                <td>{u.station_name}</td>
                <td>{pct}%</td>
                <td>{u.late_count}</td>
                <td>{u.pending_count}</td>
                <td>{u.total}</td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

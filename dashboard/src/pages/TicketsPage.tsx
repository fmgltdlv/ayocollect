import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { fetchTickets, REGION_LABELS, type TicketRow } from '../api';

export default function TicketsPage() {
  const [q, setQ] = useState('');
  const [tickets, setTickets] = useState<TicketRow[]>([]);
  const [error, setError] = useState('');

  useEffect(() => {
    fetchTickets(q)
      .then((data) => setTickets(data.tickets))
      .catch((err) => setError(err.message));
  }, [q]);

  return (
    <div className="card">
      <h2>Tickets</h2>
      <div className="form-row">
        <label>
          Search
          <input
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="Ticket number, address, created by…"
          />
        </label>
      </div>
      {error ? <p className="error">{error}</p> : null}
      <table>
        <thead>
          <tr>
            <th>System</th>
            <th>Ticket</th>
            <th>Created by</th>
            <th>Address</th>
            <th>Job start</th>
          </tr>
        </thead>
        <tbody>
          {tickets.map((t) => (
            <tr key={`${t.region}:${t.ticket_base}`}>
              <td>{REGION_LABELS[t.region] ?? t.region}</td>
              <td>
                <Link to={`/tickets/${t.region}/${t.ticket_base}`}>{t.ticket_base}</Link>
              </td>
              <td>{t.created_by ?? '—'}</td>
              <td>{t.address ?? '—'}</td>
              <td>{t.job_start_at ?? '—'}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

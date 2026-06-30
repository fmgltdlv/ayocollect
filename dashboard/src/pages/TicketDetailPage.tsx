import { useEffect, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { fetchTicketDetail, type TicketDetail } from '../api';

export default function TicketDetailPage() {
  const { ticketBase } = useParams();
  const [detail, setDetail] = useState<TicketDetail | null>(null);
  const [error, setError] = useState('');

  useEffect(() => {
    if (!ticketBase) return;
    fetchTicketDetail(ticketBase)
      .then(setDetail)
      .catch((err) => setError(err.message));
  }, [ticketBase]);

  if (error) return <p className="error">{error}</p>;
  if (!detail) return <p>Loading…</p>;

  const timelinessMap = new Map(
    detail.timeliness.map((t) => [`${t.request_number}:${t.station_code}`, t.timeliness_status]),
  );

  return (
    <>
      <p><Link to="/tickets">← Back to tickets</Link></p>
      <div className="card">
        <h2>{detail.ticket.ticket_base}</h2>
        <p>{detail.ticket.latest_request_number} · {detail.ticket.created_by ?? 'Unknown excavator'}</p>
      </div>

      <div className="card">
        <h3>Response timeline</h3>
        <table>
          <thead>
            <tr>
              <th>Revision</th>
              <th>Utility</th>
              <th>Date</th>
              <th>Code</th>
              <th>Status</th>
            </tr>
          </thead>
          <tbody>
            {detail.events.map((e, i) => {
              const status = timelinessMap.get(`${e.request_number}:${e.station_code}`);
              const marker = e.is_late_trigger ? '999/888' : e.is_acceptable ? 'OK' : '000';
              return (
                <tr key={`${e.request_number}-${e.station_code}-${i}`}>
                  <td>{e.request_number}</td>
                  <td>{e.station_name}</td>
                  <td>{e.response_date}</td>
                  <td>{e.response_code} ({marker})</td>
                  <td>{status ? <span className={`badge ${status}`}>{status}</span> : '—'}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </>
  );
}

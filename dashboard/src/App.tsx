import { NavLink, Route, Routes } from 'react-router-dom';
import BackfillPage from './pages/BackfillPage';
import OverlapsPage from './pages/OverlapsPage';
import OverviewPage from './pages/OverviewPage';
import TicketDetailPage from './pages/TicketDetailPage';
import TicketsPage from './pages/TicketsPage';
import UtilitiesPage from './pages/UtilitiesPage';

const links = [
  { to: '/', label: 'Overview' },
  { to: '/tickets', label: 'Tickets' },
  { to: '/utilities', label: 'Utilities' },
  { to: '/overlaps', label: 'Overlaps' },
  { to: '/backfill', label: 'Backfill' },
];

export default function App() {
  return (
    <div className="app">
      <header className="header">
        <h1>ayocollect</h1>
        <p className="subtitle">811 Ticket Analytics — USAN & DigAlert</p>
        <nav>
          {links.map((link) => (
            <NavLink
              key={link.to}
              to={link.to}
              className={({ isActive }) => (isActive ? 'nav-link active' : 'nav-link')}
              end={link.to === '/'}
            >
              {link.label}
            </NavLink>
          ))}
        </nav>
      </header>
      <main className="main">
        <Routes>
          <Route path="/" element={<OverviewPage />} />
          <Route path="/tickets" element={<TicketsPage />} />
          <Route path="/tickets/:ticketBase" element={<TicketDetailPage />} />
          <Route path="/utilities" element={<UtilitiesPage />} />
          <Route path="/overlaps" element={<OverlapsPage />} />
          <Route path="/backfill" element={<BackfillPage />} />
        </Routes>
      </main>
    </div>
  );
}

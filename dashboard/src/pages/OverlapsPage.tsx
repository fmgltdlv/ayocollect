import { useEffect, useMemo, useState } from 'react';
import { MapContainer, Polygon, TileLayer } from 'react-leaflet';
import { fetchOverlaps, fetchTicketDetail, REGION_LABELS, type OverlapRow } from '../api';

type MapPolygon = {
  ticketBase: string;
  region: string;
  geojson: string;
};

export default function OverlapsPage() {
  const [overlaps, setOverlaps] = useState<OverlapRow[]>([]);
  const [polygons, setPolygons] = useState<MapPolygon[]>([]);
  const [error, setError] = useState('');

  useEffect(() => {
    fetchOverlaps()
      .then(async (data) => {
        setOverlaps(data.overlaps);
        const tickets = new Map<string, { region: string; ticketBase: string }>();
        for (const o of data.overlaps.slice(0, 10)) {
          tickets.set(`${o.region_a}:${o.ticket_base_a}`, {
            region: o.region_a,
            ticketBase: o.ticket_base_a,
          });
          tickets.set(`${o.region_b}:${o.ticket_base_b}`, {
            region: o.region_b,
            ticketBase: o.ticket_base_b,
          });
        }
        const loaded: MapPolygon[] = [];
        for (const { region, ticketBase } of tickets.values()) {
          try {
            const detail = await fetchTicketDetail(region, ticketBase);
            for (const p of detail.polygons) {
              loaded.push({ ticketBase, region, geojson: p.geojson });
            }
          } catch {
            // skip missing tickets
          }
        }
        setPolygons(loaded);
      })
      .catch((err) => setError(err.message));
  }, []);

  const center = useMemo((): [number, number] => {
    if (!polygons.length) return [39.5, -119.7];
    const first = JSON.parse(polygons[0].geojson) as { coordinates: number[][][] };
    const [lon, lat] = first.coordinates[0][0];
    return [lat, lon];
  }, [polygons]);

  return (
    <>
      <div className="card">
        <h2>Overlapping tickets</h2>
        {error ? <p className="error">{error}</p> : null}
        <table>
          <thead>
            <tr>
              <th>Ticket A</th>
              <th>Ticket B</th>
              <th>Overlap (m²)</th>
            </tr>
          </thead>
          <tbody>
            {overlaps.map((o) => (
              <tr key={`${o.region_a}:${o.ticket_base_a}-${o.region_b}:${o.ticket_base_b}`}>
                <td>
                  {REGION_LABELS[o.region_a] ?? o.region_a}: {o.ticket_base_a}
                </td>
                <td>
                  {REGION_LABELS[o.region_b] ?? o.region_b}: {o.ticket_base_b}
                </td>
                <td>{Math.round(o.overlap_area_sqm)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <div className="card map-container">
        <MapContainer center={center} zoom={13} style={{ height: '100%', width: '100%' }}>
          <TileLayer url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png" />
          {polygons.map((p, idx) => {
            const geo = JSON.parse(p.geojson) as { coordinates: number[][][] };
            const positions = geo.coordinates[0].map(([lon, lat]) => [lat, lon] as [number, number]);
            return <Polygon key={`${p.region}:${p.ticketBase}-${idx}`} positions={positions} />;
          })}
        </MapContainer>
      </div>
    </>
  );
}

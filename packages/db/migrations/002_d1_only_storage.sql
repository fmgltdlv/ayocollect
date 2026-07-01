-- Move raw ticket storage from R2 keys to D1 columns (existing databases)

ALTER TABLE posr_fetches RENAME COLUMN raw_r2_key TO raw_payload;
ALTER TABLE ticket_polygons RENAME COLUMN gml_r2_key TO map_html;

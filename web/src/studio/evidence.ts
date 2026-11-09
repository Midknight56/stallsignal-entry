import type { ColDef, ValueFormatterParams } from 'ag-grid-community';
import type { StudioTables } from './data';

export const EVIDENCE_ROW_HEIGHT = 48;
export type EvidenceRow = StudioTables['evidence'][number];
const formatText = ({ value }: ValueFormatterParams<EvidenceRow>) => String(value ?? '');
export const evidenceColumns: ColDef<EvidenceRow>[] = [
  { field: 'venue', headerName: 'Venue', width: 190, valueFormatter: formatText },
  { field: 'kind', headerName: 'Kind', width: 110, valueFormatter: formatText },
  { field: 'label', headerName: 'Fact', width: 200, valueFormatter: formatText },
  { field: 'value', headerName: 'Value', width: 150, valueFormatter: formatText },
  { field: 'source', headerName: 'Source', width: 240, valueFormatter: formatText },
];

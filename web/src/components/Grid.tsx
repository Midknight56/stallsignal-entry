import { AllCommunityModule, ModuleRegistry, themeQuartz, type ColDef } from 'ag-grid-community';
import { AgGridReact } from 'ag-grid-react';
import { useDark } from '../theme';
ModuleRegistry.registerModules([AllCommunityModule]);
export default function Grid<T>({
  rows,
  columns,
  label,
}: {
  rows: T[];
  columns: ColDef<T>[];
  label: string;
}) {
  const dark = useDark();
  const theme = themeQuartz.withParams({
    backgroundColor: dark ? '#16283A' : '#F6F1E7',
    foregroundColor: dark ? '#EEE7DA' : '#12263A',
    headerBackgroundColor: dark ? '#0E1B29' : '#EBE3D4',
    headerTextColor: dark ? '#EEE7DA' : '#12263A',
    borderColor: dark ? '#3B5364' : '#D8CFBF',
    accentColor: '#1F8A84',
    fontFamily: 'system-ui, sans-serif',
    fontSize: 14,
    cellHorizontalPadding: 12,
  });
  return (
    <div className="data-grid" role="region" aria-label={label}>
      <AgGridReact
        theme={theme}
        rowData={rows}
        columnDefs={columns}
        defaultColDef={{
          sortable: true,
          resizable: true,
          minWidth: 125,
          flex: 1,
          wrapHeaderText: true,
          autoHeaderHeight: true,
        }}
        pagination
        paginationPageSize={10}
        paginationPageSizeSelector={false}
        domLayout="autoHeight"
        ensureDomOrder
        suppressCellFocus={false}
      />
    </div>
  );
}

import { studioTheme } from 'ag-studio';

export function makeTheme(dark: boolean) {
  const text = dark ? '#EEE7DA' : '#12263A';
  const line = dark ? '#3B5364' : '#D8CFBF';
  return studioTheme.withParams({
    backgroundColor: dark ? '#0E1B29' : '#F6F1E7',
    foregroundColor: text,
    accentColor: '#1F8A84',
    borderColor: line,
    fontFamily: 'system-ui, sans-serif',
    browserColorScheme: dark ? 'dark' : 'light',
    studioCanvasBackgroundColor: dark ? '#0E1B29' : '#F6F1E7',
    studioWidgetBackgroundColor: dark ? '#16283A' : '#FFFCF5',
    studioWidgetTitleTextColor: text,
    studioWrapperBackgroundColor: dark ? '#0E1B29' : '#F6F1E7',
    studioWidgetTitleFontSize: 16,
    studioWidgetTitleFontWeight: 600,
    studioMinWidth: 0,
    studioCanvasMinWidth: 0,
    gridRowHeight: 48,
    studioCanvasPadding: 8,
    chartTextColor: text,
    chartSubtleTextColor: dark ? '#A7B5BD' : '#6B7785',
    chartAxisLineColor: line,
    chartGridLineColor: line,
    chartFontFamily: 'system-ui, sans-serif',
    chartAccentColor: '#E2572B',
    chartBorderColor: line,
    chartPaletteFills1Color: '#E2572B',
    chartPaletteFills2Color: '#1F8A84',
    chartPaletteFills3Color: '#4B6FA8',
    chartPaletteStrokes1Color: '#E2572B',
    chartPaletteStrokes2Color: '#1F8A84',
    chartPaletteStrokes3Color: '#4B6FA8',
  });
}

import type { Page } from '@playwright/test';
export function approve(page: Page, url: string): Promise<{ returned: boolean }>;

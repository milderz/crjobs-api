import { chromium } from 'playwright';

let browser = null;

export async function getBrowser() {
  if (!browser || !browser.isConnected()) {
    browser = await chromium.launch({ headless: true });
  }
  return browser;
}

export async function closeBrowser() {
  if (browser) {
    await browser.close();
    browser = null;
  }
}

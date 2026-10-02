const { chromium } = require('playwright');
const fs = require('fs');

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

(async () => {
  const target = process.env.TARGET_USER;
  if (!target) {
    console.error('[-] Target username tidak diberikan!');
    process.exit(1);
  }

  // Ambil cookies dari environment secret
  const rawCookies = JSON.parse(process.env.TIKTOK_COOKIES || '[]');
  
  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({
    userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
    viewport: { width: 1280, height: 800 }
  });

  // Inject cookies ke sesi Playwright
  const formattedCookies = rawCookies.map(c => ({
    name: c.name,
    value: c.value,
    domain: c.domain.startsWith('.') ? c.domain : `.${c.domain}`,
    path: c.path || '/'
  }));

  await context.addCookies(formattedCookies);
  const page = await context.newPage();

  console.log(`[*] Membuka profil: https://www.tiktok.com/@${target}`);
  try {
    await page.goto(`https://www.tiktok.com/@${target}`, {
      waitUntil: 'domcontentloaded',
      timeout: 30000
    });

    await sleep(4000);

    const followBtn = page.locator('button[data-e2e="follow-button"]');
    await followBtn.waitFor({ state: 'visible', timeout: 15000 });

    const btnText = (await followBtn.innerText()).toLowerCase();
    if (btnText.includes('following') || btnText.includes('mengikuti')) {
      console.log(`[!] Status: Sudah mem-follow @${target} sebelumnya.`);
    } else {
      await sleep(2000);
      await followBtn.click();
      console.log(`[+] SUKSES: Berhasil menekan follow untuk @${target}!`);
      await sleep(3000); // Tunggu respons network
    }
  } catch (err) {
    console.error(`[-] Gagal mengeksekusi follow: ${err.message}`);
    process.exit(1);
  } finally {
    await browser.close();
  }
})();

const { chromium } = require('playwright');
const fs = require('fs');

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

function sanitizeSameSite(val) {
  if (!val) return 'Lax';
  const s = String(val).toLowerCase();
  if (s.includes('lax')) return 'Lax';
  if (s.includes('strict')) return 'Strict';
  if (s.includes('none') || s.includes('no_restriction')) return 'None';
  return 'Lax';
}

(async () => {
  const target = process.env.TARGET_USER;
  if (!target) {
    console.error('[-] Error: Variabel environment TARGET_USER tidak ditemukan!');
    process.exit(1);
  }

  // 1. Baca dan format cookie dari GitHub Secret
  let rawCookies = [];
  try {
    rawCookies = JSON.parse(process.env.TIKTOK_COOKIES || '[]');
  } catch (err) {
    console.error('[-] Error parsing TIKTOK_COOKIES JSON:', err.message);
    process.exit(1);
  }

  const formattedCookies = rawCookies.map((c) => {
    const cookieObj = {
      name: c.name,
      value: c.value,
      domain: c.domain.startsWith('.') ? c.domain : `.${c.domain}`,
      path: c.path || '/'
    };
    if (c.sameSite) {
      cookieObj.sameSite = sanitizeSameSite(c.sameSite);
    }
    return cookieObj;
  });

  // 2. Inisialisasi Chromium Playwright
  console.log('[*] Menyiapkan browser Chromium...');
  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({
    userAgent:
      'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
    viewport: { width: 1280, height: 800 }
  });

  await context.addCookies(formattedCookies);
  const page = await context.newPage();

  const cleanTarget = target.trim().replace('@', '');
  console.log(`[*] Mengunjungi profil target: https://www.tiktok.com/@${cleanTarget}`);

  try {
    await page.goto(`https://www.tiktok.com/@${cleanTarget}`, {
      waitUntil: 'domcontentloaded',
      timeout: 35000
    });

    // Beri jeda render JavaScript halaman profil
    await sleep(4000);

    // Gunakan .first() untuk menghindari tombol follow dari suggested accounts
    const followBtn = page.locator('button[data-e2e="follow-button"]').first();
    await followBtn.waitFor({ state: 'visible', timeout: 15000 });

    const btnText = (await followBtn.innerText()).toLowerCase();

    if (btnText.includes('following') || btnText.includes('mengikuti')) {
      console.log(`[!] Info: Akun @${cleanTarget} sudah di-follow sebelumnya.`);
    } else {
      // Gerakkan kursor ke tombol sebelum klik (simulasi manusia)
      await followBtn.hover();
      await sleep(1500);
      await followBtn.click();
      console.log(`[+] SUKSES: Berhasil menekan tombol follow untuk @${cleanTarget}!`);

      // Tunggu agar network request follow selesai terkirim
      await sleep(5000);
    }
  } catch (err) {
    console.error(`[-] Gagal mengeksekusi follow pada @${cleanTarget}:`, err.message);
    process.exit(1);
  } finally {
    await browser.close();
    console.log('[*] Selesai.');
  }
})();

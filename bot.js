const { chromium } = require('playwright');

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
    console.error('[-] Error: TARGET_USER tidak ditemukan!');
    process.exit(1);
  }

  let rawCookies = [];
  try {
    rawCookies = JSON.parse(process.env.TIKTOK_COOKIES || '[]');
  } catch (err) {
    console.error('[-] Error parsing TIKTOK_COOKIES JSON:', err.message);
    process.exit(1);
  }

  // 1. Bersihkan dan normalkan domain cookie
  const formattedCookies = rawCookies
    .filter(c => c.name !== 'delay_guest_mode_vid') // Hapus token penanda guest
    .map((c) => {
      let domain = c.domain || '.tiktok.com';
      // Standarkan semua domain ke .tiktok.com agar sessionid aktif global
      if (domain.includes('tiktok.com')) {
        domain = '.tiktok.com';
      }
      
      const cookieObj = {
        name: c.name,
        value: String(c.value),
        domain: domain,
        path: c.path || '/'
      };

      if (c.sameSite) {
        cookieObj.sameSite = sanitizeSameSite(c.sameSite);
      }
      return cookieObj;
    });

  console.log('[*] Menyiapkan browser Chromium...');
  const browser = await chromium.launch({ headless: true });
  
  // Gunakan user-agent desktop yang konsisten
  const context = await browser.newContext({
    userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36',
    viewport: { width: 1280, height: 800 },
    locale: 'id-ID'
  });

  await context.addCookies(formattedCookies);
  const page = await context.newPage();

  // Pantau respons follow API
  page.on('response', async (response) => {
    if (response.url().includes('/api/commit/follow/user/')) {
      try {
        const resJson = await response.json();
        console.log('[*] Respon Server TikTok:', JSON.stringify(resJson));
      } catch (_) {}
    }
  });

  // 2. Verifikasi status login di halaman beranda terlebih dahulu
  console.log('[*] Memverifikasi sesi login...');
  await page.goto('https://www.tiktok.com/', { waitUntil: 'domcontentloaded', timeout: 35000 });
  await sleep(4000);

  // Ambil cookie dari browser untuk memastikan sessionid tertancap
  const browserCookies = await context.cookies('https://www.tiktok.com');
  const hasSession = browserCookies.some(c => c.name === 'sessionid' && c.value.length > 5);

  if (hasSession) {
    console.log('[+] Sesi login TERKONFIRMASI AKTIF (sessionid terpasang)!');
  } else {
    console.log('[-] PERINGATAN: Sesi login belum terpasang sempurna pada browser.');
  }

  const cleanTarget = target.trim().replace('@', '');
  console.log(`[*] Mengunjungi profil target: https://www.tiktok.com/@${cleanTarget}`);

  try {
    await page.goto(`https://www.tiktok.com/@${cleanTarget}`, {
      waitUntil: 'domcontentloaded',
      timeout: 35000
    });

    await sleep(5000);

    // Tutup popup bila ada
    try {
      await page.keyboard.press('Escape');
      const closeBtn = page.locator('[data-e2e="modal-close-icon"], button[aria-label="Close"]').first();
      if (await closeBtn.isVisible()) {
        await closeBtn.click({ force: true });
        await sleep(1000);
      }
    } catch (_) {}

    // Cari tombol follow profil target utama
    let followBtn = page.locator(`button[data-e2e="follow-button"][aria-label*="${cleanTarget}" i]`).first();
    if (await followBtn.count() === 0) {
      followBtn = page.locator('[data-e2e="user-page"] button[data-e2e="follow-button"]').first();
    }
    if (await followBtn.count() === 0) {
      followBtn = page.locator('button[data-e2e="follow-button"]').first();
    }

    await followBtn.waitFor({ state: 'attached', timeout: 15000 });
    const btnText = (await followBtn.innerText()).toLowerCase();

    if (btnText.includes('following') || btnText.includes('mengikuti') || btnText.includes('teman') || btnText.includes('friends')) {
      console.log(`[!] Info: Akun @${cleanTarget} sudah di-follow sebelumnya.`);
    } else {
      await followBtn.scrollIntoViewIfNeeded();
      await sleep(1500);
      await followBtn.click({ force: true });
      console.log(`[+] Tombol follow ditekan! Menunggu respon server...`);
      await sleep(6000);
    }
  } catch (err) {
    console.error(`[-] Gagal mengeksekusi follow: ${err.message}`);
  } finally {
    await browser.close();
    console.log('[*] Selesai.');
  }
})();

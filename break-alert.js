'use strict';

(() => {
  const SETTINGS = Object.freeze({
    threshold: 25,
    displayMinutes: 10,
    imageUrl: '/tsurugamine-wbgt-signage/images/heat-break-10min.png?v=3',
    pendingKey: 'tsurugamine-break-pending-v1',
    activeHourKey: 'tsurugamine-break-active-hour-v1'
  });

  let overlay = null;
  let countdown = null;

  function getJapanParts(date = new Date()) {
    return Object.fromEntries(
      new Intl.DateTimeFormat('en-CA', {
        timeZone: 'Asia/Tokyo',
        year: 'numeric',
        month: '2-digit',
        day: '2-digit',
        hour: '2-digit',
        minute: '2-digit',
        second: '2-digit',
        hourCycle: 'h23'
      })
        .formatToParts(date)
        .filter((part) => part.type !== 'literal')
        .map((part) => [part.type, part.value])
    );
  }

  function getHourKey(parts) {
    return `${parts.year}-${parts.month}-${parts.day}-${parts.hour}`;
  }

  function readCurrentWbgt() {
    const element = document.getElementById('value');
    if (!element) return null;

    const value = Number.parseFloat(
      element.textContent.replace(/[^-\d.-]/g, '').trim()
    );

    return Number.isFinite(value) ? value : null;
  }

  function getStorage(key) {
    try {
      return localStorage.getItem(key);
    } catch (error) {
      console.warn('休憩表示の保存情報を読み込めませんでした', error);
      return null;
    }
  }

  function setStorage(key, value) {
    try {
      localStorage.setItem(key, value);
    } catch (error) {
      console.warn('休憩表示の保存情報を保存できませんでした', error);
    }
  }

  function createOverlay() {
    if (overlay) return;

    overlay = document.createElement('section');
    overlay.id = 'heat-break-overlay';
    overlay.hidden = true;
    overlay.setAttribute('role', 'alert');
    overlay.setAttribute('aria-live', 'assertive');

    const image = document.createElement('img');
    image.src = SETTINGS.imageUrl;
    image.alt = '熱中症防止のため10分の休憩、水分・塩分補給、相互の体調確認を促す掲示';
image.addEventListener('error', () => {
  console.error('休憩画像を読み込めませんでした:', image.src);
  overlay.hidden = true;
});

image.addEventListener('load', () => {
  console.info('休憩画像を正常に読み込みました:', image.src);
});
    
    countdown = document.createElement('div');
    countdown.id = 'heat-break-countdown';

    overlay.append(image, countdown);
    document.body.append(overlay);

    const style = document.createElement('style');
    style.textContent = `
      #heat-break-overlay {
        position: fixed;
        inset: 0;
        z-index: 999999;
        display: grid;
        place-items: center;
        overflow: hidden;
        background: #e60000;
      }

      #heat-break-overlay[hidden] {
        display: none !important;
      }

      #heat-break-overlay img {
        width: 100%;
        height: 100%;
        display: block;
        object-fit: contain;
        object-position: center;
      }

      #heat-break-countdown {
        position: absolute;
        right: 2vw;
        bottom: 2vh;
        min-width: 360px;
        padding: 12px 24px;
        color: #ffffff;
        background: rgba(0, 0, 0, 0.78);
        border: 4px solid #ffffff;
        border-radius: 16px;
        text-align: center;
        font-family: "BIZ UDPGothic", "Yu Gothic", Meiryo, sans-serif;
        font-size: clamp(28px, 3vw, 58px);
        font-weight: 900;
        line-height: 1.1;
        font-variant-numeric: tabular-nums;
      }
    `;
    document.head.append(style);
  }

  function showOverlay(parts) {
    createOverlay();
    overlay.hidden = false;

    const elapsedSeconds =
      Number(parts.minute) * 60 + Number(parts.second);
    const remainingSeconds = Math.max(
      0,
      SETTINGS.displayMinutes * 60 - elapsedSeconds
    );
    const minutes = Math.floor(remainingSeconds / 60);
    const seconds = remainingSeconds % 60;

    countdown.textContent =
      `通常画面へ戻るまで ${minutes}:${String(seconds).padStart(2, '0')}`;
  }

  function hideOverlay() {
    if (overlay) overlay.hidden = true;
  }

  function updateBreakDisplay() {
    const parts = getJapanParts();
    const minute = Number(parts.minute);
    const hourKey = getHourKey(parts);
    const currentWbgt = readCurrentWbgt();

    if (currentWbgt !== null && currentWbgt >= SETTINGS.threshold) {
      setStorage(SETTINGS.pendingKey, '1');
    }

    const pending = getStorage(SETTINGS.pendingKey) === '1';
    const activeHour = getStorage(SETTINGS.activeHourKey);
    const isDisplayWindow = minute >= 0 && minute < SETTINGS.displayMinutes;

    if (isDisplayWindow && activeHour === hourKey) {
      showOverlay(parts);
      return;
    }

    if (isDisplayWindow && pending) {
      setStorage(SETTINGS.activeHourKey, hourKey);
      setStorage(SETTINGS.pendingKey, '0');
      showOverlay(parts);
      return;
    }

    hideOverlay();
  }

  createOverlay();
  updateBreakDisplay();
  window.setInterval(updateBreakDisplay, 1000);
})();

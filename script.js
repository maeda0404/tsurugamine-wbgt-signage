'use strict';

(() => {
  const C = window.APP_CONFIG;
  const $ = (id) => document.getElementById(id);
  const JAPAN_TIME_ZONE = 'Asia/Tokyo';

  const dateTimeFormatter = new Intl.DateTimeFormat('ja-JP', {
    timeZone: JAPAN_TIME_ZONE,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    weekday: 'short',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit'
  });

  const timeFormatter = new Intl.DateTimeFormat('ja-JP', {
    timeZone: JAPAN_TIME_ZONE,
    hour: '2-digit',
    minute: '2-digit'
  });

  let requestInProgress = false;
  let lastSuccessfulFetchTime = 0;
  let nextFetchTime = 0;

  function getJapanParts(date = new Date()) {
    return Object.fromEntries(
      new Intl.DateTimeFormat('en-CA', {
        timeZone: JAPAN_TIME_ZONE,
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

  function getJapanDateKey(date = new Date()) {
    const p = getJapanParts(date);
    return `${p.year}-${p.month}-${p.day}`;
  }

  function getTomorrowJapanDateKey() {
    const p = getJapanParts();
    const date = new Date(
      Date.UTC(Number(p.year), Number(p.month) - 1, Number(p.day), 3, 0, 0)
    );
    date.setUTCDate(date.getUTCDate() + 1);
    return getJapanDateKey(date);
  }

  function parseCsv(text) {
    if (typeof text !== 'string') {
      throw new Error('CSVが文字列ではありません');
    }

    return text
      .replace(/^\uFEFF/, '')
      .split(/\r?\n/)
      .filter((line) => line.trim() !== '')
      .map((line) => {
        const values = [];
        let currentValue = '';
        let insideQuotes = false;

        for (let i = 0; i < line.length; i += 1) {
          const character = line[i];

          if (character === '"') {
            if (insideQuotes && line[i + 1] === '"') {
              currentValue += '"';
              i += 1;
            } else {
              insideQuotes = !insideQuotes;
            }
          } else if (character === ',' && !insideQuotes) {
            values.push(currentValue.trim());
            currentValue = '';
          } else {
            currentValue += character;
          }
        }

        values.push(currentValue.trim());
        return values;
      });
  }

  function parseCompactJapanDateTime(value) {
    if (!/^\d{10}$/.test(value || '')) return null;

    const year = Number(value.slice(0, 4));
    const month = Number(value.slice(4, 6));
    const day = Number(value.slice(6, 8));
    const sourceHour = Number(value.slice(8, 10));

    if (sourceHour === 24) {
      return new Date(Date.UTC(year, month - 1, day, 15, 0, 0));
    }

    if (sourceHour < 0 || sourceHour > 23) return null;
    return new Date(Date.UTC(year, month - 1, day, sourceHour - 9, 0, 0));
  }

  function parseActualJapanDateTime(dateText, timeText) {
    const dateMatch = /^(\d{4})\/(\d{1,2})\/(\d{1,2})$/.exec(dateText || '');
    const timeMatch = /^(\d{1,2}):(\d{2})$/.exec(timeText || '');
    if (!dateMatch || !timeMatch) return null;

    const year = Number(dateMatch[1]);
    const month = Number(dateMatch[2]);
    const day = Number(dateMatch[3]);
    const sourceHour = Number(timeMatch[1]);
    const minute = Number(timeMatch[2]);

    if (sourceHour === 24) {
      return new Date(Date.UTC(year, month - 1, day, 15, minute, 0));
    }

    if (sourceHour < 0 || sourceHour > 23) return null;
    return new Date(
      Date.UTC(year, month - 1, day, sourceHour - 9, minute, 0)
    );
  }

  function parseMetadataJapanDateTime(dateText, timeText) {
    const dateMatch = /^(\d{4})\/(\d{2})\/(\d{2})$/.exec(dateText || '');
    const timeMatch = /^(\d{2}):(\d{2}):(\d{2})$/.exec(timeText || '');
    if (!dateMatch || !timeMatch) return null;

    return new Date(
      Date.UTC(
        Number(dateMatch[1]),
        Number(dateMatch[2]) - 1,
        Number(dateMatch[3]),
        Number(timeMatch[1]) - 9,
        Number(timeMatch[2]),
        Number(timeMatch[3])
      )
    );
  }

  function parseForecastValue(value) {
    if (value === undefined || value === null || String(value).trim() === '') {
      return null;
    }

    const rawValue = Number(value);
    if (!Number.isFinite(rawValue) || rawValue < -500 || rawValue > 600) {
      return null;
    }

    return Math.round(rawValue / 10);
  }

  function parseForecastCsv(text) {
    const rows = parseCsv(text);
    if (rows.length < 2 || rows[0].length < 3) {
      throw new Error('予測CSVの形式が不正です');
    }

    const pointRow = rows.find(
      (row, index) => index > 0 && String(row[0]).trim() === String(C.pointCode)
    );

    if (!pointRow) {
      throw new Error(`予測CSVに地点コード${C.pointCode}がありません`);
    }

    const values = rows[0]
      .slice(2)
      .map((timeText, index) => ({
        at: parseCompactJapanDateTime(timeText),
        value: parseForecastValue(pointRow[index + 2])
      }))
      .filter(
        (item) =>
          item.at instanceof Date &&
          !Number.isNaN(item.at.getTime()) &&
          item.value !== null
      );

    if (values.length === 0) {
      throw new Error('有効な予測値がありません');
    }

    return { publishedText: pointRow[1] || '', values };
  }

  function parseActualValue(value) {
    if (value === undefined || value === null || String(value).trim() === '') {
      return null;
    }

    const number = Number(value);
    if (!Number.isFinite(number) || number < -20 || number > 60) return null;
    return number;
  }

  function parseActualCsv(text) {
    const rows = parseCsv(text);
    if (rows.length < 2 || rows[0][0] !== 'Date' || rows[0][1] !== 'Time') {
      throw new Error('実況CSVの形式が不正です');
    }

    const pointIndex = rows[0].findIndex(
      (value) => String(value).trim() === String(C.pointCode)
    );

    if (pointIndex < 2) {
      throw new Error(`実況CSVに地点コード${C.pointCode}がありません`);
    }

    const currentTime = Date.now();
    const candidates = rows
      .slice(1)
      .map((row) => ({
        at: parseActualJapanDateTime(row[0], row[1]),
        value: parseActualValue(row[pointIndex])
      }))
      .filter(
        (item) =>
          item.at instanceof Date &&
          !Number.isNaN(item.at.getTime()) &&
          item.at.getTime() <= currentTime + 5 * 60 * 1000 &&
          item.value !== null
      )
      .sort((first, second) => second.at.getTime() - first.at.getTime());

    return candidates[0] || null;
  }

  function parseAlertMetadata(rows) {
    const metadata = {};
    for (const row of rows) {
      if (row.length >= 2 && /^[A-Za-z][A-Za-z0-9]*$/.test(row[0])) {
        metadata[row[0]] = row.slice(1).join(',');
      }
    }
    return metadata;
  }

  function findKanagawaAlertRow(rows) {
    return rows.find((row) => {
      if (row.length < 8) return false;
      const prefectureName = String(row[4] || '').trim();
      const prefectureCode = String(row[5] || '').trim();
      return prefectureName === '神奈川県' || prefectureCode === '14';
    });
  }

  function parseAlertCsvs(csvTexts) {
    if (!Array.isArray(csvTexts) || csvTexts.length === 0) {
      throw new Error('アラートCSVがありません');
    }

    const candidates = [];

    for (let index = 0; index < csvTexts.length; index += 1) {
      try {
        const rows = parseCsv(csvTexts[index]);
        const metadata = parseAlertMetadata(rows);
        const kanagawaRow = findKanagawaAlertRow(rows);
        if (!kanagawaRow) continue;

        const flag = Number(kanagawaRow[6]);
        if (![0, 1, 2, 3, 9].includes(flag)) continue;

        const published = parseMetadataJapanDateTime(
          metadata.ReportDate,
          metadata.ReportTime
        );

        const targetDate = parseMetadataJapanDateTime(
          metadata.TargetDate1,
          metadata.TargetTime1
        );

        if (targetDate && getJapanDateKey(targetDate) !== getJapanDateKey()) {
          continue;
        }

        if (metadata.Status && metadata.Status !== '通常') continue;

        candidates.push({ flag, published, sourceIndex: index });
      } catch (error) {
        console.warn(`アラートCSV ${index} の解析をスキップしました`, error);
      }
    }

    if (candidates.length === 0) {
      throw new Error('神奈川県の有効なアラート情報を確認できません');
    }

    candidates.sort((first, second) => {
      const firstTime = first.published instanceof Date
        ? first.published.getTime()
        : first.sourceIndex;
      const secondTime = second.published instanceof Date
        ? second.published.getTime()
        : second.sourceIndex;
      return secondTime - firstTime;
    });

    return candidates[0];
  }

  function getWbgtRank(value) {
    if (!Number.isFinite(value)) {
      return { className: 'unknown', label: '判定不能' };
    }
    if (value >= 31) return { className: 'danger', label: '危険' };
    if (value >= 28) return { className: 'severe', label: '厳重警戒' };
    if (value >= 25) return { className: 'warning', label: '警戒' };
    if (value >= 21) return { className: 'attention', label: '注意' };
    return { className: 'safe', label: 'ほぼ安全' };
  }

  function getAlertPresentation(alert) {
    if (alert.flag === 3) {
      return { className: 'special', text: '熱中症特別警戒アラート発表中' };
    }
    if (alert.flag === 1) {
      return { className: 'warning', text: '熱中症警戒アラート発表中' };
    }
    if (alert.flag === 0) {
      return { className: 'none', text: '発表なし' };
    }
    if (alert.flag === 2) {
      return { className: 'unknown', text: '特別警戒情報を確認中' };
    }
    return { className: 'unknown', text: '確認不能' };
  }

  function formatDateTime(value) {
    const date = value instanceof Date ? value : new Date(value);
    if (Number.isNaN(date.getTime())) return '--';
    return dateTimeFormatter.format(date);
  }

  function renderForecast(containerId, maximumId, maximumTimeId, values, emptyMessage) {
    const container = $(containerId);
    if (!container) return;

    container.replaceChildren();

    if (!Array.isArray(values) || values.length === 0) {
      const emptyElement = document.createElement('div');
      emptyElement.className = 'empty';
      emptyElement.textContent = emptyMessage;
      container.append(emptyElement);
      $(maximumId).textContent = '最高 --';
      $(maximumTimeId).textContent = '最高時刻：--';
      return;
    }

    for (const item of values.slice(0, 6)) {
      const slot = document.createElement('div');
      const time = document.createElement('time');
      const value = document.createElement('b');
      slot.className = 'slot';
      time.textContent = timeFormatter.format(item.at);
      value.textContent = `${item.value}℃`;
      slot.append(time, value);
      container.append(slot);
    }

    const maximum = values.reduce((currentMaximum, item) =>
      item.value > currentMaximum.value ? item : currentMaximum
    );

    $(maximumId).textContent = `最高 ${maximum.value}℃`;
    $(maximumTimeId).textContent = `最高時刻：${timeFormatter.format(maximum.at)}`;
  }

  function setStaleBanner(ageMilliseconds) {
    const banner = $('stale');
    if (!banner) return;

    if (ageMilliseconds >= C.stale30) {
      banner.hidden = false;
      banner.className = 'critical';
      banner.textContent = '前回取得データ｜30分以上、最新情報を取得できていません';
      return;
    }

    if (ageMilliseconds >= C.stale15) {
      banner.hidden = false;
      banner.className = '';
      banner.textContent = '前回取得データ｜最新情報を取得できていません';
      return;
    }

    if (ageMilliseconds > 0) {
      banner.hidden = false;
      banner.className = '';
      banner.textContent = '前回取得データ｜最新データの取得に失敗しました';
      return;
    }

    banner.hidden = true;
    banner.className = '';
    banner.textContent = '';
  }

  function renderModel(model, usingStoredData = false) {
    const alertPresentation = getAlertPresentation(model.alert);
    const wbgtRank = getWbgtRank(
      model.observation ? model.observation.value : null
    );

    if ($('alert')) $('alert').className = `alert-panel ${alertPresentation.className}`;
    if ($('alertText')) $('alertText').textContent = alertPresentation.text;
    if ($('alertTime')) {
      $('alertTime').textContent = `発表日時：${
        model.alert.published ? formatDateTime(model.alert.published) : '確認不能'
      }`;
    }

    $('wbgt').className = `wbgt-panel ${wbgtRank.className}`;
    $('value').textContent = model.observation
      ? model.observation.value.toFixed(1)
      : '--';
    $('rank').textContent = wbgtRank.label;
    $('obsTime').textContent = `対象時刻：${
      model.observation ? formatDateTime(model.observation.at) : '欠測または観測時刻前'
    }`;

    const forecastValues = model.forecast.values.map((item) => ({
      at: item.at instanceof Date ? item.at : new Date(item.at),
      value: item.value
    }));

    const todayValues = forecastValues.filter(
      (item) => getJapanDateKey(item.at) === getJapanDateKey()
    );
    const tomorrowValues = forecastValues.filter(
      (item) => getJapanDateKey(item.at) === getTomorrowJapanDateKey()
    );

    renderForecast('today', 'todayMax', 'todayAt', todayValues, '当日の予測を確認できません');
    renderForecast('tom', 'tomMax', 'tomAt', tomorrowValues, '翌日の予測はまだ発表されていません');

    $('generated').textContent = model.generatedAt
      ? formatDateTime(model.generatedAt)
      : '--';
    $('success').textContent = formatDateTime(model.fetchedAt);

    setStaleBanner(
      usingStoredData ? Math.max(1, Date.now() - model.fetchedAt) : 0
    );
  }

  function buildModel(payload) {
    if (!payload || payload.schemaVersion !== 1 || !payload.official) {
      throw new Error('data/current.jsonがまだ生成されていません');
    }

    if (payload.pointCode && String(payload.pointCode) !== String(C.pointCode)) {
      throw new Error('JSONの地点コードが一致しません');
    }

    const forecast = parseForecastCsv(payload.official.forecastCsv);
    const observation = parseActualCsv(payload.official.actualCsv);
    let alert;

    try {
      alert = parseAlertCsvs(payload.official.alertCsvs);
    } catch (error) {
      console.warn('アラート情報を解析できないため、確認不能として表示します', error);
      alert = { flag: 9, published: null };
    }

    return {
      generatedAt: payload.generatedAt || null,
      forecast,
      observation,
      alert,
      fetchedAt: Date.now()
    };
  }

  function saveToLocalStorage(model) {
    try {
      localStorage.setItem(C.storageKey, JSON.stringify(model));
    } catch (error) {
      console.error('前回データの保存に失敗しました', error);
    }
  }

  function loadFromLocalStorage() {
    try {
      const rawValue = localStorage.getItem(C.storageKey);
      if (!rawValue) return null;

      const model = JSON.parse(rawValue);
      if (!model || !Number.isFinite(model.fetchedAt) || !model.alert || !model.forecast) {
        throw new Error('保存データの形式が不正です');
      }

      if (model.alert.published) model.alert.published = new Date(model.alert.published);
      if (model.observation?.at) model.observation.at = new Date(model.observation.at);
      model.forecast.values = model.forecast.values.map((item) => ({
        ...item,
        at: new Date(item.at)
      }));

      return model;
    } catch (error) {
      console.error('破損した前回データを削除しました', error);
      localStorage.removeItem(C.storageKey);
      return null;
    }
  }

  async function fetchJson() {
    const controller = new AbortController();
    const timeout = window.setTimeout(() => controller.abort(), C.timeoutMs);

    try {
      const url = `${C.dataUrl}?t=${Date.now()}`;
      const response = await fetch(url, {
        method: 'GET',
        signal: controller.signal,
        cache: 'no-store',
        headers: { Accept: 'application/json' }
      });

      if (!response.ok) {
        throw new Error(`データJSON HTTP ${response.status}`);
      }

      return await response.json();
    } finally {
      window.clearTimeout(timeout);
    }
  }

  function renderInitialFailure() {
    if ($('alert')) $('alert').className = 'alert-panel unknown';
    if ($('alertText')) $('alertText').textContent = '情報取得不能';
    if ($('alertTime')) $('alertTime').textContent = '発表日時：--';

    $('wbgt').className = 'wbgt-panel unknown';
    $('value').textContent = '--';
    $('rank').textContent = '判定不能';
    $('obsTime').textContent = '対象時刻：--';

    renderForecast('today', 'todayMax', 'todayAt', [], '当日の予測を確認できません');
    renderForecast('tom', 'tomMax', 'tomAt', [], '翌日の予測を確認できません');

    $('generated').textContent = '--';
    $('success').textContent = '--';

    const banner = $('stale');
    if (banner) {
      banner.hidden = false;
      banner.className = 'critical';
      banner.textContent = '最新情報を表示できません。公式情報を確認してください';
    }
  }

  async function refreshData() {
    if (requestInProgress) return;
    requestInProgress = true;

    $('net').textContent = '● 取得中';
    $('net').className = '';

    try {
      const payload = await fetchJson();
      const model = buildModel(payload);
      lastSuccessfulFetchTime = model.fetchedAt;
      saveToLocalStorage(model);
      renderModel(model, false);
      $('net').textContent = '● 通信正常';
      $('net').className = 'ok';
    } catch (error) {
      console.error('情報の取得または解析に失敗しました', error);
      $('net').textContent = '● 通信失敗';
      $('net').className = 'ng';

      const storedModel = loadFromLocalStorage();
      if (storedModel) {
        lastSuccessfulFetchTime = storedModel.fetchedAt;
        renderModel(storedModel, true);
      } else {
        renderInitialFailure();
      }
    } finally {
      requestInProgress = false;
      nextFetchTime = Date.now() + C.refreshMs;
    }
  }

  function updateClock() {
    $('clock').textContent = dateTimeFormatter.format(new Date());
    $('next').textContent = nextFetchTime ? formatDateTime(nextFetchTime) : '--';

    if (lastSuccessfulFetchTime > 0) {
      const age = Date.now() - lastSuccessfulFetchTime;
      if ($('net').classList.contains('ng') || age >= C.stale15) {
        setStaleBanner(age);
      }
    }
  }

  document.addEventListener('visibilitychange', () => {
    if (!document.hidden && Date.now() - lastSuccessfulFetchTime >= C.refreshMs) {
      refreshData().catch(console.error);
    }
  });

  window.addEventListener('online', () => refreshData().catch(console.error));

  window.addEventListener('error', (event) => {
    console.error('JavaScript例外', event.error || event.message);
  });

  window.addEventListener('unhandledrejection', (event) => {
    console.error('未処理のPromise例外', event.reason);
  });

  const storedModel = loadFromLocalStorage();
  if (storedModel) {
    lastSuccessfulFetchTime = storedModel.fetchedAt;
    renderModel(storedModel, true);
  }

  updateClock();
  refreshData().catch(console.error);
  window.setInterval(() => refreshData().catch(console.error), C.refreshMs);
  window.setInterval(updateClock, 1000);

  window.WBGT_TEST = { getWbgtRank };
})();

"use strict";

(() => {
  const rink = document.documentElement.dataset.rink;
  if (!["253", "300", "112"].includes(rink)) return;

  const get = id => document.getElementById(id);
  const decoder = new TextDecoder("utf-8", {fatal: true});
  const encoder = new TextEncoder();
  const entryPath = location.pathname;
  const root = new URL("./", location.href);
  const zone = "Asia/Yekaterinburg";
  const clock = new Intl.DateTimeFormat("ru-RU", {timeZone: zone, day:"numeric", month:"short", hour:"2-digit", minute:"2-digit"});
  const dateLabel = new Intl.DateTimeFormat("ru-RU", {timeZone: zone, weekday:"short", day:"numeric", month:"short"});
  const fullDate = new Intl.DateTimeFormat("ru-RU", {timeZone: "UTC", day:"numeric", month:"long", year:"numeric"});
  const localDay = new Intl.DateTimeFormat("en-CA", {timeZone:zone, year:"numeric", month:"2-digit", day:"2-digit"});
  const counts = new Intl.NumberFormat("ru-RU");
  const hour = 60 * 60 * 1000;
  let accessKey = null;
  let attemptToken = 0;
  let inFlight = false;
  let previousCheck = 0;
  let lastUpdate = null;
  let renderedDay = "";
  let archiveUrl = null;
  let assetRequest = 0;
  let listedWeek;

  const files = [
    {filename:"season.pdf.enc", title:"Сезонный отчёт 2025/26", type:"application/pdf"},
    {filename:"week-W07.html.enc", week:"2026-W07", title:"Недельный отчёт за 9-15 февраля 2026", type:"text/html"},
    {filename:"week-W03.html.enc", week:"2026-W03", title:"Недельный отчёт за 12-18 января 2026", type:"text/html"}
  ];

  function add(parent, tag, value, className) {
    const item = document.createElement(tag);
    if (value !== undefined) item.textContent = value;
    if (className) item.className = className;
    parent.append(item);
    return item;
  }

  function showMessage(id, value) {
    const el = get(id);
    el.textContent = value;
    el.hidden = !value;
  }

  function asInstant(input) {
    if (typeof input !== "string" || !/(?:Z|[+-]\d\d:\d\d)$/.test(input)) return null;
    const value = new Date(input);
    return Number.isNaN(value.getTime()) ? null : value;
  }

  function localDate(value) {
    if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return "";
    const d = new Date(value + "T12:00:00+05:00");
    return Number.isNaN(d.getTime()) ? "" : dateLabel.format(d);
  }

  function nextScheduledAttempt() {
    const at = asInstant(lastUpdate?.attempted_at);
    if (!at) return null;
    const next = new Date(at);
    next.setUTCMinutes(49, 0, 0);
    if (next <= at) next.setTime(next.getTime() + hour);
    return next;
  }

  function tick() {
    if (!lastUpdate) return;
    const expected = nextScheduledAttempt();
    const current = localDay.format(new Date());
    if (current !== renderedDay && lastUpdate.report) {
      renderedDay = current;
      showToday(lastUpdate.report, current);
      showWeek(lastUpdate.report, current, lastUpdate.week_published_at);
    }
    showMessage("age-warning", expected && Date.now() > expected.getTime()
      ? "Обновление по расписанию на " + clock.format(expected) + " ещё не поступило. Перед решением сверьте сведения с площадкой." : "");
  }

  function sourceCaption(report) {
    const source = [report.source];
    const asOf = asInstant(report.as_of);
    const fetched = asInstant(report.fetched_at);
    if (asOf) source.push("срез по состоянию на " + clock.format(asOf));
    if (fetched) source.push("ответ получен " + clock.format(fetched));
    return source.filter(Boolean).join(" · ");
  }

  function showToday(report, current) {
    const body = get("today-content");
    body.replaceChildren();
    const today = report.today || {};
    get("report-date").textContent = localDate(current);
    get("data-source").textContent = sourceCaption(report);
    if (today.date !== current) {
      get("summary").textContent = "Срез на сегодняшнюю смену ещё не поступил.";
      if (today.date) add(body, "p", "Последнее наблюдение за " + localDate(today.date) + ". Перед сменой уточните статус площадки.", "muted");
      return;
    }
    get("summary").textContent = report.summary || "";
    if (report.advice) add(body, "p", report.advice);
    if (today.scope) add(body, "p", today.scope, "caption");
    if (today.checks != null || today.prior_checks != null) {
      const stats = add(body, "dl", undefined, "stats");
      for (const [date, n] of [[today.date,today.checks], [today.prior_date,today.prior_checks]]) {
        const group = add(stats, "div");
        add(group, "dt", `Чеки · ${localDate(date)}`);
        add(group, "dd", Number.isInteger(n) ? counts.format(n) : "Нет данных");
      }
    }
    if (Array.isArray(report.limitations) && report.limitations.length) {
      const note = add(body, "details");
      add(note, "summary", "Что учтено в рекомендации");
      const list = add(note, "ul");
      report.limitations.forEach(item => add(list, "li", item));
    }
  }

  function showWeek(report, current, publishedAt) {
    const body = get("week-content");
    body.replaceChildren();
    if (!Array.isArray(report.week) || !report.week.length) {
      add(body, "p", "План появится после первого доступного среза.");
      return;
    }
    const monday = new Date(current + "T12:00:00Z");
    monday.setUTCDate(monday.getUTCDate() - (monday.getUTCDay()+6)%7);
    const mondayIso = monday.toISOString().slice(0,10);
    const sunday = new Date(monday);
    sunday.setUTCDate(sunday.getUTCDate()+6);
    const sundayIso = sunday.toISOString().slice(0,10);
    const days = report.week.filter(day=>day.date >= mondayIso && day.date <= sundayIso);
    if (!days.length) {
      add(body,"p","План на неделю с " + localDate(mondayIso) + " ещё не поступил.");
      return;
    }
    const published = asInstant(publishedAt || report.week_published_at);
    if (published) add(body, "p", "План подготовлен " + clock.format(published) + " по Екатеринбургу.", "caption");
    let container = body;
    if (!days.some(d => Number.isInteger(d.checks) && d.checks > 0)) {
      add(body, "p", "На неделю с " + localDate(mondayIso) + " по " + localDate(sundayIso) + " пока нет наблюдений для выбора часов усиления. Действующий график смен остаётся ориентиром. Проверяем Lime каждый час.");
      container = add(body, "details");
      add(container, "summary", "Показать сопоставимые дни");
    }
    const list = add(container, "ul", undefined, "week-list");
    for (const day of days) {
      const row = add(list, "li");
      add(row, "p", localDate(day.date), "week-date");
      const detail = add(row, "div");
      add(detail, "p", day.advice);
      if (day.reference) {
        let reference = `Основание: ${localDate(day.reference)}`;
        if (Number.isInteger(day.hour) && Number.isInteger(day.checks)) {
          reference += `, пик с ${String(day.hour).padStart(2,"0")}:00 до ${String((day.hour+1)%24).padStart(2,"0")}:00, чеков: ${counts.format(day.checks)}`;
        }
        add(detail, "p", reference, "week-reference");
      }
    }
  }

  function render(payload) {
    lastUpdate = payload;
    get("gate").hidden = true;
    get("report").hidden = false;
    const triedAt = asInstant(payload.attempted_at);
    const lastSuccess = asInstant(payload.last_success_at);
    const stamps = ["Екатеринбург"];
    if (triedAt) stamps.push("проверка " + clock.format(triedAt));
    if (lastSuccess) stamps.push("последний успешный срез " + clock.format(lastSuccess));
    get("checked").textContent = stamps.join(" · ");
    let error = "";
    if (payload.status === "error") {
      error = "Обновление источника не удалось.";
      if (payload.report) error += " Показаны последние полученные данные.";
      if (payload.error) error += " " + String(payload.error);
    }
    showMessage("connection", error);
    showFiles(payload.latest_week);
    renderedDay = localDay.format(new Date());
    if (payload.report) {
      showToday(payload.report, renderedDay);
      showWeek(payload.report, renderedDay, payload.week_published_at);
    } else {
      get("report-date").textContent = "";
      get("summary").textContent = "Данные на сегодня ещё не поступили.";
      get("today-content").replaceChildren();
      get("data-source").textContent = "";
      showWeek({});
    }
    tick();
  }

  function parseKey(input) {
    let value = String(input || "").trim();
    if (value.includes("#")) value = value.slice(value.indexOf("#") + 1);
    if (value.startsWith("k=")) value = new URLSearchParams(value).get("k") || "";
    if (!/^[A-Za-z0-9_-]{43}$/.test(value)) throw Error("key");
    return value;
  }

  function getBytes(value) {
    return Uint8Array.from(atob(value.replaceAll("-", "+").replaceAll("_", "/")+"="), c=>c.charCodeAt(0));
  }

  async function download(filename, key, bypassCache=false) {
    const url = new URL(filename, root);
    if (filename === "payload.enc" || bypassCache) url.searchParams.set("v", String(Date.now()));
    let response;
    try {
      response = await fetch(url, {cache:"no-store", credentials:"omit", referrerPolicy:"no-referrer"});
      if (!response.ok) throw Error();
    } catch {throw Error("network");}
    let packed;
    try {packed = new Uint8Array(await response.arrayBuffer());} catch {throw Error("network");}
    if (packed.byteLength < 28) throw Error("content");
    try {
      return await crypto.subtle.decrypt({
        name:"AES-GCM", iv:packed.slice(0,12), additionalData:encoder.encode(rink+"/"+filename), tagLength:128
      }, key, packed.slice(12));
    } catch {throw Error("decrypt");}
  }

  async function readPayload(key) {
    const data = await download("payload.enc", key);
    let parsed;
    try {parsed=JSON.parse(decoder.decode(data));} catch {throw Error("content");}
    if (!parsed || String(parsed.rink) !== rink || !asInstant(parsed.attempted_at)
        || !["ok","error"].includes(parsed.status) || (parsed.status === "ok" && !parsed.report)
        || (parsed.report && String(parsed.report.rink) !== rink)) throw Error("content");
    return parsed;
  }

  async function unlock(input) {
    const token = ++attemptToken;
    const submit = get("access-form").querySelector("button");
    let value;
    try {value = parseKey(input);} catch {
      showMessage("gate-message", "Проверьте ключ или откройте полную личную ссылку.");
      return;
    }
    if (!window.crypto?.subtle) {
      showMessage("gate-message", "Для открытия нужен браузер с поддержкой WebCrypto и соединение HTTPS.");
      return;
    }
    submit.disabled = true;
    showMessage("gate-message", "Открываем отчёт…");
    try {
      const key = await crypto.subtle.importKey("raw", getBytes(value), {name:"AES-GCM"}, false, ["decrypt"]);
      const payload = await readPayload(key);
      if (token !== attemptToken) return;
      accessKey = key;
      // The key belongs to this history entry. Other sites on this Pages origin share sessionStorage.
      history.replaceState({rink, entryPath, key:value},"",entryPath+location.search);
      get("access").value = "";
      previousCheck = Date.now();
      render(payload);
    } catch (error) {
      if (token !== attemptToken) return;
      if (error.message === "decrypt") showMessage("gate-message", "Этот ключ не открыл отчёт. Используйте личную ссылку для выбранного катка.");
      else if (error.message === "network") showMessage("gate-message", "Не удалось загрузить отчёт. Проверьте соединение и повторите попытку.");
      else showMessage("gate-message", "Файл отчёта открылся с ошибкой. Повторите попытку после обновления.");
    } finally {
      if (token === attemptToken) submit.disabled = false;
    }
  }

  async function refresh(force=false) {
    if (document.hidden || !accessKey || inFlight || (!force && Date.now()-previousCheck < 60_000)) return;
    inFlight = true;
    previousCheck = Date.now();
    get("refresh").disabled = true;
    const usedKey = accessKey;
    try {
      const fresh = await readPayload(usedKey);
      if (accessKey === usedKey) render(fresh);
    } catch {
      if (accessKey !== usedKey) return;
      showMessage("connection", "Не удалось получить обновление страницы. Показана сохранённая версия этой вкладки.");
      tick();
    } finally {
      inFlight = false;
      get("refresh").disabled = false;
    }
  }

  function closeArchive() {
    get("archive-view").hidden = true;
    get("archive-frame").removeAttribute("src");
    if (archiveUrl) URL.revokeObjectURL(archiveUrl);
    archiveUrl = null;
  }

  async function readAsset(asset, key) {
    let data = await download(asset.filename, key);
    if (!asset.sha256) return data;
    for (let attempt = 0; attempt < 2; attempt++) {
      if (attempt) data = await download(asset.filename, key, true);
      const hash = new Uint8Array(await crypto.subtle.digest("SHA-256", data));
      const hex = Array.from(hash, byte => byte.toString(16).padStart(2, "0")).join("");
      if (hex === asset.sha256) return data;
    }
    throw Error("archive-version");
  }

  async function checkChartPolicy(data, hashes) {
    const template = document.createElement("template");
    template.innerHTML = decoder.decode(data);
    const scripts = template.content.querySelectorAll("script:not([src])");
    for (const script of scripts) {
      if (script.type && !["module", "text/javascript", "application/javascript"].includes(script.type)) continue;
      if (!script.textContent.trim()) continue;
      const hash = new Uint8Array(await crypto.subtle.digest("SHA-256", encoder.encode(script.textContent)));
      if (!hashes.includes("'sha256-" + btoa(String.fromCharCode(...hash)) + "'")) throw Error("reload-page");
    }
  }

  async function openAsset(asset, btn) {
    if (!accessKey || btn.disabled) return;
    btn.disabled = true;
    showMessage("asset-status", "Открываем файл…");
    const usedKey = accessKey;
    const request = ++assetRequest;
    try {
      const decrypted = await readAsset(asset, usedKey);
      if (usedKey !== accessKey || request !== assetRequest) return;
      if (asset.type === "text/html") {
        const hostPolicy = document.querySelector('meta[http-equiv="Content-Security-Policy"]').content;
        const chartHashes = hostPolicy.match(/'sha256-[A-Za-z0-9+/=]+'/g) || [];
        if (asset.sha256) await checkChartPolicy(decrypted, chartHashes);
        if (usedKey !== accessKey || request !== assetRequest) return;
        closeArchive();
        const scriptPolicy = chartHashes.length ? chartHashes.join(" ") : "'none'";
        const policy = `<meta charset="utf-8"><meta name="referrer" content="no-referrer"><meta http-equiv="Content-Security-Policy" content="default-src 'none'; script-src ${scriptPolicy}; style-src 'unsafe-inline'; img-src data:; base-uri 'none'; form-action 'none'">`;
        const cleanHtml = new Blob(["<!doctype html>",policy, decrypted], {type:"text/html;charset=utf-8"});
        archiveUrl = URL.createObjectURL(cleanHtml);
        get("archive-frame").src = archiveUrl;
        get("archive-title").textContent = asset.title;
        get("archive-frame").title = asset.title;
        get("archive-view").hidden = false;
        get("archive-view").scrollIntoView({block:"start"});
        showMessage("asset-status", "");
      } else {
        const url = URL.createObjectURL(new Blob([decrypted], {type:asset.type}));
        const link = add(document.body, "a");
        link.href = url;
        link.download = `Каток-${rink}-сезон-2025-26.pdf`;
        link.click();
        link.remove();
        setTimeout(()=>URL.revokeObjectURL(url), 60_000);
        showMessage("asset-status", "Сезонный PDF передан браузеру для скачивания.");
      }
    } catch (error) {
      if (usedKey !== accessKey || request !== assetRequest) return;
      let message = "Файл не удалось открыть. Проверьте связь и повторите попытку.";
      if (error.message === "archive-version") message = 'Оглавление и файл отчёта разных выпусков. Нажмите "Обновить" и снова откройте отчёт.';
      if (error.message === "reload-page") message = "Для графиков нового выпуска требуется обновить страницу в браузере. Затем снова откройте отчёт.";
      showMessage("asset-status", message);
    }
    finally {btn.disabled = false;}
  }

  function latestAsset(meta) {
    if (!meta || !/^\d{4}-W(?:0[1-9]|[1-4]\d|5[0-3])$/.test(meta.week)
        || !/^[a-f0-9]{64}$/.test(meta.sha256) || !["current","last_verified"].includes(meta.availability)) return null;
    const dates = [meta.date_from, meta.date_to];
    if (!dates.every(d => typeof d === "string" && /^\d{4}-\d{2}-\d{2}$/.test(d))) return null;
    const [from, to] = dates.map(d => new Date(d + "T00:00:00Z"));
    if (!Number.isFinite(+from) || !Number.isFinite(+to)
        || from.toISOString().slice(0,10) !== dates[0] || to.toISOString().slice(0,10) !== dates[1]
        || from.getUTCDay() !== 1 || +to - +from !== 6 * 24 * hour) return null;
    const thursday = new Date(+from + 3 * 24 * hour);
    const year = thursday.getUTCFullYear();
    const weekNo = Math.floor((+thursday - Date.UTC(year,0,1)) / (7 * 24 * hour)) + 1;
    if (meta.week !== year + "-W" + String(weekNo).padStart(2, "0")) return null;
    const archive = files.find(file => file.week === meta.week);
    const title = archive?.title || "Недельный отчёт с " + fullDate.format(from) + " по " + fullDate.format(to);
    return {filename:"week-latest.html.enc", week:meta.week, sha256:meta.sha256, title, type:"text/html"};
  }

  function showFiles(meta) {
    const latest = latestAsset(meta);
    const signature = latest ? [latest.week,latest.sha256,meta.availability].join("/") : "";
    if (listedWeek === signature) return;
    listedWeek = signature;
    const container = get("asset-links");
    container.replaceChildren();
    if (latest) {
      add(container, "p", "Последний проверенный полный недельный отчёт", "caption");
      fileButton(latest);
      if (meta.availability === "last_verified") {
        add(container, "p", "При последней проверке реестр выпусков был недоступен. Здесь сохранён ранее проверенный отчёт.", "caption");
      }
    }
    for (const file of files) {
      if (!latest || file.week !== latest.week) fileButton(file);
    }
    function fileButton(asset) {
      const row = add(container, "div", undefined, "asset-row");
      const btn = add(row,"button",asset.title + (asset.type === "application/pdf" ? " · скачать PDF" : ""));
      btn.type = "button";
      btn.addEventListener("click",()=>openAsset(asset,btn));
    }
  }
  get("close-archive").addEventListener("click", ()=>{
    ++assetRequest;
    closeArchive();
    showMessage("asset-status", "");
  });
  get("lock-report").addEventListener("click",()=>{
    ++attemptToken;
    accessKey = null;
    lastUpdate = null;
    listedWeek = undefined;
    history.replaceState(null, "", entryPath+location.search);
    closeArchive();
    ["checked","connection","age-warning","report-date","summary","today-content","data-source","week-content","asset-links","asset-status","archive-title","gate-message"].forEach(id=>get(id).replaceChildren());
    get("report").hidden = true;
    get("gate").hidden = false;
    get("access").value = "";
    get("access").focus();
  });
  get("refresh").addEventListener("click", ()=>refresh(true));
  get("access-form").addEventListener("submit",e=>{e.preventDefault();unlock(get("access").value);});
  window.addEventListener("hashchange",()=>{if (location.hash) unlock(location.hash);});
  window.addEventListener("focus", ()=>refresh());
  document.addEventListener("visibilitychange",()=>{if (!document.hidden) refresh();});
  setInterval(()=>{
    tick();
    const expected = nextScheduledAttempt();
    if ((expected && Date.now() >= expected.getTime()) || Date.now()-previousCheck >= hour) refresh();
  }, 60_000);
  const entry = history.state;
  const stored = entry && entry.rink === rink && entry.entryPath === entryPath && entry.key;
  if (location.hash || stored) unlock(location.hash || stored);
})();

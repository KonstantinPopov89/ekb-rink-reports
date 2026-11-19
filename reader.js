"use strict";

(() => {
  const rink = document.documentElement.dataset.rink;
  if (!["253", "300", "112"].includes(rink)) return;

  const get = id => document.getElementById(id);
  const decoder = new TextDecoder("utf-8", {fatal: true});
  const encoder = new TextEncoder();
  const cacheKey = `rink-director-key:${location.pathname.replace(/index\.html$/, "")}`;
  const root = new URL("./", location.href);
  const zone = "Asia/Yekaterinburg";
  const clock = new Intl.DateTimeFormat("ru-RU", {timeZone: zone, day:"numeric", month:"short", hour:"2-digit", minute:"2-digit"});
  const dateLabel = new Intl.DateTimeFormat("ru-RU", {timeZone: zone, weekday:"short", day:"numeric", month:"short"});
  const localDay = new Intl.DateTimeFormat("en-CA", {timeZone:zone, year:"numeric", month:"2-digit", day:"2-digit"});
  const counts = new Intl.NumberFormat("ru-RU");
  const hour = 60 * 60 * 1000;
  let accessKey = null;
  let attemptToken = 0;
  let inFlight = false;
  let previousCheck = 0;
  let lastUpdate = null;
  let archiveUrl = null;

  const files = [
    {filename:"season.pdf.enc", title:"Сезонный отчёт 2025/26", type:"application/pdf"},
    {filename:"week-W07.html.enc", title:"Недельный отчёт за 9-15 февраля 2026", type:"text/html"},
    {filename:"week-W03.html.enc", title:"Недельный отчёт за 12-18 января 2026", type:"text/html"}
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

  function tick() {
    if (!lastUpdate) return;
    const at = asInstant(lastUpdate.attempted_at);
    const stale = at && Date.now() - at.getTime() > 2 * hour;
    const oldDay = lastUpdate.report?.today?.date && lastUpdate.report.today.date !== localDay.format(new Date());
    let notice = stale ? "Страница пропустила не менее двух часовых интервалов. Сверьте сведения с площадкой перед решением." : "";
    if (oldDay) notice += (notice ? " " : "") + "Показан срез за другой день. Состояние текущей смены нужно уточнить.";
    showMessage("age-warning", notice);
  }

  function showToday(report) {
    const body = get("today-content");
    body.replaceChildren();
    const today = report.today || {};
    get("report-date").textContent = localDate(today.date);
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
    const source = [report.source];
    const asOf = asInstant(report.as_of);
    const fetched = asInstant(report.fetched_at);
    if (asOf) source.push("срез по состоянию на " + clock.format(asOf));
    if (fetched) source.push("ответ получен " + clock.format(fetched));
    get("data-source").textContent = source.filter(Boolean).join(" · ");
  }

  function showWeek(report) {
    const body = get("week-content");
    body.replaceChildren();
    if (!Array.isArray(report.week) || !report.week.length) {
      add(body, "p", "План появится после первого доступного среза.");
      return;
    }
    const list = add(body, "ul", undefined, "week-list");
    for (const day of report.week) {
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
    if (payload.status === "error" && lastSuccess) stamps.push("последний успешный срез " + clock.format(lastSuccess));
    get("checked").textContent = stamps.join(" · ");
    let error = "";
    if (payload.status === "error") {
      error = "Обновление источника не удалось.";
      if (payload.report) error += " Показаны последние полученные данные.";
      if (payload.error) error += " " + String(payload.error);
    }
    showMessage("connection", error);
    if (payload.report) {
      showToday(payload.report);
      showWeek(payload.report);
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

  async function download(filename, key) {
    const url = new URL(filename, root);
    if (filename === "payload.enc") url.searchParams.set("v", String(Date.now()));
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
      try {sessionStorage.setItem(cacheKey, value);} catch { /* Restricted browser storage. */ }
      if (location.hash) history.replaceState(null,"",location.pathname+location.search);
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
    try {render(await readPayload(accessKey));} catch {
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

  async function openAsset(asset, btn) {
    if (!accessKey || btn.disabled) return;
    btn.disabled = true;
    showMessage("asset-status", "Открываем файл…");
    try {
      const decrypted = await download(asset.filename, accessKey);
      if (asset.type === "text/html") {
        closeArchive();
        const policy = "<meta charset='utf-8'><meta name='referrer' content='no-referrer'><meta http-equiv='Content-Security-Policy' content=\"default-src 'none'; style-src 'unsafe-inline'; img-src data:; base-uri 'none'; form-action 'none'\">";
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
    } catch {showMessage("asset-status", "Файл не удалось открыть. Проверьте связь и повторите попытку.");}
    finally {btn.disabled = false;}
  }

  for (const asset of files) {
    const row = add(get("asset-links"), "div", undefined, "asset-row");
    const btn = add(row,"button",asset.title + (asset.type === "application/pdf" ? " · скачать PDF" : ""));
    btn.type = "button";
    btn.addEventListener("click",()=>openAsset(asset,btn));
  }
  get("close-archive").addEventListener("click", closeArchive);
  get("refresh").addEventListener("click", ()=>refresh(true));
  get("access-form").addEventListener("submit",e=>{e.preventDefault();unlock(get("access").value);});
  window.addEventListener("hashchange",()=>{if (location.hash) unlock(location.hash);});
  window.addEventListener("focus", ()=>refresh());
  document.addEventListener("visibilitychange",()=>{if (!document.hidden) refresh();});
  setInterval(()=>{ tick(); if (Date.now()-previousCheck >= hour) refresh(); }, 60_000);
  let stored;
  try {stored = sessionStorage.getItem(cacheKey);} catch { /* Private mode may disable storage. */ }
  if (location.hash || stored) unlock(location.hash || stored);
})();

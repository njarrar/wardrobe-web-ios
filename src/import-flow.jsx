import { useCallback, useEffect, useRef, useState } from "react";
import { ArrowCounterClockwise, Camera, Check, Crop, Plus, SpinnerGap, Trash, TShirt, UploadSimple, WarningCircle, X } from "@phosphor-icons/react";
import { apiFetch, assetUrl } from "./api.js";
import { askAiConsent, useAiSetup } from "./ai-setup.js";
import "./import-flow.css";
import { t, tn } from "./i18n.js";
import { dropPhoto, newPhoto, queuedPhotos, savePhoto } from "./import-queue.js";

const API = "/api/import/jobs";
const PARTS = [
  ["upperbody", "Tops"],
  ["wholebody_up", "Jackets"],
  ["lowerbody", "Bottoms"],
  ["accessories_up", "Accessories"],
  ["shoes", "Shoes"],
];
const HEX_COLOR = /^#[0-9a-f]{6}$/i;

const fileToDataUrl = (file) => new Promise((resolve, reject) => {
  const reader = new FileReader();
  reader.onload = () => resolve(reader.result);
  reader.onerror = () => reject(reader.error || new Error(t("Could not read that image.")));
  reader.readAsDataURL(file);
});

const MAX_UPLOAD_EDGE = 2048;

// Phones hand over large JPEG or HEIC photos with rotation stored in EXIF.
// Redraw them upright, capped at 2048px, as PNG so both servers get the same input.
async function prepareImage(file) {
  try {
    const bitmap = await createImageBitmap(file, { imageOrientation: "from-image" });
    const scale = Math.min(1, MAX_UPLOAD_EDGE / Math.max(bitmap.width, bitmap.height));
    const canvas = document.createElement("canvas");
    canvas.width = Math.max(1, Math.round(bitmap.width * scale));
    canvas.height = Math.max(1, Math.round(bitmap.height * scale));
    canvas.getContext("2d").drawImage(bitmap, 0, 0, canvas.width, canvas.height);
    bitmap.close?.();
    return canvas.toDataURL("image/png");
  } catch {
    return fileToDataUrl(file);
  }
}

const canUseCamera = () => typeof window !== "undefined" && window.matchMedia?.("(pointer: coarse)").matches;

// One photo may take this long before the queue moves on, and the Skip
// button shows after SLOW_AFTER_MS. Tests shorten both.
const READ_LIMIT_MS = Number(globalThis.WARDROBE_READ_LIMIT_MS) || 150000;
const SLOW_AFTER_MS = Number(globalThis.WARDROBE_SLOW_AFTER_MS) || 25000;

async function api(path, options) {
  const response = await apiFetch(path, {
    ...options,
    headers: { "Content-Type": "application/json", ...(options?.headers || {}) },
  });
  const value = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(value.error || t("The import job could not be updated."));
  return value;
}

function deriveStatus(job) {
  const crop = job.stages?.crop;
  const garment = job.stages?.garment;
  if (job.error || crop?.status === "failed" || garment?.status === "failed") return { tone: "error", text: t("Import needs attention"), detail: crop?.error || garment?.error || job.error };
  if (garment?.status === "review") return { tone: "ready", text: t("Ready for review") };
  if (crop?.status === "review") return { tone: "ready", text: t("Crop ready for review") };
  if (crop?.status === "approved") return { tone: "processing", text: t("Cutting out the garment") };
  if (crop?.status === "rejected" || garment?.status === "rejected") return { tone: "complete", text: t("Import declined") };
  return { tone: "processing", text: t("Finding clothes in the photo") };
}

function reviewStageFor(job) {
  if (job.stages?.garment?.status === "review") return "garment";
  if (job.stages?.crop?.status === "review") return "crop";
  return null;
}

const isCutting = (job) => job.stages?.crop?.status === "approved" && ["pending", "queued", "processing"].includes(job.stages?.garment?.status);

function defaultDraft(job) {
  const metadata = job.metadata || {};
  return {
    name: metadata.name || t("New piece"),
    part: metadata.part || "upperbody",
    color: metadata.color || "#d8d0c2",
    secondaryColor: metadata.secondaryColor || "",
    tags: Array.isArray(metadata.tags) ? metadata.tags.join(", ") : (metadata.tags || ""),
  };
}

function ReviewEditor({ job, stage, draft, setDraft, busy, onAction }) {
  const asset = job.stages[stage]?.assetUrl;
  const isCrop = stage === "crop";
  const keptBackground = Boolean(job.stages.garment?.keptBackground);
  const primaryValid = HEX_COLOR.test(draft.color);
  const secondaryValid = !draft.secondaryColor || HEX_COLOR.test(draft.secondaryColor);
  return (
    <div className="import-editor">
      <img className="import-editor__preview" src={assetUrl(asset)} alt={isCrop ? t("Detected item crop") : t("Garment cutout")} />
      <div className="import-fields">
        <p className="import-editor__stage">{isCrop ? t("Detected item") : t("Garment image")}</p>
        {isCrop ? <p className="import-card__detail">{t("Check that this crop holds the whole item. Approving it cuts the garment out of its background.")}</p> : (
          <>
            <div className="import-field"><label htmlFor={`name-${job.id}`}>{t("Name")}</label><input id={`name-${job.id}`} value={draft.name} onChange={(event) => setDraft({ ...draft, name: event.target.value })} /></div>
            <div className="import-field"><label htmlFor={`part-${job.id}`}>{t("Category")}</label><select id={`part-${job.id}`} value={draft.part} onChange={(event) => setDraft({ ...draft, part: event.target.value })}>{PARTS.map(([id, label]) => <option value={id} key={id}>{t(label)}</option>)}</select></div>
            <div className="import-field"><label htmlFor={`primary-${job.id}`}>{t("Primary color")}</label><div className="import-color-row"><input id={`primary-${job.id}`} type="color" value={primaryValid ? draft.color : "#000000"} onChange={(event) => setDraft({ ...draft, color: event.target.value })} /><input aria-label={t("Primary color hex")} aria-invalid={!primaryValid} value={draft.color} onChange={(event) => setDraft({ ...draft, color: event.target.value })} /></div>{!primaryValid && <small className="import-field-error">{t("Use a six-digit hex color, such as #d8d0c2.")}</small>}</div>
            <div className="import-field"><label htmlFor={`secondary-${job.id}`}>{t("Secondary color")} <span>{t("optional")}</span></label><input id={`secondary-${job.id}`} type="text" aria-invalid={!secondaryValid} placeholder={t("#hex or leave blank")} value={draft.secondaryColor} onChange={(event) => setDraft({ ...draft, secondaryColor: event.target.value })} />{!secondaryValid && <small className="import-field-error">{t("Use a six-digit hex color or leave this empty.")}</small>}</div>
            <div className="import-field"><label htmlFor={`tags-${job.id}`}>{t("Details")}</label><input id={`tags-${job.id}`} value={draft.tags} placeholder={t("casual, cotton, striped")} onChange={(event) => setDraft({ ...draft, tags: event.target.value })} /></div>
          </>
        )}
        <div className="import-actions">
          <button className="import-button" disabled={busy} onClick={() => onAction("reject")}><Trash size={14} /> {t("Reject")}</button>
          {!isCrop && (keptBackground
            ? <button className="import-button" disabled={busy} onClick={() => onAction("retry")}><ArrowCounterClockwise size={14} /> {t("Remove background")}</button>
            : <button className="import-button" disabled={busy} onClick={() => onAction("use-crop")}><Crop size={14} /> {t("Keep background")}</button>)}
          <button className="import-button import-button--primary" disabled={busy || (!isCrop && (!draft.name.trim() || !primaryValid || !secondaryValid))} onClick={() => onAction("approve")}><Check size={14} weight="bold" /> {isCrop ? t("Use crop") : t("Approve")}</button>
        </div>
      </div>
    </div>
  );
}

export function WardrobeImportFlow({ onGarmentApproved, onStarter, away = false }) {
  const inputRef = useRef(null);
  const [jobs, setJobs] = useState([]);
  const [drafts, setDrafts] = useState({});
  const [dragging, setDragging] = useState(false);
  const [open, setOpen] = useState(false);
  // The camera button in the top bar, and Home, ask for this sheet.
  useEffect(() => {
    const show = () => setOpen(true);
    window.addEventListener("wardrobe:add-clothes", show);
    return () => window.removeEventListener("wardrobe:add-clothes", show);
  }, []);
  const [selectedReviewId, setSelectedReviewId] = useState(null);
  const [busyId, setBusyId] = useState(null);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState(null);
  // Which photo the AI is reading now, so the wait is never silent.
  const [reading, setReading] = useState(null);
  // Picked photos the AI has not read yet (saved on the device).
  const [queue, setQueue] = useState([]);
  const setup = useAiSetup();
  const cameraRef = useRef(null);
  const showCamera = canUseCamera();

  useEffect(() => {
    api(API)
      .then((storedJobs) => {
        const visibleJobs = storedJobs.filter((job) => job.status !== "complete" && job.stages?.crop?.status !== "rejected" && job.stages?.garment?.status !== "rejected");
        setJobs(visibleJobs);
        setDrafts(Object.fromEntries(visibleJobs.map((job) => [job.id, defaultDraft(job)])));
      })
      .catch(() => {});
  }, []);

  const refresh = useCallback(async (id) => {
    try {
      const next = await api(`${API}/${id}`);
      setJobs((current) => current.map((job) => job.id === id ? next : job));
      setDrafts((current) => current[id] ? current : { ...current, [id]: defaultDraft(next) });
    } catch (requestError) { setError(requestError.message); }
  }, []);

  useEffect(() => {
    if (!jobs.some(isCutting)) return undefined;
    const timer = setInterval(() => jobs.filter(isCutting).forEach((job) => refresh(job.id)), 900);
    return () => clearInterval(timer);
  }, [jobs, refresh]);

  // Adds one read photo's pieces to the review list.
  const addJobs = useCallback(async (result, name) => {
    const createdJobs = result.jobs || [result];
    if (!createdJobs.length && result.noClothingDetected) {
      setNotice({ tone: "complete", text: t("No clothing detected"), detail: t("We couldn’t find a piece of clothing in {name}. Try a clearer or closer photo.", { name }) });
      return;
    }
    // One review per piece: the crop is accepted here and the cutout
    // starts right away. A bad crop can still be rejected at review.
    const started = await Promise.all(createdJobs.map(async (job) => {
      if (job.stages?.crop?.status !== "review") return job;
      try { return await api(`${API}/${job.id}/stages/crop/approve`, { method: "POST" }); } catch { return job; }
    }));
    setJobs((current) => [...current, ...started]);
    setDrafts((current) => ({ ...current, ...Object.fromEntries(started.map((job) => [job.id, defaultDraft(job)])) }));
  }, []);

  // Reads the waiting photos one by one. Only one run at a time. A photo
  // that fails stays in the queue, marked failed, for "Try again".
  const running = useRef(false);
  const skipRef = useRef(null);
  const runQueue = useCallback(async () => {
    if (running.current) return;
    running.current = true;
    let lock = null;
    try { lock = await navigator.wakeLock?.request("screen"); } catch { /* the screen may sleep; the queue is saved */ }
    let done = 0;
    try {
      for (;;) {
        const all = await queuedPhotos();
        setQueue(all.map(({ imageDataUrl, ...rest }) => rest));
        const waiting = all.filter((photo) => photo.status === "waiting");
        if (!waiting.length) break;
        const photo = waiting[0];
        setReading({ index: done + 1, total: done + waiting.length, since: Date.now() });
        // A read that hangs, or one the person skips, ends here so the next photo gets its turn.
        let giveUp;
        const stopped = new Promise((resolve, reject) => {
          const timer = setTimeout(() => reject(new Error(t("This photo took too long to read. Try again."))), READ_LIMIT_MS);
          giveUp = (message) => { clearTimeout(timer); reject(new Error(message)); };
          skipRef.current = () => giveUp(t("You skipped this photo."));
        });
        try {
          const request = api(API, { method: "POST", body: JSON.stringify({ imageDataUrl: photo.imageDataUrl, metadata: { name: photo.name.replace(/\.[^.]+$/, "") } }) });
          request.catch(() => {}); // a late failure after a skip is not an error
          const result = await Promise.race([request, stopped]);
          await dropPhoto(photo.id);
          await addJobs(result, photo.name);
        } catch (requestError) {
          await savePhoto({ ...photo, status: "failed", error: requestError.message });
        } finally {
          giveUp?.("");
          skipRef.current = null;
        }
        done += 1;
      }
    } finally {
      running.current = false;
      setReading(null);
      lock?.release?.().catch(() => {});
    }
  }, [addJobs]);

  // Photos left from last time carry on when the app opens or comes back.
  useEffect(() => {
    if (!setup?.ready) return undefined;
    const resume = () => { if (document.visibilityState === "visible") runQueue(); };
    resume();
    document.addEventListener("visibilitychange", resume);
    return () => document.removeEventListener("visibilitychange", resume);
  }, [setup?.ready, runQueue]);

  const submitFiles = useCallback(async (files) => {
    if (!setup?.ready) { setOpen(true); return; }
    const images = [...files].filter((file) => file.type.startsWith("image/") || (!file.type && /\.(jpe?g|png|heic|heif|webp)$/i.test(file.name)));
    if (!images.length) return;
    setDragging(false);
    if (!(await askAiConsent(setup))) return; setError(""); setNotice(null);
    setOpen(true);
    // Save every picked photo first, so none is lost if the app closes.
    for (const file of images) {
      try { await savePhoto(newPhoto(file.name, await prepareImage(file))); } catch (saveError) { setError(saveError.message); }
      setQueue((await queuedPhotos()).map(({ imageDataUrl, ...rest }) => rest));
    }
    runQueue();
  }, [setup, runQueue]);

  const failed = queue.filter((photo) => photo.status === "failed");
  const retryFailed = async () => {
    for (const photo of (await queuedPhotos()).filter((entry) => entry.status === "failed")) await savePhoto({ ...photo, status: "waiting", error: "" });
    runQueue();
  };
  const removeFailed = async () => {
    for (const photo of failed) await dropPhoto(photo.id);
    setQueue((await queuedPhotos()).map(({ imageDataUrl, ...rest }) => rest));
  };

  useEffect(() => {
    let depth = 0;
    const onDragEnter = (event) => { if (![...event.dataTransfer.types].includes("Files")) return; event.preventDefault(); depth += 1; setDragging(true); };
    const onDragOver = (event) => { if ([...event.dataTransfer.types].includes("Files")) event.preventDefault(); };
    const onDragLeave = (event) => { event.preventDefault(); depth = Math.max(0, depth - 1); if (!depth) setDragging(false); };
    const onDrop = (event) => { event.preventDefault(); depth = 0; setDragging(false); submitFiles(event.dataTransfer.files); };
    const onPaste = (event) => { const files = [...event.clipboardData.files]; if (files.some((file) => file.type.startsWith("image/"))) { event.preventDefault(); submitFiles(files); } };
    window.addEventListener("dragenter", onDragEnter); window.addEventListener("dragover", onDragOver); window.addEventListener("dragleave", onDragLeave); window.addEventListener("drop", onDrop); window.addEventListener("paste", onPaste);
    return () => { window.removeEventListener("dragenter", onDragEnter); window.removeEventListener("dragover", onDragOver); window.removeEventListener("dragleave", onDragLeave); window.removeEventListener("drop", onDrop); window.removeEventListener("paste", onPaste); };
  }, [submitFiles]);

  const dropJob = (id) => {
    const remaining = jobs.filter((item) => item.id !== id);
    setJobs((current) => current.filter((item) => item.id !== id));
    setDrafts((current) => Object.fromEntries(Object.entries(current).filter(([key]) => key !== id)));
    setSelectedReviewId(null);
    if (!remaining.length) setOpen(false);
  };

  const perform = async (job, stage, action) => {
    setBusyId(job.id); setError("");
    try {
      if (stage === "garment" && action === "approve") {
        const draft = drafts[job.id];
        const metadata = { ...draft, secondaryColor: draft.secondaryColor || null, tags: draft.tags.split(",").map((tag) => tag.trim()).filter(Boolean) };
        await api(`${API}/${job.id}/metadata`, { method: "PATCH", body: JSON.stringify({ metadata }) });
        const result = await api(`${API}/${job.id}/stages/garment/approve`, { method: "POST" });
        onGarmentApproved?.(result.item);
        dropJob(job.id);
      } else {
        const updated = await api(`${API}/${job.id}/stages/${stage}/${action}`, { method: "POST" });
        if (action === "reject") dropJob(job.id);
        else setJobs((current) => current.map((item) => item.id === job.id ? updated : item));
      }
    } catch (requestError) { setError(requestError.message); }
    finally { setBusyId(null); }
  };

  // Saves every finished piece with the details the AI suggested.
  const approveAll = async () => {
    setError("");
    const ready = jobs.filter((entry) => reviewStageFor(entry) === "garment");
    const approvedIds = new Set();
    for (const job of ready) {
      setBusyId(job.id);
      try {
        const draft = drafts[job.id] || defaultDraft(job);
        const metadata = { ...draft, secondaryColor: draft.secondaryColor || null, tags: draft.tags.split(",").map((tag) => tag.trim()).filter(Boolean) };
        await api(`${API}/${job.id}/metadata`, { method: "PATCH", body: JSON.stringify({ metadata }) });
        const result = await api(`${API}/${job.id}/stages/garment/approve`, { method: "POST" });
        onGarmentApproved?.(result.item);
        approvedIds.add(job.id);
        setJobs((current) => current.filter((entry) => entry.id !== job.id));
        setDrafts((current) => Object.fromEntries(Object.entries(current).filter(([id]) => id !== job.id)));
      } catch (requestError) { setError(requestError.message); }
    }
    setBusyId(null);
    setSelectedReviewId(null);
    if (approvedIds.size && jobs.every((entry) => approvedIds.has(entry.id))) setOpen(false);
  };

  const deleteJob = async (job) => {
    setBusyId(job.id); setError("");
    try {
      await api(`${API}/${job.id}`, { method: "DELETE" });
      const remaining = jobs.filter((item) => item.id !== job.id);
      setJobs(remaining);
      setDrafts((current) => Object.fromEntries(Object.entries(current).filter(([id]) => id !== job.id)));
      if (selectedReviewId === job.id) setSelectedReviewId(null);
      if (!remaining.length) setOpen(false);
    } catch (requestError) { setError(requestError.message); }
    finally { setBusyId(null); }
  };

  const active = jobs[jobs.length - 1];
  const setupRequired = setup?.ready === false;
  const setupMessage = !setup ? null : setup.error
    ? setup.error
    : `${t("Wardrobe uses an AI to find each piece in your photos. Open Settings (the gear at the top), pick Claude, ChatGPT or Gemini, and paste its API key.")}${setup.providerName ? ` ${t("{name} is picked now but has no key.", { name: setup.providerName })}` : ""}`;
  // With no AI key the button still says "Add clothes"; tapping it explains
  // what to set up instead of covering the closet with a warning.
  const activeStatus = active ? deriveStatus(active) : notice;
  const readyCount = jobs.filter((job) => deriveStatus(job).tone === "ready").length;
  const selectedReviewJob = jobs.find((job) => job.id === selectedReviewId && reviewStageFor(job));
  const reviewJob = selectedReviewJob || jobs.find((job) => reviewStageFor(job)) || active;
  const reviewStage = reviewJob ? reviewStageFor(reviewJob) : null;
  const progress = 0;
  const hasImportActivity = Boolean(jobs.length || notice || setupRequired || reading || failed.length);
  // After a while, offer a way out of a photo that does not finish.
  const [slow, setSlow] = useState(false);
  useEffect(() => {
    setSlow(false);
    if (!reading) return undefined;
    const timer = setTimeout(() => setSlow(true), SLOW_AFTER_MS);
    return () => clearTimeout(timer);
  }, [reading?.since]);
  const readingText = reading ? (reading.total > 1 ? t("Reading photo {n} of {total}…", { n: reading.index, total: reading.total }) : t("Reading your photo…")) : "";
  const garmentReady = jobs.filter((job) => reviewStageFor(job) === "garment").length;
  const failedNote = failed.length > 0 && !reading && <div className="import-reading import-reading--failed" role="alert"><WarningCircle size={22} aria-hidden="true" /><div><strong>{tn(failed.length, "{n} photo was not read", "{n} photos were not read")}</strong><p>{failed[failed.length - 1].error}</p><div className="import-actions"><button className="import-button import-button--primary" type="button" onClick={retryFailed}><ArrowCounterClockwise size={14} /> {t("Try again")}</button><button className="import-button" type="button" onClick={removeFailed}>{t("Remove them")}</button></div></div></div>;
  const readingNote = reading && <div className="import-reading" role="status"><SpinnerGap size={22} className="import-spinner" aria-hidden="true" /><div><strong>{readingText}</strong><p>{t("The AI is finding each piece. A photo can take up to a minute. You can leave: photos not read yet are saved and carry on when you open the app again.")}</p>{slow && <div className="import-actions"><button className="import-button" onClick={() => skipRef.current?.()}>{t("Skip this photo")}</button></div>}</div></div>;

  return (
    <>
      <input ref={inputRef} type="file" accept="image/*" multiple hidden disabled={!setup?.ready} onChange={(event) => { submitFiles(event.target.files); event.target.value = ""; }} />
      <input ref={cameraRef} type="file" accept="image/*" capture="environment" hidden disabled={!setup?.ready} onChange={(event) => { submitFiles(event.target.files); event.target.value = ""; }} />
      <div className="import-drop-overlay" data-active={dragging && !setupRequired} aria-hidden={!dragging || setupRequired}><div className="import-drop-target is-over"><UploadSimple size={34} weight="light" /><h2>{t("Drop clothing images")}</h2><p>{t("A single garment or a photo of a full outfit works. Your wardrobe stays exactly where you left it.")}</p></div></div>
      <aside className={`import-tray${jobs.length || notice || reading ? " is-expanded" : ""}${away && !jobs.length && !notice && !reading && !failed.length ? " is-away" : ""}`} aria-label={t("Wardrobe imports")}>
        <button className="import-tray__button" type="button" onClick={() => setupRequired || hasImportActivity || showCamera ? setOpen(true) : inputRef.current?.click()} aria-label={setupRequired ? t("Open setup instructions") : hasImportActivity ? t("Open import progress") : t("Add clothes")}>{reading || activeStatus?.tone === "processing" ? <SpinnerGap size={19} className="import-spinner" /> : activeStatus?.tone === "error" ? <WarningCircle size={19} /> : readyCount ? <span>{readyCount}</span> : notice ? <X size={18} /> : <Plus size={19} />}</button>
        <div className="import-tray__actions">{active && <img className="import-tray__preview" src={assetUrl(active.stages?.garment?.assetUrl || active.stages?.crop?.assetUrl || active.originalAssetUrl)} alt="" />}<span className="import-tray__label">{readingText || activeStatus?.text || t("Add clothes")}</span>{!setupRequired && showCamera && <button className="import-icon-button" type="button" onClick={() => cameraRef.current?.click()} aria-label={t("Take a photo")}><Camera size={17} /></button>}{!setupRequired && <button className="import-icon-button" type="button" onClick={() => inputRef.current?.click()} aria-label={t("Choose images")}><UploadSimple size={17} /></button>}</div>
      </aside>
      <div className="import-popover-backdrop" data-open={open} onMouseDown={(event) => event.target === event.currentTarget && setOpen(false)}>
        <section className="import-popover" role="dialog" aria-modal="true" aria-labelledby="import-title">
          <header className="import-popover__header"><div><p className="import-popover__eyebrow">{t("Wardrobe import")}</p><h2 className="import-popover__title" id="import-title">{readyCount ? tn(readyCount, "{n} ready for review", "{n} ready for review") : activeStatus?.tone === "error" ? t("Import needs attention") : jobs.length ? t("Preparing new pieces") : reading ? readingText : failed.length ? t("Some photos need another try") : notice?.text || t("Add to your wardrobe")}</h2></div><button className="import-icon-button" type="button" onClick={() => setOpen(false)} aria-label={t("Close import progress")}><X size={20} /></button></header>
          {readingNote}
          {failedNote}
          {!jobs.length ? reading || failed.length ? null : setupRequired ? <div className="import-drop-target import-setup-warning"><WarningCircle size={30} /><h2>{t("Add an AI key first")}</h2><p>{setupMessage}</p>{onStarter && <div className="import-actions"><button className="import-button" onClick={() => { setOpen(false); onStarter(); }}><TShirt size={14} /> {t("Add basics without a photo")}</button></div>}</div> : <div className="import-drop-target"><UploadSimple size={28} /><h2>{notice ? t("Try another image") : t("Choose or paste an image")}</h2><p>{notice?.detail || t("We’ll isolate each clothing item, suggest its details, and hold everything for your approval.")}</p><div className="import-actions"><button className="import-button import-button--primary" disabled={!setup?.ready} onClick={() => { setNotice(null); inputRef.current?.click(); }}>{t("Choose images")}</button>{showCamera && <button className="import-button" disabled={!setup?.ready} onClick={() => { setNotice(null); cameraRef.current?.click(); }}><Camera size={14} /> {t("Take photo")}</button>}{onStarter && <button className="import-button" onClick={() => { setOpen(false); onStarter(); }}><TShirt size={14} /> {t("Basics, no photo")}</button>}</div></div> : (
            <>
              <div className={`import-progress${activeStatus?.tone !== "processing" ? " is-reviewing" : progress < 100 ? " is-indeterminate" : ""}`}><div className="import-progress__meta"><span>{activeStatus?.text}</span><span>{tn(jobs.length, "{n} item", "{n} items")}</span></div>{activeStatus?.tone === "processing" && <div className="import-progress__track"><div className="import-progress__bar" style={{ "--import-progress": `${progress}%` }} /></div>}</div>
              {reviewJob && reviewStage ? <ReviewEditor job={reviewJob} stage={reviewStage} draft={drafts[reviewJob.id] || defaultDraft(reviewJob)} setDraft={(draft) => setDrafts((current) => ({ ...current, [reviewJob.id]: draft }))} busy={busyId === reviewJob.id} onAction={(action) => perform(reviewJob, reviewStage, action)} /> : null}
              <div className="import-card-list">{jobs.map((job) => { const status = deriveStatus(job); const itemName = drafts[job.id]?.name || job.metadata?.name || t("New piece"); const cutoutFailed = job.stages?.garment?.status === "failed"; return <article className={`import-card is-${status.tone}${reviewJob?.id === job.id ? " is-selected" : ""}`} key={job.id}><img className="import-card__image" src={assetUrl(job.stages?.garment?.assetUrl || job.stages?.crop?.assetUrl || job.originalAssetUrl)} alt="" /><div className="import-card__body"><h3 className="import-card__title">{itemName}</h3><p className="import-card__detail import-card__detail--status" data-tone={status.tone}>{status.tone === "error" ? status.detail : status.text}</p></div><div className="import-card__actions">{status.tone === "ready" && <button className="import-icon-button" onClick={() => { setSelectedReviewId(job.id); setOpen(true); }} aria-label={t("Review {name}", { name: itemName })}><Check size={17} /></button>}{cutoutFailed && <button className="import-button import-card__retry" disabled={busyId === job.id} onClick={() => perform(job, "garment", "retry")}><ArrowCounterClockwise size={14} /> {t("Retry")}</button>}{cutoutFailed && <button className="import-button import-card__retry" disabled={busyId === job.id} onClick={() => perform(job, "garment", "use-crop")}><Crop size={14} /> {t("Keep background")}</button>}<button className="import-icon-button import-card__delete" disabled={busyId === job.id} onClick={() => deleteJob(job)} aria-label={t("Remove {name} from the import list", { name: itemName })}><Trash size={16} /></button></div></article>; })}</div>
              <div className="import-actions">{garmentReady > 1 && <button className="import-button import-button--primary" disabled={Boolean(busyId)} onClick={approveAll}><Check size={14} weight="bold" /> {t("Add all {n} to my closet", { n: garmentReady })}</button>}<button className="import-button" onClick={() => inputRef.current?.click()}><Plus size={14} /> {t("Add another")}</button>{showCamera && <button className="import-button" onClick={() => cameraRef.current?.click()}><Camera size={14} /> {t("Take photo")}</button>}</div>
            </>
          )}
          {error && <p className="import-status is-error" role="alert">{error}</p>}
        </section>
      </div>
    </>
  );
}

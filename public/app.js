const SCRIPT_DIR = new URL("./", import.meta.url).href;

const form = document.getElementById("pack-form");
const statusEl = document.getElementById("status");
const btnGenerate = document.getElementById("btn-generate");
const btnDownload = document.getElementById("btn-download");
const hintAfterGenerate = document.getElementById("hint-after-generate");

const pasted1 = document.getElementById("pasted-details-1");
const pasted2 = document.getElementById("pasted-details-2");
const feedback1 = document.getElementById("parse-feedback-1");
const feedback2 = document.getElementById("parse-feedback-2");

/** Label line: `Key- value`, `Key: value`, or Unicode dashes */
const LABEL_LINE = /^(.+?)[-–—:]\s*(.*)$/;

let lastZipBlob = null;
let lastZipName = "agreement-package.zip";
/** When true, prefer server /api/package; falls back to in-browser fill on failure. */
let backendAvailable = true;
/** Variants from last successful template list load (API or static manifest). */
let resolvedVariants = null;

const BLANK_TEMPLATE = `Surname-
Given Name-

Current Address-
Town/City-
District-

State/Province-
Postal /Zipcode-

Mobile Number-
Email Address-

Valid ID type-
Valid ID number-

Nationality-
Date of Birth-

Name of Nominee-
Nominee D. O. B-
Relationship-


Bank Name-
Branch Name-
Bank A/c No-
Ifsc Code-

Aadhar Number-
Aadhar Address-
Father's name-
`;

/** Map alternate label text → canonical key used in buildLabelMap */
const LABEL_ALIASES = {
  "give name": "given name",
  "nominee d o b": "nominee d. o. b",
  "nominee dob": "nominee d. o. b",
  "i.d. type": "valid id type",
  "id type": "valid id type",
  "i.d. number": "valid id number",
  "id number": "valid id number",
  "e-mail address": "email address",
  "e mail address": "email address",
  "pin code": "postal/zipcode",
  "pincode": "postal/zipcode",
  "zip code": "postal/zipcode",
  "zipcode": "postal/zipcode",
};

function canonLabel(raw) {
  return String(raw)
    .replace(/[\u2018\u2019\u201B\u2032\u0060\u00B4]/g, "'")
    .toLowerCase()
    .trim()
    .replace(/\s+/g, " ")
    .replace(/\s*\/\s*/g, "/");
}

function resolveCanonKey(labelPart) {
  const c = canonLabel(labelPart);
  return LABEL_ALIASES[c] || c;
}

/** @param {'first'|'second'} slot */
function buildLabelMap(slot) {
  const p = slot === "first" ? "first_party" : "second_party";
  const r = slot === "first" ? "first_record" : "second_record";
  return {
    surname: `${p}_surname`,
    "given name": `${p}_given_name`,
    "current address": `${p}_current_address`,
    "town/city": `${p}_town_city`,
    district: `${p}_district`,
    "state/province": `${p}_state_province`,
    "postal/zipcode": `${p}_postal_zipcode`,
    "mobile number": `${r}_mobile_number`,
    "email address": `${r}_email_address`,
    "valid id type": `${r}_valid_id_type`,
    "valid id number": `${r}_valid_id_number`,
    nationality: `${r}_nationality`,
    "date of birth": `${r}_date_of_birth`,
    "name of nominee": `${r}_nominee_name`,
    "nominee d. o. b": `${r}_nominee_dob`,
    "nominee d.o.b": `${r}_nominee_dob`,
    relationship: `${r}_nominee_relationship`,
    "bank name": `${r}_bank_name`,
    "branch name": `${r}_branch_name`,
    "bank a/c no": `${r}_bank_account_no`,
    "bank a/c no.": `${r}_bank_account_no`,
    "ifsc code": `${r}_ifsc_code`,
    "aadhar number": `${r}_aadhar_number`,
    "aadhar address": `${r}_aadhar_address`,
    "father's name": `${p}_father_name`,
    "fathers name": `${p}_father_name`,
  };
}

function fieldIdForLabel(labelPart, labelMap) {
  const key = resolveCanonKey(labelPart);
  return labelMap[key] || null;
}

function isKnownNewFieldLine(trimmed, labelMap) {
  const m = trimmed.match(LABEL_LINE);
  if (!m) return false;
  return !!fieldIdForLabel(m[1], labelMap);
}

/**
 * @param {string} text
 * @param {'first'|'second'} slot
 */
function parsePastedBlock(text, slot) {
  const labelMap = buildLabelMap(slot);
  const lines = text.split(/\r?\n/);
  const data = {};
  const unknownLabels = [];
  let i = 0;

  while (i < lines.length) {
    const raw = lines[i];
    const trimmed = raw.trim();
    if (!trimmed) {
      i += 1;
      continue;
    }

    const m = trimmed.match(LABEL_LINE);
    if (!m) {
      i += 1;
      continue;
    }

    const labelPart = m[1].trim();
    let value = m[2].trim();
    const fieldId = fieldIdForLabel(labelPart, labelMap);

    if (!fieldId) {
      unknownLabels.push(labelPart);
      i += 1;
      continue;
    }

    if (value === "") {
      const valueLines = [];
      i += 1;
      while (i < lines.length) {
        const t = lines[i].trim();
        if (!t) {
          valueLines.push("");
          i += 1;
          continue;
        }
        if (isKnownNewFieldLine(t, labelMap)) break;
        valueLines.push(lines[i].trimEnd());
        i += 1;
      }
      value = valueLines.join("\n").trim();
    } else {
      i += 1;
    }

    data[fieldId] = value;
  }

  const p = slot === "first" ? "first_party" : "second_party";
  const r = slot === "first" ? "first_record" : "second_record";
  const fatherKey = `${p}_father_name`;
  const recordFatherKey = `${r}_fathers_name`;
  if (data[fatherKey]) {
    data[recordFatherKey] = data[fatherKey];
  }

  return { data, unknownLabels };
}

function escSelectorName(name) {
  return String(name).replace(/\\/g, "\\\\").replace(/"/g, '\\"');
}

/** Same keys as server.js (order not important). */
const MERGE_FIELD_NAMES = [
  "first_party_surname",
  "first_party_given_name",
  "first_party_so_do",
  "first_party_father_name",
  "first_party_current_address",
  "first_party_town_city",
  "first_party_district",
  "first_party_state_province",
  "first_party_postal_zipcode",
  "second_party_surname",
  "second_party_given_name",
  "second_party_so_do",
  "second_party_father_name",
  "second_party_current_address",
  "second_party_town_city",
  "second_party_district",
  "second_party_state_province",
  "second_party_postal_zipcode",
  "first_record_mobile_number",
  "first_record_email_address",
  "first_record_valid_id_type",
  "first_record_valid_id_number",
  "first_record_nationality",
  "first_record_date_of_birth",
  "first_record_nominee_name",
  "first_record_nominee_dob",
  "first_record_nominee_relationship",
  "first_record_bank_name",
  "first_record_branch_name",
  "first_record_bank_account_no",
  "first_record_ifsc_code",
  "first_record_aadhar_number",
  "first_record_aadhar_address",
  "first_record_fathers_name",
  "second_record_mobile_number",
  "second_record_email_address",
  "second_record_valid_id_type",
  "second_record_valid_id_number",
  "second_record_nationality",
  "second_record_date_of_birth",
  "second_record_nominee_name",
  "second_record_nominee_dob",
  "second_record_nominee_relationship",
  "second_record_bank_name",
  "second_record_branch_name",
  "second_record_bank_account_no",
  "second_record_ifsc_code",
  "second_record_aadhar_number",
  "second_record_aadhar_address",
  "second_record_fathers_name",
];

function mergeDataFromForm(formEl) {
  const data = {};
  for (const key of MERGE_FIELD_NAMES) {
    const el = formEl.querySelector('[name="' + escSelectorName(key) + '"]');
    const v = el && !el.disabled && "value" in el ? el.value : "";
    const str = v == null ? "" : String(v);
    data[key] = str;
    data[key.toUpperCase()] = str;
  }
  return data;
}

function applyDataToForm(data) {
  for (const [name, val] of Object.entries(data)) {
    const el = form.querySelector('[name="' + escSelectorName(name) + '"]');
    if (el && !el.disabled && "value" in el) {
      el.value = val;
    }
  }
}

function invalidateZip() {
  lastZipBlob = null;
  btnDownload.disabled = true;
  hintAfterGenerate.textContent = "";
}

form.addEventListener(
  "input",
  function () {
    invalidateZip();
  },
  true
);

function runExtract(slot) {
  const pastedEl = slot === "first" ? pasted1 : pasted2;
  const parseFeedbackEl = slot === "first" ? feedback1 : feedback2;
  const label = slot === "first" ? "Input 1" : "Input 2";

  parseFeedbackEl.textContent = "";
  parseFeedbackEl.classList.remove("warn");

  const text = pastedEl.value || "";
  if (!text.trim()) {
    parseFeedbackEl.textContent = `Paste your filled text for ${label} first.`;
    parseFeedbackEl.classList.add("warn");
    return;
  }

  const { data, unknownLabels } = parsePastedBlock(text, slot);
  const keys = Object.keys(data);
  if (keys.length === 0) {
    parseFeedbackEl.textContent =
      `No known labels for ${label}. Use lines like Surname- or Surname: (curly apostrophes in Father’s are OK).`;
    parseFeedbackEl.classList.add("warn");
    return;
  }

  applyDataToForm(data);
  invalidateZip();

  let msg = `${label}: filled ${keys.length} field(s). Edit below if needed.`;
  if (unknownLabels.length) {
    const uniq = [...new Set(unknownLabels)];
    msg += ` Unrecognized labels (skipped): ${uniq.join(", ")}`;
    parseFeedbackEl.classList.add("warn");
  }
  parseFeedbackEl.textContent = msg;
}

function setStatus(msg, isError) {
  statusEl.textContent = msg || "";
  statusEl.classList.toggle("error", !!isError);
}

function renderTemplateChoices(list) {
  const fieldset = document.getElementById("template-choices");
  fieldset.querySelectorAll(":scope > *:not(legend)").forEach(function (el) {
    el.remove();
  });

  if (!Array.isArray(list) || list.length === 0) {
    resolvedVariants = null;
    const p = document.createElement("p");
    p.className = "hint warn";
    p.textContent = "No variants in public/templates-manifest.json.";
    fieldset.appendChild(p);
    return;
  }

  resolvedVariants = list;

  list.forEach(function (t) {
    const label = document.createElement("label");
    label.className = "check-label";
    const input = document.createElement("input");
    input.type = "checkbox";
    input.name = "templateIds";
    input.value = t.id;
    input.checked = true;
    label.appendChild(input);
    const span = document.createElement("span");
    span.textContent = t.label || t.id;
    label.appendChild(span);
    fieldset.appendChild(label);
  });
}

document.getElementById("btn-extract-1").addEventListener("click", function () {
  runExtract("first");
});
document.getElementById("btn-extract-2").addEventListener("click", function () {
  runExtract("second");
});

document.getElementById("btn-blank-1").addEventListener("click", function () {
  pasted1.value = BLANK_TEMPLATE;
  feedback1.textContent =
    "Blank labels for Input 1. Replace with your values, then Extract.";
  feedback1.classList.remove("warn");
});
document.getElementById("btn-blank-2").addEventListener("click", function () {
  pasted2.value = BLANK_TEMPLATE;
  feedback2.textContent =
    "Blank labels for Input 2. Replace with your values, then Extract.";
  feedback2.classList.remove("warn");
});

async function loadTemplateChoices() {
  const fieldset = document.getElementById("template-choices");

  async function fetchJson(url) {
    const res = await fetch(url);
    if (!res.ok) {
      throw new Error("HTTP " + res.status);
    }
    return res.json();
  }

  if (window.location.protocol === "file:") {
    const loading = document.getElementById("template-choices-loading");
    if (loading) loading.remove();
    const p = document.createElement("p");
    p.className = "parse-feedback warn";
    p.textContent =
      "Open this app over http(s) (GitHub Pages or npm start). file:// cannot load the template list.";
    fieldset.appendChild(p);
    backendAvailable = false;
    resolvedVariants = null;
    return;
  }

  const apiUrl = new URL("./api/templates", window.location.href).toString();
  try {
    const data = await fetchJson(apiUrl);
    renderTemplateChoices(data.variants || []);
    backendAvailable = true;
    return;
  } catch (_) {
    /* try static manifests (GitHub Pages has no API) */
  }

  const manifestUrls = [
    new URL("templates-manifest.json", SCRIPT_DIR).toString(),
    new URL("../templates/manifest.json", SCRIPT_DIR).toString(),
    new URL("../templates/manifest.json", window.location.href).toString(),
  ];

  for (let i = 0; i < manifestUrls.length; i += 1) {
    try {
      const manifest = await fetchJson(manifestUrls[i]);
      renderTemplateChoices(manifest.variants || []);
      backendAvailable = false;
      setStatus("", false);
      return;
    } catch (_) {
      /* try next URL */
    }
  }

  const loading = document.getElementById("template-choices-loading");
  if (loading) loading.remove();
  const p = document.createElement("p");
  p.className = "parse-feedback warn";
  p.textContent =
    "Could not load template options (API unavailable and templates-manifest.json missing or blocked).";
  fieldset.appendChild(p);
  backendAvailable = false;
  resolvedVariants = null;
}

loadTemplateChoices();

form.addEventListener("submit", function (e) {
  e.preventDefault();
});

function formToUrlEncoded() {
  const params = new URLSearchParams();
  for (const el of form.elements) {
    if (!el.name || el.disabled) continue;
    const tag = el.tagName.toLowerCase();
    const type = (el.type || "").toLowerCase();
    if (type === "file" || type === "submit" || type === "button") continue;
    if (type === "checkbox") {
      if (el.checked) params.append(el.name, el.value || "on");
      continue;
    }
    if (type === "radio") {
      if (el.checked) params.append(el.name, el.value);
      continue;
    }
    if (tag === "select" && el.multiple) {
      for (const opt of el.selectedOptions) {
        params.append(el.name, opt.value);
      }
      continue;
    }
    params.append(el.name, el.value);
  }
  return params.toString();
}

function safeFilePart(s) {
  const t = String(s == null ? "" : s)
    .trim()
    .replace(/[/\\?%*:|\u003c\u003e".\s]+/g, "_")
    .replace(/_+/g, "_")
    .replace(/^_|_$/g, "");
  return t || "party";
}

function pathBasename(p) {
  const s = String(p || "").replace(/\\/g, "/");
  const i = s.lastIndexOf("/");
  return i === -1 ? s : s.slice(i + 1);
}

function uniqueZipEntryName(originalname, used) {
  const base = pathBasename(originalname || "file.docx");
  let name = base || "file.docx";
  let n = 1;
  while (used.has(name)) {
    const dot = name.lastIndexOf(".");
    const ext = dot > 0 ? name.slice(dot) : "";
    const stem = ext ? name.slice(0, -ext.length) : name;
    name = `${stem}_${n}${ext}`;
    n += 1;
  }
  used.add(name);
  return name;
}

function renderDocxToBlob(arrayBuffer, data, Docxtemplater, PizZip) {
  const zip = new PizZip(arrayBuffer);
  const doc = new Docxtemplater(zip, {
    paragraphLoop: true,
    linebreaks: true,
    delimiters: { start: "{{", end: "}}" },
  });
  doc.render(data);
  return doc.getZip().generate({ type: "blob", compression: "DEFLATE" });
}

async function fetchPackageFromServer() {
  const res = await fetch(new URL("./api/package", window.location.href).toString(), {
    method: "POST",
    headers: {
      "Content-Type": "application/x-www-form-urlencoded;charset=UTF-8",
    },
    body: formToUrlEncoded(),
  });
  if (!res.ok) {
    const errText = await res.text();
    throw new Error(errText || res.statusText);
  }
  lastZipBlob = await res.blob();
  lastZipName = "agreement-package.zip";
  const cd = res.headers.get("Content-Disposition");
  if (cd) {
    const m = /filename\*=UTF-8''([^;]+)|filename="([^"]+)"/i.exec(cd);
    if (m) {
      lastZipName = decodeURIComponent(m[1] || m[2] || lastZipName);
    }
  }
}

async function fetchPackageInBrowser() {
  const [{ default: Docxtemplater }, { default: PizZip }, { default: JSZip }] = await Promise.all([
    import("https://esm.sh/docxtemplater@3.68.5"),
    import("https://esm.sh/pizzip@3.2.0"),
    import("https://esm.sh/jszip@3.10.1"),
  ]);

  if (!resolvedVariants || resolvedVariants.length === 0) {
    throw new Error("Template list not loaded. Refresh the page.");
  }

  const byId = new Map(resolvedVariants.map((v) => [v.id, v]));
  const checked = form.querySelectorAll('input[name="templateIds"]:checked');
  const templateIds = [...new Set(Array.from(checked).map((i) => i.value))].filter((id) =>
    byId.has(id)
  );
  if (templateIds.length === 0) {
    throw new Error("Select at least one template.");
  }

  const mergeData = mergeDataFromForm(form);
  const usedNames = new Set();
  const files = [];
  const templatesBase = new URL("../templates/", SCRIPT_DIR).href;

  for (const id of templateIds) {
    const variant = byId.get(id);
    const baseFile = pathBasename(variant.docxFile);
    if (!baseFile || !String(variant.docxFile || "").trim()) {
      throw new Error(`Invalid docxFile in manifest for “${variant.label || id}”.`);
    }

    const templateUrl =
      templatesBase.replace(/\/?$/, "/") + encodeURIComponent(baseFile);
    const tRes = await fetch(templateUrl);
    if (!tRes.ok) {
      throw new Error(
        `Could not load templates/${baseFile} (${tRes.status}). Ensure .docx files are committed and published with the site.`
      );
    }

    const buf = await tRes.arrayBuffer();
    let blob;
    try {
      blob = renderDocxToBlob(buf, mergeData, Docxtemplater, PizZip);
    } catch (err) {
      const msg =
        err && err.properties && err.properties.errors
          ? err.properties.errors.map((e) => e.message).join("; ")
          : err.message;
      throw new Error(`Could not fill “${variant.label || id}” (check {{placeholders}}): ${msg}`);
    }

    const suffix =
      variant.outputSuffix || (variant.id === "legal_vcon" ? "legal_vcon" : "legal");
    let baseName;
    if (variant.filenameParty === "second") {
      baseName = `${safeFilePart(suffix)}.docx`;
    } else {
      baseName = `${safeFilePart(mergeData.first_party_surname)}_${safeFilePart(
        mergeData.first_party_given_name
      )}_${safeFilePart(suffix)}.docx`;
    }
    const entryName = uniqueZipEntryName(baseName, usedNames);
    files.push({ name: entryName, blob });
  }

  const zip = new JSZip();
  for (const f of files) {
    zip.file(f.name, f.blob);
  }
  lastZipBlob = await zip.generateAsync({ type: "blob", compression: "DEFLATE" });
  const stamp = new Date().toISOString().replace(/[:.]/g, "-");
  lastZipName = `agreement-package-${stamp}.zip`;
}

btnGenerate.addEventListener("click", async function () {
  setStatus("");
  hintAfterGenerate.textContent = "";

  const selected = form.querySelectorAll('input[name="templateIds"]:checked');
  if (selected.length === 0) {
    setStatus("Select at least one template.", true);
    return;
  }

  if (!form.reportValidity()) {
    setStatus("Fill required fields in First party and Second party.", true);
    return;
  }

  btnGenerate.disabled = true;
  try {
    if (backendAvailable) {
      try {
        await fetchPackageFromServer();
        btnDownload.disabled = false;
        hintAfterGenerate.textContent = "ZIP is ready — click Download.";
        setStatus("Ready to download.");
        return;
      } catch (_) {
        /* fall through to in-browser packaging */
      }
    }
    await fetchPackageInBrowser();
    btnDownload.disabled = false;
    hintAfterGenerate.textContent = "ZIP is ready — click Download.";
    setStatus("Ready to download.");
  } catch (err) {
    lastZipBlob = null;
    btnDownload.disabled = true;
    setStatus(err.message || "Something went wrong.", true);
  } finally {
    btnGenerate.disabled = false;
  }
});

btnDownload.addEventListener("click", function () {
  if (!lastZipBlob) {
    setStatus("Click “Fill templates (generate ZIP)” first.", true);
    return;
  }
  const url = URL.createObjectURL(lastZipBlob);
  const a = document.createElement("a");
  a.href = url;
  a.download = lastZipName;
  a.click();
  URL.revokeObjectURL(url);
  setStatus("Download started.");
});

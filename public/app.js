(function () {
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
    const loading = document.getElementById("template-choices-loading");
    try {
      if (window.location.protocol === "file:") {
        throw new Error(
          "Open http://localhost:3847 (npm start in agreement-packager). Do not open this HTML as a file."
        );
      }

      const res = await fetch("./api/templates");
      if (!res.ok) {
        const snippet = (await res.text()).replace(/\s+/g, " ").slice(0, 120);
        if (res.status === 404) {
          throw new Error(
            "No ./api/templates on this host — restart locally with npm start, or use the server deployment."
          );
        }
        throw new Error(snippet || "Could not load template options.");
      }
      const data = await res.json();
      const list = data.variants || [];
      if (loading) loading.remove();

      if (list.length === 0) {
        const p = document.createElement("p");
        p.className = "hint warn";
        p.textContent = "No variants in templates/manifest.json.";
        fieldset.appendChild(p);
        return;
      }

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
    } catch (err) {
      if (loading) loading.remove();
      const p = document.createElement("p");
      p.className = "parse-feedback warn";
      const msg =
        err && err.name === "TypeError" && /fetch|Failed to fetch/i.test(String(err.message))
          ? "Could not reach the server. Use http://localhost:3847 after npm start."
          : err.message || "Failed to load templates.";
      p.textContent = msg;
      fieldset.appendChild(p);
    }
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
      const res = await fetch("./api/package", {
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
      const cd = res.headers.get("Content-Disposition");
      lastZipName = "agreement-package.zip";
      if (cd) {
        const m = /filename\*=UTF-8''([^;]+)|filename="([^"]+)"/i.exec(cd);
        if (m) {
          lastZipName = decodeURIComponent(m[1] || m[2] || lastZipName);
        }
      }

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
})();

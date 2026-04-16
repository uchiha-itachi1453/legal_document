"use strict";

const fs = require("fs");
const path = require("path");
const express = require("express");
const archiver = require("archiver");
const PizZip = require("pizzip");
const Docxtemplater = require("docxtemplater");

const PORT = process.env.PORT || 3847;
const MANIFEST_PATH = path.join(__dirname, "public", "templates-manifest.json");
const TEMPLATES_DIR = path.join(__dirname, "templates");

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

function loadVariants() {
  try {
    const raw = fs.readFileSync(MANIFEST_PATH, "utf8");
    const data = JSON.parse(raw);
    if (!data || !Array.isArray(data.variants)) {
      throw new Error("manifest must contain a variants array");
    }
    return data.variants;
  } catch (e) {
    console.warn("manifest read failed, using defaults:", e.message);
    return [
      {
        id: "legal",
        label: "Legal",
        docxFile: "legal.docx",
        outputSuffix: "legal",
        filenameParty: "first",
      },
      {
        id: "legal_vcon",
        label: "Legal VCON",
        docxFile: "legal_vcon.docx",
        outputSuffix: "legal_vcon",
        filenameParty: "first",
      },
      {
        id: "transaction_with_qnet",
        label: "Transaction with QNET",
        docxFile: "transaction_with_qnet.docx",
        outputSuffix: "transaction_with_qnet",
        filenameParty: "second",
      },
    ];
  }
}

function mergeDataFromBody(body) {
  const data = {};
  for (const key of MERGE_FIELD_NAMES) {
    const v = body[key];
    const str = v == null ? "" : String(v);
    data[key] = str;
    // Word templates often use {{FIRST_PARTY_SURNAME}}; docxtemplater is case-sensitive.
    data[key.toUpperCase()] = str;
  }
  return data;
}

function safeFilePart(s) {
  const t = String(s == null ? "" : s)
    .trim()
    .replace(/[/\\?%*:|"<>.\s]+/g, "_")
    .replace(/_+/g, "_")
    .replace(/^_|_$/g, "");
  return t || "party";
}

function renderDocx(templateAbsolutePath, data) {
  const content = fs.readFileSync(templateAbsolutePath);
  const zip = new PizZip(content);
  const doc = new Docxtemplater(zip, {
    paragraphLoop: true,
    linebreaks: true,
    delimiters: { start: "{{", end: "}}" },
  });
  doc.render(data);
  return doc.getZip().generate({
    type: "nodebuffer",
    compression: "DEFLATE",
  });
}

function normalizeTemplateIds(raw) {
  if (raw == null || raw === "") return [];
  if (Array.isArray(raw)) return raw.map(String).filter(Boolean);
  return [String(raw)].filter(Boolean);
}

function uniqueZipEntryName(originalname, used) {
  const base = path.basename(originalname || "file.docx");
  let name = base || "file.docx";
  let n = 1;
  while (used.has(name)) {
    const ext = path.extname(base);
    const stem = ext ? base.slice(0, -ext.length) : base;
    name = `${stem}_${n}${ext}`;
    n += 1;
  }
  used.add(name);
  return name;
}

const app = express();
app.use(express.urlencoded({ extended: true, limit: "2mb" }));

app.get("/api/templates", (req, res) => {
  try {
    const variants = loadVariants();
    res.json({ variants });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

app.post("/api/package", async (req, res) => {
  try {
    const variants = loadVariants();
    const byId = new Map(variants.map((v) => [v.id, v]));
    let templateIds = [
      ...new Set(normalizeTemplateIds(req.body.templateIds)),
    ].filter((id) => byId.has(id));

    if (templateIds.length === 0) {
      res.status(400).send("Select at least one template.");
      return;
    }

    const data = mergeDataFromBody(req.body);
    const usedNames = new Set();
    const files = [];

    for (const id of templateIds) {
      const variant = byId.get(id);
      const docxFile = variant.docxFile;
      if (!docxFile || typeof docxFile !== "string") {
        res.status(500).send(`Invalid docxFile in manifest for “${variant.label || id}”.`);
        return;
      }

      const templatePath = path.join(TEMPLATES_DIR, path.basename(docxFile));
      if (!fs.existsSync(templatePath)) {
        res
          .status(400)
          .send(
            `Template not found: templates/${path.basename(docxFile)}. Add the file and retry.`
          );
        return;
      }

      let buffer;
      try {
        buffer = renderDocx(templatePath, data);
      } catch (err) {
        console.error(err);
        const msg =
          err && err.properties && err.properties.errors
            ? err.properties.errors.map((e) => e.message).join("; ")
            : err.message;
        res
          .status(400)
          .send(
            `Could not fill “${variant.label || id}” (check {{placeholders}}): ${msg}`
          );
        return;
      }

      const suffix =
        variant.outputSuffix ||
        (variant.id === "legal_vcon" ? "legal_vcon" : "legal");

      let baseName;
      if (variant.filenameParty === "second") {
        baseName = `${safeFilePart(suffix)}.docx`;
      } else {
        const surname = req.body.first_party_surname;
        const givenName = req.body.first_party_given_name;
        baseName = `${safeFilePart(surname)}_${safeFilePart(givenName)}_${safeFilePart(suffix)}.docx`;
      }
      const entryName = uniqueZipEntryName(baseName, usedNames);
      files.push({ name: entryName, buffer });
    }

    const stamp = new Date().toISOString().replace(/[:.]/g, "-");
    const zipFilename = `agreement-package-${stamp}.zip`;

    res.setHeader("Content-Type", "application/zip");
    res.setHeader(
      "Content-Disposition",
      `attachment; filename="${zipFilename}"; filename*=UTF-8''${encodeURIComponent(zipFilename)}`
    );

    const archive = archiver("zip", { zlib: { level: 9 } });
    archive.on("error", (err) => {
      if (!res.headersSent) {
        res.status(500).send(err.message);
      }
    });

    archive.pipe(res);
    for (const f of files) {
      archive.append(f.buffer, { name: f.name });
    }
    await archive.finalize();
  } catch (e) {
    console.error(e);
    if (!res.headersSent) {
      res.status(500).send(e.message || "Server error");
    }
  }
});

app.use(express.static(path.join(__dirname, "public")));

app.listen(PORT, () => {
  console.log(`Agreement packager: http://localhost:${PORT}`);
});

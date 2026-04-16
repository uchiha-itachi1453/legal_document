Place your Word templates in this folder (list them in public/templates-manifest.json).

All form fields are merged into every template. Use double braces. Tags are
case-sensitive in Word, but this app sends BOTH forms so either works:

  {{first_party_surname}}  or  {{FIRST_PARTY_SURNAME}}
  {{second_party_given_name}}  or  {{SECOND_PARTY_GIVEN_NAME}}
  … same for every field name in the form.
  {{first_record_mobile_number}}  …  {{second_record_aadhar_number}}  etc.

Download filename is controlled per variant by "filenameParty" in public/templates-manifest.json:

  "filenameParty": "first"  →  <FirstSurname>_<FirstGiven>_<outputSuffix>.docx
  "filenameParty": "second" →  <outputSuffix>.docx

Add variants with: id, label, docxFile, outputSuffix, filenameParty ("first" or "second").

The web UI can generate several templates at once; you download one ZIP containing one filled .docx per selected variant.

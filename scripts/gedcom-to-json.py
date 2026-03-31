# scripts/gedcom-to-json.py

import argparse
import os
import json
import re
import unicodedata
from datetime import datetime
from gedcom.parser import Parser

# --- Configuration ---
# Define paths relative to the project root.
# This script should be run from the root of the project directory.
INPUT_DIR = "input"
OUTPUT_DIR = "data"


def _build_cp1252_to_cp1250_map():
    """
    Returns a translation table for characters that differ between cp1252 and cp1250.
    Used to fix UTF-8 files that were incorrectly converted from cp1250 using cp1252/Latin-1
    as the source encoding (a common mistake that turns č→è, Č→È, etc.).
    """
    mapping = {}
    for byte_val in range(0x80, 0x100):
        b = bytes([byte_val])
        try:
            cp1250_char = b.decode("cp1250")
            cp1252_char = b.decode("cp1252")
            if cp1250_char != cp1252_char:
                mapping[cp1252_char] = cp1250_char
        except (UnicodeDecodeError, ValueError):
            pass
    return str.maketrans(mapping)


_CP1252_TO_CP1250 = _build_cp1252_to_cp1250_map()


def fix_cp1252_as_cp1250(content):
    """
    Detects and fixes UTF-8 content that was incorrectly converted from cp1250
    using cp1252 as the source encoding. Only applied when the content contains
    cp1252-specific characters (like è/È) but lacks the expected cp1250 equivalents
    (like č/Č), which is the telltale sign of the mis-conversion.
    """
    has_cp1252_chars = "è" in content or "È" in content
    has_cp1250_chars = "č" in content or "Č" in content
    if has_cp1252_chars and not has_cp1250_chars:
        return content.translate(_CP1252_TO_CP1250)
    return content


def safe_read_gedcom(filepath):
    """
    Attempts to read a file using a sequence of common GEDCOM encodings.
    It first tries to detect the encoding from the '1 CHAR' tag in the header.
    Returns the file content as a string.
    """
    detected_enc = None
    encoding_map = {
        b"UTF-8": "utf-8-sig",
        b"ANSI": "cp1250",
        b"MACINTOSH": "mac_roman",
        b"IBM WINDOWS": "cp1250",
        b"WINDOWS": "cp1250",
        b"ISO8859-1": "iso-8859-1",
        b"ASCII": "ascii",
        b"UNICODE": "utf-16",
        b"UTF-16": "utf-16",
    }

    # Fast check of the first 4KB to find the '1 CHAR' definition
    try:
        with open(filepath, "rb") as f:
            head = f.read(4096)
            idx = head.find(b"1 CHAR ")
            if idx != -1:
                idx += 7
                end_idx_n = head.find(b"\n", idx)
                end_idx_r = head.find(b"\r", idx)

                if end_idx_n != -1 and end_idx_r != -1:
                    end_idx = min(end_idx_n, end_idx_r)
                else:
                    end_idx = max(end_idx_n, end_idx_r)

                if end_idx != -1:
                    char_val = head[idx:end_idx].strip()
                    detected_enc = encoding_map.get(char_val.upper())
    except Exception:
        pass

    encodings_to_try = []
    if detected_enc:
        encodings_to_try.append(detected_enc)

    # Fallbacks: UTF-8 with BOM, Standard UTF-8, Windows-1250 (Central European), Windows-1252, ISO-8859-1, Mac Roman
    for enc in ["utf-8-sig", "utf-8", "cp1250", "cp1252", "iso-8859-1", "mac_roman"]:
        if enc not in encodings_to_try:
            encodings_to_try.append(enc)

    for enc in encodings_to_try:
        try:
            with open(filepath, "r", encoding=enc) as f:
                content = f.read()
                print(f"  Successfully read {filepath} using {enc} encoding.")
                return content
        except UnicodeDecodeError:
            continue  # Try the next encoding in the list

    # If all fail, raise an exception or handle it gracefully
    raise ValueError(f"Could not decode {filepath}. Unknown encoding.")


def get_name_surname(individual):
    """
    Safely extracts the first name and surname from an individual element.
    GEDCOM names can be complex, so this handles basic cases gracefully.
    """
    for child in individual.get_child_elements():
        if child.get_tag() == "NAME":
            name_val = child.get_value()
            if "/" in name_val:
                parts = name_val.split("/")
                first = parts[0].strip()
                last = parts[1].strip()
                return first or "", last or ""
            return name_val.strip() or "", ""
    return "", ""


MATRICULA_RE = re.compile(r"https?://data\.matricula-online\.eu/[^\"\s<]+")


def _find_matricula_url(text):
    """Return the first matricula-online.eu URL found in text, or empty string."""
    if not text:
        return ""
    m = MATRICULA_RE.search(text)
    return m.group().rstrip(".,;)") if m else ""


_PAGE_RE = re.compile(r"\?pg=\d+")


def _apply_page(url_template, page):
    """Replace or append the ?pg= parameter in a matricula URL."""
    if _PAGE_RE.search(url_template):
        return _PAGE_RE.sub(f"?pg={page}", url_template)
    return url_template


def _link_from_subelement(element, sources_dict):
    """
    Extract a matricula URL from a GEDCOM sub-element using all known patterns:
      P1  NOTE value (plain) or NOTE+CONT children (HTML-wrapped)
      P2  NOTE with plain URL — same tag path as P1
      P3  SOUR > PAGE
      P4  SOUR > DATA > TEXT
      P5  SOUR @ref@ resolved via sources_dict (plain URL)
      P7  SOUR @ref@ + PAGE N resolved via FILN/OBJE template in sources_dict
    """
    tag = element.get_tag()
    val = element.get_value() or ""

    if tag == "NOTE":
        # P2: plain URL directly as NOTE value
        url = _find_matricula_url(val)
        if url:
            return url
        # P1: URL buried in CONT/CONC continuation lines (may be HTML-wrapped)
        # CONC = concatenate directly (no separator), CONT = new line (space separator)
        full = val
        for cont in element.get_child_elements():
            sep = "" if cont.get_tag() == "CONC" else " "
            full += sep + (cont.get_value() or "")
        return _find_matricula_url(full)

    if tag == "SOUR":
        # P8: URL stored directly as SOUR value (ODAR.GED pattern: "2 SOUR https://...")
        url = _find_matricula_url(val)
        if url:
            return url
        # P5/P7: reference pointer @Sxxx@
        if val.startswith("@") and val.endswith("@"):
            template = sources_dict.get(val, "")
            if not template:
                return ""
            # P7: if a PAGE child exists, substitute the page number into the template URL
            for sour_child in element.get_child_elements():
                if sour_child.get_tag() == "PAGE":
                    page_val = (sour_child.get_value() or "").strip()
                    # page_val may be a plain number or contain text like "254" or "pg. 254"
                    m = re.search(r"\d+", page_val)
                    if m and _PAGE_RE.search(template):
                        return _apply_page(template, m.group())
            # P5: plain URL stored directly in sources_dict (no page substitution needed)
            return template
        # P3: inline SOUR > PAGE
        for sour_child in element.get_child_elements():
            if sour_child.get_tag() == "PAGE":
                url = _find_matricula_url(sour_child.get_value() or "")
                if url:
                    return url
            # P4: inline SOUR > DATA > TEXT
            elif sour_child.get_tag() == "DATA":
                for data_child in sour_child.get_child_elements():
                    if data_child.get_tag() == "TEXT":
                        url = _find_matricula_url(data_child.get_value() or "")
                        if url:
                            return url

    return ""


def _indi_level_link(element, sources_dict):
    """
    Extract a matricula URL from any NOTE or SOUR at the INDI (or FAM) level.
    Used when the researcher stored the link on the individual/family record
    rather than inside the specific BIRT/MARR event (e.g. KOŠIR.GED pattern).
    """
    for child in element.get_child_elements():
        if child.get_tag() in ("NOTE", "SOUR"):
            url = _link_from_subelement(child, sources_dict)
            if url:
                return url
    return ""


def build_obje_dict(root_elements):
    """
    Pre-build a mapping of OBJE pointer → matricula URL from all root OBJE records.
    Used to resolve FILN-based sources in RENKO.GED (and similar files).
    """
    obje = {}
    for element in root_elements:
        if element.get_tag() != "OBJE":
            continue
        pointer = element.get_pointer()
        if not pointer:
            continue
        for child in element.get_child_elements():
            if child.get_tag() == "FILE":
                url = _find_matricula_url(child.get_value() or "")
                if url:
                    obje[pointer] = url
                    break
    return obje


def build_sources_dict(root_elements, obje_dict=None):
    """
    Pre-build a mapping of source pointer → matricula URL (or URL template) from
    all root SOUR records. Two patterns covered:
      P5  SOUR with TITL/ABBR containing a direct URL (MAUKO.GED, MODRIJAN.GED)
      P7  SOUR with FILN + OBJE children: store first OBJE URL as template for
          page substitution (RENKO.GED pattern — caller substitutes ?pg=N)
    """
    if obje_dict is None:
        obje_dict = {}
    sources = {}
    for element in root_elements:
        if element.get_tag() != "SOUR":
            continue
        pointer = element.get_pointer()
        if not pointer:
            continue
        # P5: direct URL in TITL or ABBR
        for child in element.get_child_elements():
            if child.get_tag() in ("TITL", "ABBR"):
                url = _find_matricula_url(child.get_value() or "")
                if url:
                    sources[pointer] = url
                    break
        if pointer in sources:
            continue
        # P7: FILN-based source — find first OBJE child with a matricula URL to use
        #     as a page-substitution template (e.g. .../04105/?pg=1 → .../04105/?pg=254)
        has_filn = any(c.get_tag() == "FILN" for c in element.get_child_elements())
        if has_filn:
            for child in element.get_child_elements():
                if child.get_tag() == "OBJE":
                    obje_ptr = child.get_value() or ""
                    template = obje_dict.get(obje_ptr, "")
                    if template and _PAGE_RE.search(template):
                        sources[pointer] = template  # stored as template; caller substitutes page
                        break
    return sources


def get_event_data(element, event_tag, sources_dict=None):
    """
    Extract date, place, and an optional matricula-online link for an event (BIRT/MARR).
    sources_dict must be pre-built with build_sources_dict() for SOUR @ref@ resolution.
    """
    if sources_dict is None:
        sources_dict = {}
    for child in element.get_child_elements():
        if child.get_tag() != event_tag:
            continue
        date, place, link = "", "", ""
        # P6: URL stored directly as the event tag value (RENKO.GED pattern)
        link = _find_matricula_url(child.get_value() or "")
        for subchild in child.get_child_elements():
            if subchild.get_tag() == "DATE":
                date = subchild.get_value()
            elif subchild.get_tag() == "PLAC":
                place = subchild.get_value()
            elif not link:
                link = _link_from_subelement(subchild, sources_dict)
        return date, place, link
    return "", "", ""


def extract_year(date_str):
    """Returns the 4-digit year from a GEDCOM date string, or None if not found."""
    if not date_str:
        return None
    match = re.search(r"\b(\d{4})\b", date_str)
    return int(match.group(1)) if match else None


def is_recent(date_str, cutoff_year):
    """Returns True if the year in date_str is within the last 100 years."""
    year = extract_year(date_str)
    return year is not None and year > cutoff_year


def needs_processing(input_path, births_path, families_path):
    """
    Returns True if the GED file should be processed in update mode:
    either JSON output is missing or older than the GED file.
    """
    ged_mtime = os.path.getmtime(input_path)
    for json_path in (births_path, families_path):
        if not os.path.exists(json_path):
            return True
        if os.path.getmtime(json_path) < ged_mtime:
            return True
    return False


def main():
    """
    Main function to process all GEDCOM files in the input directory,
    extracting birth and marriage data into separate JSON files.
    """
    parser = argparse.ArgumentParser(description="Convert GEDCOM files to JSON.")
    parser.add_argument(
        "--mode",
        choices=["update", "full"],
        default="update",
        help="update (default): skip files whose JSON is already up to date; "
        "full: process all files and overwrite existing JSON.",
    )
    args = parser.parse_args()
    full_mode = args.mode == "full"

    print(f"Starting GEDCOM data extraction process (mode: {args.mode})...")

    # --- Setup ---
    # Ensure the output directory exists, creating it if necessary.
    if not os.path.exists(OUTPUT_DIR):
        os.makedirs(OUTPUT_DIR)
        print(f"Created output directory: {OUTPUT_DIR}")

    # Check if the input directory exists.
    if not os.path.isdir(INPUT_DIR):
        print(f"Error: Input directory '{INPUT_DIR}' not found.")
        print("Please create it and place your GEDCOM (.ged) files inside.")
        return

    # --- File Processing Loop ---
    # Find all files ending with .ged in the input directory.
    gedcom_files = [f for f in os.listdir(INPUT_DIR) if f.lower().endswith(".ged")]

    if not gedcom_files:
        print(f"No GEDCOM files found in '{INPUT_DIR}'.")
        return

    # Store metadata about processed files for the frontend
    metadata = []

    # Process each file found.
    for filename in gedcom_files:
        contributor_id = unicodedata.normalize("NFC", "-".join(
            part.lower().capitalize()
            for part in os.path.splitext(filename)[0].split("-")
        ))
        input_path = os.path.join(INPUT_DIR, filename)
        births_output_path = os.path.join(OUTPUT_DIR, f"{contributor_id}-births.json")
        families_output_path = os.path.join(
            OUTPUT_DIR, f"{contributor_id}-families.json"
        )

        # --- Update mode: skip if JSON is already up to date ---
        if not full_mode and not needs_processing(
            input_path, births_output_path, families_output_path
        ):
            print(f"\nSkipping {filename} (JSON is up to date).")
            # Still include in metadata using the existing JSON counts
            try:
                with open(births_output_path, encoding="utf-8") as f:
                    births_count = len(json.load(f))
                with open(families_output_path, encoding="utf-8") as f:
                    families_count = len(json.load(f))
                ged_mtime = datetime.fromtimestamp(
                    os.path.getmtime(input_path)
                ).isoformat()
                metadata.append(
                    {
                        "contributor": contributor_id,
                        "births_count": births_count,
                        "families_count": families_count,
                        "last_modified": ged_mtime,
                    }
                )
            except Exception:
                pass
            continue

        print(f"\nProcessing file: {filename} (Contributor: {contributor_id})")

        # Initialize lists to hold extracted records for this file.
        births_data = []
        families_data = []

        # --- Parsing ---
        temp_path = f"{input_path}.utf8.tmp"
        try:
            # Decode the file using our fallback encodings
            gedcom_content = safe_read_gedcom(input_path)

            # Fix files that were incorrectly converted from cp1250 using cp1252/Latin-1
            fixed = fix_cp1252_as_cp1250(gedcom_content)
            if fixed is not gedcom_content:
                print(f"  WARNING: cp1252→cp1250 encoding fix applied (è→č etc.) for {filename}")
                gedcom_content = fixed

            # Update the CHAR tag to UTF-8 so the parser doesn't get confused
            # by a legacy encoding declaration in a file we just converted.
            gedcom_content = re.sub(
                r"^1 CHAR .*$", "1 CHAR UTF-8", gedcom_content, flags=re.MULTILINE
            )

            # Write the decoded content to a temporary UTF-8 file
            # so the parser can reliably process it without encoding errors.
            with open(temp_path, "w", encoding="utf-8") as tmp_file:
                tmp_file.write(gedcom_content)

            # Instantiate the parser and parse the file.
            gedcom_parser = Parser()
            gedcom_parser.parse_file(temp_path, strict=False)

            # Clean up the temporary file on success
            os.remove(temp_path)
        except Exception as e:
            print(f"  ERROR: Could not parse {filename}. Skipping file. Reason: {e}")
            if os.path.exists(temp_path):
                os.remove(temp_path)
            continue  # Move to the next file

        # --- 1. Extract Birth Information ---
        # Dictionary to cache individual names by their GEDCOM pointer (ID)
        individuals_dict = {}
        family_elements = []

        root_elements = list(gedcom_parser.get_root_child_elements())
        obje_dict = build_obje_dict(root_elements)
        sources_dict = build_sources_dict(root_elements, obje_dict)

        # First pass: Get all elements directly from the parser
        for element in root_elements:
            tag = element.get_tag()

            # --- 1. Extract Birth Information ---
            if tag == "INDI":
                pointer = element.get_pointer()
                name, surname = get_name_surname(element)
                birth_date, birth_place, birth_link = get_event_data(element, "BIRT", sources_dict)
                # Fallback: link at INDI level (e.g. KOŠIR.GED stores NOTE on INDI, not inside BIRT)
                if not birth_link:
                    birth_link = _indi_level_link(element, sources_dict)

                # Store for marriage cross-referencing (include birth_date for privacy filter)
                individuals_dict[pointer] = {"name": name, "surname": surname, "birth_date": birth_date}

                if birth_date or birth_place:
                    record = {
                        "name": name,
                        "surname": surname,
                        "date_of_birth": birth_date or "",
                        "place_of_birth": birth_place or "",
                    }
                    if birth_link:
                        record["link"] = birth_link
                    births_data.append(record)

            elif tag == "FAM":
                family_elements.append(element)

        # --- 2. Extract Family (Marriage) Information ---
        for family in family_elements:
            marr_date, marr_place, marr_link = get_event_data(family, "MARR", sources_dict)
            # Fallback: link at FAM level (e.g. KOŠIR.GED stores NOTE on FAM, not inside MARR)
            if not marr_link:
                marr_link = _indi_level_link(family, sources_dict)

            husb_pointer, wife_pointer = "", ""
            for child in family.get_child_elements():
                if child.get_tag() == "HUSB":
                    husb_pointer = child.get_value()
                elif child.get_tag() == "WIFE":
                    wife_pointer = child.get_value()

            husb = individuals_dict.get(husb_pointer, {})
            wife = individuals_dict.get(wife_pointer, {})

            record = {
                "husband_name": husb.get("name", ""),
                "husband_surname": husb.get("surname", ""),
                "wife_name": wife.get("name", ""),
                "wife_surname": wife.get("surname", ""),
                "date_of_marriage": marr_date or "",
                "place_of_marriage": marr_place or "",
                "_husb_birth": husb.get("birth_date", ""),
                "_wife_birth": wife.get("birth_date", ""),
            }
            if marr_link:
                record["link"] = marr_link
            families_data.append(record)

        # --- 3. Filter recent records (privacy: exclude last 100 years) ---
        cutoff_year = datetime.now().year - 100
        births_before = len(births_data)
        families_before = len(families_data)
        births_data = [
            r for r in births_data if not is_recent(r["date_of_birth"], cutoff_year)
        ]
        families_data = [
            r
            for r in families_data
            if not is_recent(r["date_of_marriage"], cutoff_year)
            and not is_recent(r.get("_husb_birth", ""), cutoff_year)
            and not is_recent(r.get("_wife_birth", ""), cutoff_year)
        ]
        # Strip internal fields before writing
        for r in families_data:
            r.pop("_husb_birth", None)
            r.pop("_wife_birth", None)
        filtered_births = births_before - len(births_data)
        filtered_families = families_before - len(families_data)
        if filtered_births or filtered_families:
            print(
                f"  Filtered {filtered_births} recent birth(s) and {filtered_families} recent family/families (after {cutoff_year})."
            )

        # --- 4. Write Output JSON Files ---
        ged_mtime = os.path.getmtime(input_path)

        with open(births_output_path, "w", encoding="utf-8") as f:
            json.dump(births_data, f, ensure_ascii=False, indent=4)
        os.utime(births_output_path, (ged_mtime, ged_mtime))
        print(
            f"  -> Successfully created '{births_output_path}' with {len(births_data)} birth records."
        )

        with open(families_output_path, "w", encoding="utf-8") as f:
            json.dump(families_data, f, ensure_ascii=False, indent=4)
        os.utime(families_output_path, (ged_mtime, ged_mtime))
        print(
            f"  -> Successfully created '{families_output_path}' with {len(families_data)} family records."
        )

        # Add to metadata
        metadata.append(
            {
                "contributor": contributor_id,
                "births_count": len(births_data),
                "families_count": len(families_data),
                "last_modified": datetime.fromtimestamp(ged_mtime).isoformat(),
            }
        )

    # Write global metadata.json for the frontend
    metadata_output_path = os.path.join(OUTPUT_DIR, "metadata.json")
    with open(metadata_output_path, "w", encoding="utf-8") as f:
        json.dump(metadata, f, ensure_ascii=False, indent=4)
    print(f"\n  -> Successfully created metadata file: {metadata_output_path}")

    print("\nExtraction process finished successfully.")


if __name__ == "__main__":
    main()

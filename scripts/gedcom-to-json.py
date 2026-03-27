# scripts/extract_data.py

import os
import json
import re
from datetime import datetime
from gedcom.parser import Parser

# --- Configuration ---
# Define paths relative to the project root.
# This script should be run from the root of the project directory.
INPUT_DIR = "input"
OUTPUT_DIR = "data"


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


def get_event_data(element, event_tag):
    """Helper to extract date and place for a specific event like BIRT or MARR."""
    for child in element.get_child_elements():
        if child.get_tag() == event_tag:
            date, place = "", ""
            for subchild in child.get_child_elements():
                if subchild.get_tag() == "DATE":
                    date = subchild.get_value()
                elif subchild.get_tag() == "PLAC":
                    place = subchild.get_value()
            return date, place
    return "", ""


def main():
    """
    Main function to process all GEDCOM files in the input directory,
    extracting birth and marriage data into separate JSON files.
    """
    print("Starting GEDCOM data extraction process...")

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
        contributor_id = os.path.splitext(filename)[0]
        input_path = os.path.join(INPUT_DIR, filename)
        print(f"\nProcessing file: {filename} (Contributor: {contributor_id})")

        # Initialize lists to hold extracted records for this file.
        births_data = []
        families_data = []

        # --- Parsing ---
        temp_path = f"{input_path}.utf8.tmp"
        try:
            # Decode the file using our fallback encodings
            gedcom_content = safe_read_gedcom(input_path)

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
            gedcom_parser.parse_file(temp_path)

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

        # First pass: Get all elements directly from the parser
        for element in gedcom_parser.get_root_child_elements():
            tag = element.get_tag()

            # --- 1. Extract Birth Information ---
            if tag == "INDI":
                pointer = element.get_pointer()
                name, surname = get_name_surname(element)
                birth_date, birth_place = get_event_data(element, "BIRT")

                # Store for marriage cross-referencing
                individuals_dict[pointer] = {"name": name, "surname": surname}

                if birth_date or birth_place:
                    births_data.append(
                        {
                            "name": name,
                            "surname": surname,
                            "date_of_birth": birth_date or "",
                            "place_of_birth": birth_place or "",
                        }
                    )

            elif tag == "FAM":
                family_elements.append(element)

        # --- 2. Extract Family (Marriage) Information ---
        for family in family_elements:
            marr_date, marr_place = get_event_data(family, "MARR")

            husb_pointer, wife_pointer = "", ""
            for child in family.get_child_elements():
                if child.get_tag() == "HUSB":
                    husb_pointer = child.get_value()
                elif child.get_tag() == "WIFE":
                    wife_pointer = child.get_value()

            husb = individuals_dict.get(husb_pointer, {})
            wife = individuals_dict.get(wife_pointer, {})

            families_data.append(
                {
                    "husband_name": husb.get("name", ""),
                    "husband_surname": husb.get("surname", ""),
                    "wife_name": wife.get("name", ""),
                    "wife_surname": wife.get("surname", ""),
                    "date_of_marriage": marr_date or "",
                    "place_of_marriage": marr_place or "",
                }
            )

        # --- 3. Write Output JSON Files ---
        # Write the extracted births data to its JSON file.
        births_output_path = os.path.join(OUTPUT_DIR, f"{contributor_id}-births.json")
        with open(births_output_path, "w", encoding="utf-8") as f:
            json.dump(births_data, f, ensure_ascii=False, indent=4)
        print(
            f"  -> Successfully created '{births_output_path}' with {len(births_data)} birth records."
        )

        # Write the extracted families data to its JSON file.
        families_output_path = os.path.join(
            OUTPUT_DIR, f"{contributor_id}-families.json"
        )
        with open(families_output_path, "w", encoding="utf-8") as f:
            json.dump(families_data, f, ensure_ascii=False, indent=4)
        print(
            f"  -> Successfully created '{families_output_path}' with {len(families_data)} family records."
        )

        # Add to metadata
        metadata.append(
            {
                "contributor": contributor_id,
                "births_count": len(births_data),
                "families_count": len(families_data),
                "last_modified": datetime.now().isoformat(),
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

"""MCP (Model Context Protocol) server: the index as tools for AI assistants.

Served by api.py at /mcp (streamable HTTP, stateless, JSON responses), so an
assistant such as Claude can search the index and see who matches whom on a
user's behalf. Every tool is read-only and calls crud.py directly, so results
are the same as the website's.

Public, with no login, so it offers only what the website shows logged-out
visitors: no tree walking (ancestors / descendants / compare) and no
pair-by-pair match detail, which are behind JWT_SECRET where it is set. A tool
for one of those belongs here only once it checks the same token.

Result sizes are capped, and a semaphore bounds concurrent tool calls: an
assistant fans out parallel calls, and the API has wedged before when its
threadpool outran the DB pool. Waiting on the semaphore happens on the event
loop, so queued calls hold no thread.
"""

import os
from contextlib import contextmanager
from typing import Literal, Optional
from urllib.parse import urlencode

import anyio
from mcp.server.mcpserver import MCPServer
from mcp.server.transport_security import TransportSecuritySettings
from mcp.types import ToolAnnotations

from . import crud, schemas
from .database import SessionLocal

MAX_CONCURRENT = int(os.getenv("MCP_MAX_CONCURRENT", "4"))
MAX_RESULTS = 200
# The website this API serves (e.g. https://indeks.rodoslovje.si), for the
# `url` on each person. Unset: no urls.
SITE_URL = os.getenv("SITE_URL", "").rstrip("/")

_limiter = anyio.Semaphore(MAX_CONCURRENT)

Source = Literal["all", "tree", "matricula", "geneanet", "military"]

INSTRUCTIONS = """\
A genealogical index: records from many genealogists' family trees, searchable
by name, date and place.

Each genealogist is a "contributor". Some also publish non-tree sources under
their name plus a suffix: "-matricula" (transcribed parish registers),
"-geneanet" (cemetery / grave records) and "-military" (military records).

A person is identified by the pair (contributor, ext_id) — the GEDCOM id in
that contributor's tree. parents_list / partners_list / children_list entries
give relatives' ext_id as "id"; search(contributor=..., ext_id=...) fetches
that relative's own record.

Dates are GEDCOM text ("15 MAR 1875", "ABT 1850", "1850"). Text filters are
fuzzy (trigram + substring) unless exact=true; "^Novak" anchors the start,
"Novak$" the end, and commas separate alternatives ("Novak, Novák").

Matches are precomputed pairs of records in different contributors' data that
likely describe the same person or family, with a confidence of 0.80-1.0.
search_persons lists each hit's matched records in `same_as`, so one person
found in several trees can be read as one person with several sources.

get_person returns one person with parents, partners, marriages and
children as full records, in one call. Each person has a `url` to its page on
the website — give it to the user so they can check the record themselves.

Results come best match first; `total` says how many there are in all, and
`skip` pages through them.
"""

mcp = MCPServer(
    name="genealogical-index",
    instructions=INSTRUCTIONS,
)

_READ_ONLY = ToolAnnotations(readOnlyHint=True, openWorldHint=False)


@contextmanager
def _session():
    db = SessionLocal()
    try:
        yield db
    finally:
        db.close()


async def _run(fn, *args, **kwargs):
    """Run a blocking crud call in a worker thread, at most MAX_CONCURRENT at once."""
    async with _limiter:
        return await anyio.to_thread.run_sync(lambda: fn(*args, **kwargs))


def _clean(value):
    """Drop empty fields to keep responses small, and internal row ids.

    A dict carrying an ext_id is a DB record whose `id` is the row id, which
    no tool accepts and which changes on re-import. In relative lists (parents,
    partners, children) `id` is the relative's ext_id and is kept.
    """
    if isinstance(value, dict):
        is_record = any(k.endswith("ext_id") for k in value)
        out = {}
        for k, v in value.items():
            if is_record and k == "id":
                continue
            v = _clean(v)
            if v is None or v == "" or v == [] or v == {}:
                continue
            out[k] = v
        return out
    if isinstance(value, list):
        return [_clean(v) for v in value]
    return value


def _cap(limit: int) -> int:
    return max(1, min(limit, MAX_RESULTS))


_PRIVATE = {"private", "<private>", "unknown"}


def _person_url(rec: dict):
    """The record's page on the website, built like the site's own name
    links (table.js): the Person tab searched by ext_id and contributor.
    None for a private / unknown name, which the site doesn't link either."""
    if not SITE_URL or not rec.get("ext_id") or not rec.get("contributor"):
        return None
    name, surname = rec.get("name") or "", rec.get("surname") or ""
    if name.lower() in _PRIVATE or surname.lower() in _PRIVATE:
        return None
    q = {"t": "person"}
    if name:
        q["n"] = name
    if surname:
        q["sn"] = surname
    q.update({"id": rec["ext_id"], "c": rec["contributor"], "ex": "1"})
    return f"{SITE_URL}/?{urlencode(q, safe='@')}"


def _person(p):
    rec = schemas.Person.model_validate(p).model_dump()
    rec["url"] = _person_url(rec)
    for other in rec.get("same_as") or []:
        other["url"] = _person_url(other)
    return _clean(rec)


def _persons(rows):
    return [_person(p) for p in rows]


def _families(rows):
    return [_clean(schemas.Family.model_validate(f).model_dump()) for f in rows]


@mcp.tool(annotations=_READ_ONLY)
async def search(
    name: Optional[str] = None,
    surname: Optional[str] = None,
    date_from: Optional[str] = None,
    date_to: Optional[str] = None,
    place: Optional[str] = None,
    contributor: Optional[str] = None,
    ext_id: Optional[str] = None,
    source: Source = "all",
    record_type: Optional[Literal["persons", "families"]] = None,
    exact: bool = False,
    limit: int = 50,
) -> dict:
    """Search persons and families across all fields, like the site's quick search.

    name / surname match persons and either spouse of a family; place matches
    any birth, baptism, death, burial or marriage place. date_from alone is a
    fuzzy date match; with date_to it is a year range ("1820" to "1850")
    applied to births, deaths and marriages. contributor narrows to one
    genealogist (including their -matricula / -geneanet sources); source to
    one kind of data. ext_id (with contributor) selects one person by GEDCOM
    id. At least one filter is required. Persons carry `same_as`: the
    matched records in other contributors' data.
    """
    if not any([name, surname, date_from, date_to, place, contributor, ext_id]):
        return {"error": "Give at least one search filter."}

    def go():
        with _session() as db:
            res = crud.search_all(
                db, name=name, surname=surname, date_from=date_from,
                date_to=date_to, place=place, contributor=contributor,
                ext_id=ext_id, source=source, limit=_cap(limit), exact=exact,
                record_type=record_type,
            )
            crud.attach_same_as(db, res["persons"])
            return {
                "persons": _persons(res["persons"]),
                "families": _families(res["families"]),
            }

    return await _run(go)


@mcp.tool(annotations=_READ_ONLY)
async def search_persons(
    name: Optional[str] = None,
    surname: Optional[str] = None,
    birth_from: Optional[str] = None,
    birth_to: Optional[str] = None,
    place_of_birth: Optional[str] = None,
    death_from: Optional[str] = None,
    death_to: Optional[str] = None,
    place_of_death: Optional[str] = None,
    burial_from: Optional[str] = None,
    burial_to: Optional[str] = None,
    place_of_burial: Optional[str] = None,
    contributor: Optional[str] = None,
    exclude_contributor: Optional[str] = None,
    include_undated: bool = False,
    source: Source = "all",
    exact: bool = False,
    same_as: bool = True,
    limit: int = 50,
    skip: int = 0,
) -> dict:
    """Search persons field by field (birth, death and burial each separately).

    A *_from date alone is a fuzzy date match; with the matching *_to it is a
    year range. Baptism counts as birth. exclude_contributor (comma-separated)
    leaves out those genealogists' records. include_undated also keeps
    records with no year in a filtered date field, after the dated ones. With same_as, each hit lists the
    (contributor, ext_id) of the records in other contributors' data matched
    to it.
    """
    def go():
        with _session() as db:
            rows, total = crud.search_advanced_persons(
                db, name=name, surname=surname,
                date_of_birth=birth_from, date_of_birth_to=birth_to,
                place_of_birth=place_of_birth,
                date_of_death=death_from, date_of_death_to=death_to,
                place_of_death=place_of_death,
                date_of_burial=burial_from, date_of_burial_to=burial_to,
                place_of_burial=place_of_burial,
                contributor=contributor, source=source,
                limit=_cap(limit), skip=max(0, skip), exact=exact,
                exclude_contributor=exclude_contributor, with_total=True,
                include_undated=include_undated,
            )
            if same_as:
                crud.attach_same_as(db, rows)
            return {"total": total, "persons": _persons(rows)}

    return await _run(go)


@mcp.tool(annotations=_READ_ONLY)
async def search_families(
    husband_name: Optional[str] = None,
    husband_surname: Optional[str] = None,
    husband_birth_from: Optional[str] = None,
    husband_birth_to: Optional[str] = None,
    wife_name: Optional[str] = None,
    wife_surname: Optional[str] = None,
    wife_birth_from: Optional[str] = None,
    wife_birth_to: Optional[str] = None,
    children: Optional[str] = None,
    marriage_from: Optional[str] = None,
    marriage_to: Optional[str] = None,
    place_of_marriage: Optional[str] = None,
    contributor: Optional[str] = None,
    exclude_contributor: Optional[str] = None,
    include_undated: bool = False,
    source: Source = "all",
    exact: bool = False,
    limit: int = 50,
    skip: int = 0,
) -> dict:
    """Search families (couples) by either spouse, children's names or the marriage.

    children matches any child's name. A *_from date alone is a fuzzy match;
    with the matching *_to it is a year range. exclude_contributor
    (comma-separated) leaves out those genealogists' records. include_undated also keeps
    records with no year in a filtered date field, after the dated ones.
    """
    def go():
        with _session() as db:
            rows, total = crud.search_advanced_families(
                db, husband_name=husband_name, husband_surname=husband_surname,
                husband_birth=husband_birth_from,
                husband_birth_to=husband_birth_to,
                wife_name=wife_name, wife_surname=wife_surname,
                wife_birth=wife_birth_from, wife_birth_to=wife_birth_to,
                children=children,
                date_of_marriage=marriage_from, date_of_marriage_to=marriage_to,
                place_of_marriage=place_of_marriage,
                contributor=contributor, source=source,
                limit=_cap(limit), skip=max(0, skip), exact=exact,
                exclude_contributor=exclude_contributor, with_total=True,
                include_undated=include_undated,
            )
            return {"total": total, "families": _families(rows)}

    return await _run(go)


@mcp.tool(annotations=_READ_ONLY)
async def get_person(contributor: str, ext_id: str) -> dict:
    """One person with their family, all as full records, in one call.

    Returns the person (with `same_as`), their parents, and one entry per
    family: the partner, the marriage date and place, and the children. Every
    relative carries its own ext_id, so get_person on it walks one step
    further. Relatives are those in the same contributor's data.
    """
    def go():
        with _session() as db:
            res = crud.get_person_with_relatives(db, contributor, ext_id)
            if res is None:
                return {"error": f"No person {ext_id} in {contributor}'s data."}
            everyone = [res["person"], *res["parents"]]
            for fam in res["families"]:
                if fam["partner"] is not None:
                    everyone.append(fam["partner"])
                everyone.extend(fam["children"])
            crud.attach_same_as(db, everyone)
            families = []
            for fam in res["families"]:
                f = fam["family"]
                families.append(_clean({
                    "partner": _person(fam["partner"]) if fam["partner"] is not None else None,
                    "date_of_marriage": f.date_of_marriage if f is not None else None,
                    "place_of_marriage": f.place_of_marriage if f is not None else None,
                    "children": _persons(fam["children"]),
                }))
            return {
                "person": _person(res["person"]),
                "parents": _persons(res["parents"]),
                "families": families,
            }

    return await _run(go)


_CONTRIBUTOR_FIELDS = (
    "name", "persons_count", "families_count", "last_modified", "url",
    "full_name", "deceased",
)


@mcp.tool(annotations=_READ_ONLY)
async def list_contributors() -> dict:
    """Every genealogist in the index, with record counts and website.

    Counts are totals; `sources` gives the persons count of each non-tree
    source (matricula, geneanet, military) they publish, the rest being
    their tree. full_name is given only for genealogists who have passed
    away (deceased).
    """
    def go():
        with _session() as db:
            out = []
            for c in crud.get_contributors(db):
                c = schemas.Contributor.model_validate(c).model_dump()
                row = {k: c.get(k) for k in _CONTRIBUTOR_FIELDS}
                row["sources"] = {
                    part: c[part]["persons_count"]
                    for part in ("matricula", "geneanet", "military")
                    if c.get(part) and c[part]["persons_count"]
                }
                out.append(_clean(row))
            return {"contributors": out}

    return await _run(go)


@mcp.tool(annotations=_READ_ONLY)
async def top_surnames(contributor: Optional[str] = None, limit: int = 50) -> dict:
    """Most frequent surnames in the whole index, or in one contributor's data."""
    def go():
        with _session() as db:
            return {"surnames": crud.get_top_surnames(
                db, contributors=[contributor] if contributor else None,
                limit=_cap(limit),
            )}

    return await _run(go)


@mcp.tool(annotations=_READ_ONLY)
async def get_contributor_matches(contributor: str, surname: Optional[str] = None) -> dict:
    """Who a genealogist's tree has matches with, and how many.

    One row per other tree, per Matricula parish and per cemetery place
    (`unit`; `contributors` are its transcribers), and per military source.
    surname (comma-separated) counts only matches carrying those surnames.
    """
    surnames = [s.strip() for s in surname.split(",") if s.strip()] if surname else None

    def go():
        with _session() as db:
            return {"partners": [
                _clean(schemas.MatchPartner.model_validate(r).model_dump())
                for r in crud.get_contributor_matches(db, contributor, surnames=surnames)
            ]}

    return await _run(go)


def http_app():
    """The ASGI app serving /mcp, whose routes api.py adds to its own. Call
    once; it creates mcp.session_manager.

    Stateless with plain JSON responses: every tool is a single read, so there
    is nothing to stream and no session worth keeping. DNS-rebinding
    protection is for servers on localhost; this one sits behind Caddy on a
    public host, and its CORS is api.py's.
    """
    return mcp.streamable_http_app(
        streamable_http_path="/mcp",
        stateless_http=True,
        json_response=True,
        transport_security=TransportSecuritySettings(enable_dns_rebinding_protection=False),
    )

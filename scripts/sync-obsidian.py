#!/usr/bin/env python3
"""One-way sync: Open Brain (Supabase) -> Obsidian vault.

Regenerates the generated folders on every run. The vault is a MIRROR of the
brain — edits made in Obsidian are not written back to the brain.

Structure: hub notes (Work, GCU, Legacy, School, Personal, Kingdom Impact
Council) act as graph anchors; every note links "Part of" its hub so the
graph view clusters around them. Notes mentioning KIC also link to the KIC hub.

Run: python3 ~/open-brain-student/scripts/sync-obsidian.py
Auth: reads the Supabase CLI token from the macOS keychain (never printed).
"""
import json
import re
import shutil
import subprocess
import urllib.request
from datetime import datetime
from pathlib import Path

PROJECT = "sxtnzkprabnpwhijrbjs"
VAULT = Path.home() / "Obsidian" / "Open Brain"
BUCKET_FOLDERS = {
    "gcu": "GCU",
    "legacy": "Legacy",
    "school": "School",
    "personal": "Personal",
}
BUCKET_LABELS = {
    "gcu": "🏛 GCU",
    "legacy": "🏗 Legacy",
    "school": "📚 School",
    "personal": "🏠 Personal",
}
HUB_BY_BUCKET = {"gcu": "GCU", "legacy": "Legacy", "school": "School", "personal": "Personal"}
KIC = "Kingdom Impact Council"
KIC_RE = re.compile(r"kingdom impact|\bkic\b", re.IGNORECASE)
UNSORTED = "Unsorted"
IDEAS = "Idea Pipeline"
GENERATED_DIRS = list(BUCKET_FOLDERS.values()) + [UNSORTED, "Tasks", "Recaps", "Contacts", KIC, "Ideas"]
HUB_FILES = ["Work.md", "GCU.md", "Legacy.md", "School.md", "Personal.md", f"{KIC}.md", f"{IDEAS}.md"]


def get_token() -> str:
    out = subprocess.run(
        ["security", "find-generic-password", "-s", "Supabase CLI", "-w"],
        capture_output=True, text=True, check=True,
    )
    return out.stdout.strip()


def query(sql: str):
    req = urllib.request.Request(
        f"https://api.supabase.com/v1/projects/{PROJECT}/database/query",
        data=json.dumps({"query": sql}).encode(),
        headers={
            "Authorization": "Bearer " + get_token(),
            "Content-Type": "application/json",
            "User-Agent": "open-brain-obsidian-sync/1.0",
        },
        method="POST",
    )
    with urllib.request.urlopen(req) as r:
        return json.loads(r.read())


def slug(s: str, n: int = 45) -> str:
    s = re.sub(r"[^\w\s-]", "", (s or "").strip())[:n].strip()
    s = re.sub(r"\s+", " ", s)
    return s or "untitled"


def tags_list(v):
    if isinstance(v, list):
        return [str(t) for t in v]
    if isinstance(v, str) and v.strip():
        return [t.strip(' "{}') for t in v.strip("{}").split(",") if t.strip(' "{}')]
    return []


def frontmatter(row) -> str:
    tags = tags_list(row.get("tags"))
    bucket = row.get("bucket") or ""
    if bucket:
        tags = tags + [bucket]
    lines = ["---",
             f"type: {row.get('type') or 'thought'}",
             f"bucket: {bucket}",
             f"created: {row.get('created_at') or ''}"]
    if tags:
        lines.append("tags: [" + ", ".join(tags) + "]")
    lines += ["---", "", ""]
    return "\n".join(lines)


def main():
    rows = query(
        "select id, content, title, type, bucket, category, tags, summary, created_at "
        "from thoughts order by created_at"
    )
    try:
        people = query(
            "select name, role, organization, email, phone, relationship, notes, "
            "last_contact from kic_people order by name"
        )
    except Exception:
        people = []

    VAULT.mkdir(parents=True, exist_ok=True)
    for g in GENERATED_DIRS:
        shutil.rmtree(VAULT / g, ignore_errors=True)
    for f in HUB_FILES + ["Home.md", "Current Focus.md"]:
        (VAULT / f).unlink(missing_ok=True)

    contacts = [r for r in rows if (r.get("type") or "") == "contact"]
    contact_names = [c.get("title") for c in contacts if c.get("title")]

    hub_members = {h: [] for h in ["Work", "GCU", "Legacy", "School", "Personal", KIC, IDEAS]}
    tasks, state_row, written = [], None, 0
    for r in rows:
        t = r.get("type") or "thought"
        if t == "state":
            state_row = r
            continue
        if t == "task":
            tasks.append(r)
            continue
        content = r.get("content") or ""
        created = (r.get("created_at") or "")[:10]
        if t == "session":
            folder, fname = VAULT / "Recaps", f"{created} {slug(r.get('title') or 'Recap')}.md"
        elif t == "contact":
            folder, fname = VAULT / "Contacts", f"{slug(r.get('title') or 'Contact')}.md"
        elif t == "idea":
            folder = VAULT / "Ideas"
            fname = f"{created} {slug(r.get('title') or content)} {str(r.get('id'))[:6]}.md"
        else:
            folder = VAULT / BUCKET_FOLDERS.get(r.get("bucket"), UNSORTED)
            fname = f"{created} {slug(r.get('title') or content)} {str(r.get('id'))[:6]}.md"
        folder.mkdir(parents=True, exist_ok=True)

        body = content
        if r.get("summary"):
            body = f"> {r['summary']}\n\n" + body
        related = [n for n in contact_names
                   if n and n.lower() in content.lower() and n != r.get("title")]
        if related:
            body += "\n\nRelated: " + " ".join(f"[[{n}]]" for n in related)

        hubs = []
        if r.get("bucket") in HUB_BY_BUCKET:
            hubs.append(HUB_BY_BUCKET[r["bucket"]])
        if KIC_RE.search(content) or KIC_RE.search(r.get("title") or ""):
            hubs.append(KIC)
        if t == "idea":
            hubs.append(IDEAS)
        if hubs:
            body += "\n\nPart of: " + " ".join(f"[[{h}]]" for h in hubs)
            for h in hubs:
                hub_members[h].append(fname[:-3])

        (folder / fname).write_text(frontmatter(r) + body + "\n")
        written += 1

    # Tasks: one checklist note per bucket, linked to its hub
    (VAULT / "Tasks").mkdir(parents=True, exist_ok=True)
    open_count = 0
    for b, label in BUCKET_LABELS.items():
        items = [t for t in tasks if (t.get("bucket") or "personal") == b]
        if not items:
            continue
        lines = [f"# {label} tasks", ""]
        for t in items:
            done = (t.get("category") or "") == "done"
            open_count += 0 if done else 1
            box = "x" if done else " "
            day = (t.get("created_at") or "")[:10]
            lines.append(f"- [{box}] {t.get('content') or ''}  *(added {day})*")
        lines += ["", f"Part of: [[{HUB_BY_BUCKET[b]}]]"]
        (VAULT / "Tasks" / f"{BUCKET_FOLDERS[b]} Tasks.md").write_text("\n".join(lines) + "\n")
        hub_members[HUB_BY_BUCKET[b]].append(f"{BUCKET_FOLDERS[b]} Tasks")

    # KIC people (kic_people table) -> notes under the KIC hub
    if people:
        (VAULT / KIC).mkdir(parents=True, exist_ok=True)
        for p in people:
            name = p.get("name") or "Unknown"
            lines = [f"# {name}", ""]
            for k in ("role", "organization", "email", "phone", "relationship", "last_contact"):
                if p.get(k):
                    lines.append(f"- **{k.replace('_', ' ').title()}:** {p[k]}")
            if p.get("notes"):
                lines += ["", p["notes"]]
            lines += ["", f"Part of: [[{KIC}]]"]
            (VAULT / KIC / f"{slug(name)}.md").write_text("\n".join(lines) + "\n")
            hub_members[KIC].append(slug(name))

    # Hub notes — the "dots" the graph clusters around
    def hub_page(name, emoji, parent, blurb, extra_links=()):
        lines = [f"# {emoji} {name}", "", blurb, ""]
        for l in extra_links:
            lines.append(f"- [[{l}]]")
        members = hub_members.get(name, [])
        if members:
            lines += ["", "## In here", ""]
            lines += [f"- [[{m}]]" for m in members]
        if parent:
            lines += ["", f"Part of: [[{parent}]]"]
        (VAULT / f"{name}.md").write_text("\n".join(lines) + "\n")

    hub_page("Work", "🧳", None,
             "Everything job-related — both jobs live under here.",
             extra_links=["GCU", "Legacy"])
    hub_page("GCU", "🏛", "Work",
             "GCU Development — corporate partnerships, donors, prospects.",
             extra_links=[KIC])
    hub_page("Legacy", "🏗", "Work",
             "Legacy Development Partners — site selection work.")
    hub_page("School", "📚", None, "Classes, assignments, campus.")
    hub_page("Personal", "🏠", None, "Faith, goals, projects, everything else.")
    hub_page(KIC, "👑", "GCU",
             "Kingdom Impact Council — everything you do for KIC collects here. "
             "Mention \"KIC\" or \"Kingdom Impact Council\" in a capture and it links here automatically.")
    hub_page(IDEAS, "💡", None,
             "Every idea captured through the /idea pipeline — source, interpretation, "
             "build plan, and status (PENDING APPROVAL / EXECUTED / KILLED). "
             "Live dashboard: https://open-brain-student.vercel.app/pipeline.html")

    if state_row and state_row.get("content"):
        (VAULT / "Current Focus.md").write_text(
            frontmatter(state_row) + state_row["content"] + "\n")

    stamp = datetime.now().strftime("%A, %B %-d %Y at %-I:%M %p")
    home = [
        "# 🧠 Open Brain",
        "",
        f"Mirror of [your brain](https://open-brain-student.vercel.app), refreshed {stamp}.",
        "",
        "> [!warning] This vault is generated. Edits here do NOT sync back to the brain —",
        "> capture and check off tasks in the brain app (or via Claude), then refresh.",
        "",
        "- [[Current Focus]]",
        "- [[Work]] → [[GCU]] (with [[Kingdom Impact Council]]) and [[Legacy]]",
        "- [[School]] · [[Personal]] · [[Idea Pipeline]]",
        f"- **Tasks** — {open_count} open (see the Tasks folder)",
        "- Recaps — one note per daily recap",
        "",
        "To refresh: ask Claude to \"sync my Obsidian vault\" or run:",
        "`python3 ~/open-brain-student/scripts/sync-obsidian.py`",
    ]
    (VAULT / "Home.md").write_text("\n".join(home) + "\n")
    print(f"Vault refreshed: {written} notes, {len(tasks)} tasks ({open_count} open), "
          f"{len(people)} KIC people -> {VAULT}")


if __name__ == "__main__":
    main()

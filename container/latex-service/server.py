"""
LaTeX PDF compiler service for NanoClaw.

Endpoints:
  POST /compile      — raw LaTeX source → PDF binary
  GET  /templates    — list bundled CV templates
  POST /render-cv    — structured CV data → render template → PDF binary

LaTeX special characters in user-supplied text are escaped before template rendering.
URL fields (email, linkedin, github, website, project url) are passed through as-is
since hyperref handles them directly.
"""
import os
import re
import subprocess
import tempfile
from pathlib import Path
from typing import Optional

from fastapi import FastAPI, HTTPException
from fastapi.responses import Response
from jinja2 import Environment, FileSystemLoader, TemplateNotFound
from pydantic import BaseModel

app = FastAPI(title="nanoclaw-latex")

TEMPLATES_DIR = Path(__file__).parent / "templates"

# Jinja2 with LaTeX-safe delimiters (avoid conflicts with {{ }} and % in LaTeX)
_jinja = Environment(
    loader=FileSystemLoader(str(TEMPLATES_DIR)),
    variable_start_string="<<",
    variable_end_string=">>",
    block_start_string="<%",
    block_end_string="%>",
    comment_start_string="<#",
    comment_end_string="#>",
    keep_trailing_newline=True,
)

TEMPLATE_DESCRIPTIONS = {
    "modern": "Clean single-column with blue accents — great for tech and industry roles",
    "sidebar": "Two-column header with colored name panel — polished, contemporary look",
}

# ── LaTeX escaping ────────────────────────────────────────────────────────────

_LATEX_ESCAPE = [
    ("\\", r"\textbackslash{}"),
    ("&",  r"\&"),
    ("%",  r"\%"),
    ("$",  r"\$"),
    ("#",  r"\#"),
    ("_",  r"\_"),
    ("{",  r"\{"),
    ("}",  r"\}"),
    ("~",  r"\textasciitilde{}"),
    ("^",  r"\textasciicircum{}"),
]

def escape_latex(text: str) -> str:
    # Backslash must come first to avoid double-escaping
    for char, replacement in _LATEX_ESCAPE:
        text = text.replace(char, replacement)
    return text

def esc(val):
    """Recursively escape all strings in a dict/list/str. Skip None."""
    if val is None:
        return val
    if isinstance(val, str):
        return escape_latex(val)
    if isinstance(val, list):
        return [esc(v) for v in val]
    if isinstance(val, dict):
        return {k: esc(v) for k, v in val.items()}
    return val

# ── Compilation ───────────────────────────────────────────────────────────────

def compile_tex(latex: str, engine: str = "xelatex") -> bytes:
    if engine not in ("xelatex", "pdflatex"):
        raise HTTPException(status_code=400, detail=f"Unknown engine: {engine}")
    with tempfile.TemporaryDirectory() as tmpdir:
        tex = os.path.join(tmpdir, "doc.tex")
        with open(tex, "w", encoding="utf-8") as f:
            f.write(latex)
        cmd = [engine, "-interaction=nonstopmode", "-halt-on-error", "doc.tex"]
        # Two passes: ensures hyperref cross-references resolve correctly
        for _ in range(2):
            result = subprocess.run(cmd, cwd=tmpdir, capture_output=True, text=True, timeout=90)
        pdf = os.path.join(tmpdir, "doc.pdf")
        if not os.path.exists(pdf):
            log_path = os.path.join(tmpdir, "doc.log")
            if os.path.exists(log_path):
                with open(log_path) as lf:
                    log = lf.read()
                # Surface only the error lines to keep the response concise
                errors = "\n".join(
                    line for line in log.splitlines()
                    if line.startswith("!") or "Error" in line
                ) or log[-2000:]
            else:
                errors = result.stderr[-2000:]
            raise HTTPException(status_code=422, detail=f"Compilation failed:\n{errors}")
        with open(pdf, "rb") as f:
            return f.read()

# ── Pydantic models ───────────────────────────────────────────────────────────

class CompileRequest(BaseModel):
    latex: str
    engine: str = "xelatex"

class PersonalInfo(BaseModel):
    name: str
    email: str
    phone: Optional[str] = None
    location: Optional[str] = None
    website: Optional[str] = None
    linkedin: Optional[str] = None
    github: Optional[str] = None

class Experience(BaseModel):
    company: str
    role: str
    start: str
    end: Optional[str] = None
    location: Optional[str] = None
    bullets: list[str] = []

class Education(BaseModel):
    institution: str
    degree: str
    field: Optional[str] = None
    start: Optional[str] = None
    end: Optional[str] = None
    gpa: Optional[str] = None

class Project(BaseModel):
    name: str
    description: str
    url: Optional[str] = None
    tech: Optional[list[str]] = None

class CVData(BaseModel):
    template: str
    personal: PersonalInfo
    summary: Optional[str] = None
    experience: list[Experience] = []
    education: list[Education] = []
    skills: Optional[dict[str, list[str]]] = None
    projects: Optional[list[Project]] = None

# ── Endpoints ─────────────────────────────────────────────────────────────────

@app.post("/compile")
def compile_endpoint(req: CompileRequest):
    pdf = compile_tex(req.latex, req.engine)
    return Response(content=pdf, media_type="application/pdf")


@app.get("/templates")
def list_templates():
    templates = []
    for f in sorted(TEMPLATES_DIR.glob("*.tex.jinja2")):
        name = f.name.replace(".tex.jinja2", "")
        templates.append({
            "name": name,
            "description": TEMPLATE_DESCRIPTIONS.get(name, ""),
        })
    return {"templates": templates}


@app.post("/render-cv")
def render_cv(data: CVData):
    try:
        tmpl = _jinja.get_template(f"{data.template}.tex.jinja2")
    except TemplateNotFound:
        available = [f.name.replace(".tex.jinja2", "") for f in TEMPLATES_DIR.glob("*.tex.jinja2")]
        raise HTTPException(status_code=404, detail=f"Template '{data.template}' not found. Available: {available}")

    # URL fields must NOT be LaTeX-escaped (they go inside \href{}{})
    p = data.personal
    personal_ctx = {
        "name":     escape_latex(p.name),
        "email":    p.email,       # URL-safe as-is
        "phone":    escape_latex(p.phone) if p.phone else None,
        "location": escape_latex(p.location) if p.location else None,
        "website":  p.website,     # URL
        "linkedin": p.linkedin,    # URL
        "github":   p.github,      # URL
    }

    experience_ctx = [
        {
            "company":  escape_latex(j.company),
            "role":     escape_latex(j.role),
            "start":    escape_latex(j.start),
            "end":      escape_latex(j.end) if j.end else None,
            "location": escape_latex(j.location) if j.location else None,
            "bullets":  [escape_latex(b) for b in j.bullets],
        }
        for j in data.experience
    ]

    education_ctx = [
        {
            "institution": escape_latex(e.institution),
            "degree":      escape_latex(e.degree),
            "field":       escape_latex(e.field) if e.field else None,
            "start":       escape_latex(e.start) if e.start else None,
            "end":         escape_latex(e.end) if e.end else None,
            "gpa":         escape_latex(e.gpa) if e.gpa else None,
        }
        for e in data.education
    ]

    skills_ctx = (
        {escape_latex(cat): [escape_latex(s) for s in items]
         for cat, items in data.skills.items()}
        if data.skills else None
    )

    projects_ctx = (
        [
            {
                "name":        escape_latex(pr.name),
                "description": escape_latex(pr.description),
                "url":         pr.url,  # URL
                "tech":        [escape_latex(t) for t in pr.tech] if pr.tech else None,
            }
            for pr in data.projects
        ]
        if data.projects else None
    )

    latex = tmpl.render(
        personal=personal_ctx,
        summary=escape_latex(data.summary) if data.summary else None,
        experience=experience_ctx,
        education=education_ctx,
        skills=skills_ctx,
        projects=projects_ctx,
    )

    pdf = compile_tex(latex)
    return Response(content=pdf, media_type="application/pdf")

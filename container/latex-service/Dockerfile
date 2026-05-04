FROM python:3.12-slim

# texlive-xetex: XeLaTeX engine (better Unicode/font support than pdflatex)
# texlive-latex-extra: moderncv, enumitem, titlesec, tcolorbox, paracol, etc.
# texlive-fonts-recommended + texlive-fonts-extra: Latin Modern, many extras
# texlive-plain-generic: plain TeX macros shared across engines
# lmodern: Latin Modern OTF fonts (required by many CV templates)
RUN apt-get update && apt-get install -y --no-install-recommends \
    texlive-xetex \
    texlive-latex-extra \
    texlive-fonts-recommended \
    texlive-fonts-extra \
    texlive-plain-generic \
    lmodern \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app

COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

COPY server.py .
COPY templates/ ./templates/

CMD ["uvicorn", "server:app", "--host", "0.0.0.0", "--port", "9003"]

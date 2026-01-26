import os
import json
from fastapi import FastAPI, Request, Form
from fastapi.responses import FileResponse, JSONResponse
from fastapi.staticfiles import StaticFiles
from fastapi.middleware.cors import CORSMiddleware
import requests
from bs4 import BeautifulSoup
from datetime import datetime

app = FastAPI()

# Configurar CORS para acesso local via JS
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

BASE_DIR = os.path.dirname(os.path.abspath(__file__))
STATIC_DIR = os.path.join(BASE_DIR, "static")
DB_PATH = os.path.join(BASE_DIR, "db", "tags.json")

# Servir frontend Lovable
app.mount("/static", StaticFiles(directory=STATIC_DIR), name="static")

# Página inicial carrega o index.html do seu Lovable
@app.get("/")
def root():
    return FileResponse(os.path.join(STATIC_DIR, "index.html"))

def load_db():
    if not os.path.isfile(DB_PATH):
        with open(DB_PATH, "w") as f:
            json.dump([], f)
    with open(DB_PATH, "r") as f:
        return json.load(f)

def save_db(data):
    with open(DB_PATH, "w") as f:
        json.dump(data, f, indent=2)

def analyze_tags(html):
    soup = BeautifulSoup(html, "html.parser")
    scripts = soup.find_all('script')
    tags_info = []
    seen_srcs = set()
    seen_inline = set()
    duplicates = 0
    for s in scripts:
        src = s.get('src')
        code = s.string
        if src:
            is_dup = src in seen_srcs
            seen_srcs.add(src)
        else:
            code_str = (code or '').strip()
            is_dup = code_str in seen_inline
            seen_inline.add(code_str)
        tags_info.append({
            "src": src or "(inline)",
            "inline_length": len(code or "") if not src else None,
            "is_duplicate": is_dup
        })
        if is_dup:
            duplicates += 1

    order_ok = all((tags_info[i]["src"] and tags_info[i+1]["src"]) or (not tags_info[i]["src"]) 
                   for i in range(len(tags_info)-1))

    score = 100
    problems = []
    if duplicates > 0:
        score -= 20
        problems.append(f"{duplicates} tags duplicadas detectadas.")
    if not order_ok:
        score -= 10
        problems.append("Ordem recomendada dos scripts não respeitada.")
    if len(scripts) > 15:
        score -= 5
        problems.append("Muitas tags (pode impactar performance).")
    if score < 0: score = 0

    return {
        "total_tags": len(scripts),
        "tags_info": tags_info,
        "score": score,
        "problems": problems,
        "timestamp": datetime.now().strftime("%Y-%m-%d %H:%M:%S")
    }

# Endpoint para análise das tags (chamado pelo frontend Lovable)
@app.post("/analyze")
async def analyze(request: Request):
    data = await request.json()
    url = data.get("url")
    try:
        r = requests.get(url, timeout=10)
        r.raise_for_status()
        result = analyze_tags(r.text)
        result["url"] = url
        history = load_db()
        history.append(result)
        save_db(history)
        return JSONResponse({"status": "ok", "result": result})
    except Exception as e:
        return JSONResponse({"status": "error", "msg": str(e)})

# Endpoint para histórico de análises
@app.get("/history")
def history():
    history = load_db()
    return JSONResponse({"history": history[::-1]})

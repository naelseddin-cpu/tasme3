#!/usr/bin/env python3
"""Drive the Gemini web app (owner's Pro plan, free) in a headless Chrome over a COPY of the owner's Chrome profile.

gem.py look                       -> screenshot + visible text of the start page
gem.py make NAME IMAGE PROMPTFILE -> new chat, attach IMAGE, send PROMPT, wait, save the generated image(s) as
                                     ~/Desktop/Design-Options/10-New-3D/NAME[-n].png
Screens and text go to the scratch dir g/. Never prints keys or e-mails.
"""
import base64
import os
import re
import sys
import time
from pathlib import Path

from selenium import webdriver
from selenium.webdriver.common.by import By
from selenium.webdriver.common.keys import Keys

SCR = Path(__file__).resolve().parent / "g"
SCR.mkdir(exist_ok=True)
PROFILE = Path.home() / "snap/firefox/common/.mozilla/firefox/tasme3-gemini-copy"  # a COPY of the owner's Firefox profile
DEST = Path.home() / "tasme3/quran-research/design/raw"
URL = os.environ.get("GEM_URL", "https://gemini.google.com/u/2/app")


def driver():
    from selenium.webdriver.firefox.service import Service

    fo = webdriver.FirefoxOptions()
    fo.add_argument("-headless")
    fo.add_argument("-profile")
    fo.add_argument(str(PROFILE))
    fo.add_argument("--width=1600")
    fo.add_argument("--height=1100")
    return webdriver.Firefox(options=fo, service=Service("/snap/bin/geckodriver"))


def shot(d, name):
    d.save_screenshot(str(SCR / f"{name}.png"))
    t = d.find_element(By.TAG_NAME, "body").text
    t = re.sub(r"[\w.+-]+@[\w-]+\.[\w.]+", "<email>", t)
    (SCR / f"{name}.txt").write_text(t)
    print(f"== {name}:", t[:700].replace("\n", " | "))


def look():
    d = driver()
    try:
        d.get(URL)
        time.sleep(12)
        shot(d, "start")
    finally:
        d.quit()


def make(name, image, promptfile):
    prompt = Path(promptfile).read_text().strip()
    d = driver()
    try:
        d.get(URL)
        time.sleep(12)
        box = [e for e in d.find_elements(By.CSS_SELECTOR, "rich-textarea div[contenteditable=true], div[contenteditable=true]") if e.is_displayed()]
        if not box:
            shot(d, f"{name}-nobox")
            print("FAILED: no prompt box")
            return
        box[-1].click()
        # attach the reference image the way Ctrl+V does: a paste event carrying the file («-» = no reference)
        if str(image) == "-":
            image = None
        b64 = base64.b64encode(Path(image).read_bytes()).decode() if image else ""
        mime = "image/png" if str(image).endswith(".png") else "image/jpeg"
        if image:
          d.execute_script(
            """const [el, b64, mime, fname] = arguments;
               const bin = atob(b64); const u = new Uint8Array(bin.length);
               for (let i = 0; i < bin.length; i++) u[i] = bin.charCodeAt(i);
               const dt = new DataTransfer(); dt.items.add(new File([u], fname, {type: mime}));
               el.dispatchEvent(new ClipboardEvent('paste', {clipboardData: dt, bubbles: true, cancelable: true}));""",
            box[-1], b64, mime, Path(image).name,
        )
        time.sleep(8)
        shot(d, f"{name}-attached")
        d.execute_script(
            "arguments[0].focus(); document.execCommand('insertText', false, arguments[1]);", box[-1], prompt
        )
        time.sleep(2)
        box[-1].send_keys(Keys.ENTER)
        shot(d, f"{name}-sent")
        imgs = []
        for _ in range(60):  # up to 5 minutes
            time.sleep(5)
            imgs = [
                i
                for i in d.find_elements(By.CSS_SELECTOR, "model-response img, .response-container img, generated-image img")
                if (i.get_attribute("naturalWidth") or "0").isdigit() and int(i.get_attribute("naturalWidth") or 0) > 400
            ]
            if imgs:
                time.sleep(8)
                break
        shot(d, f"{name}-done")
        if not imgs:
            print("FAILED: no image in the answer")
            return
        DEST.mkdir(parents=True, exist_ok=True)
        for n, img in enumerate(imgs, 1):
            data = d.execute_async_script(
                """const [img, done] = arguments; const c = document.createElement('canvas');
                   c.width = img.naturalWidth; c.height = img.naturalHeight;
                   try { c.getContext('2d').drawImage(img, 0, 0); done(c.toDataURL('image/png')); }
                   catch (e) { fetch(img.src).then(r => r.blob()).then(b => { const f = new FileReader();
                     f.onload = () => done(f.result); f.readAsDataURL(b); }).catch(x => done('ERR ' + x)); }""",
                img,
            )
            if not data.startswith("data:"):
                print("FAILED to read image", n, data[:120])
                continue
            out = DEST / (f"{name}.png" if len(imgs) == 1 else f"{name}-{n}.png")
            out.write_bytes(base64.b64decode(data.split(",", 1)[1]))
            print("OK", out)
    finally:
        d.quit()


if __name__ == "__main__":
    if sys.argv[1] == "look":
        look()
    else:
        make(*sys.argv[2:5])

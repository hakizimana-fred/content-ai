"""Validate a font file and draw a preview. stdin {"file","out","text"} -> stdout {"family","style"}; exits non-zero if the file is not a usable font."""
import json, sys
from PIL import Image, ImageDraw, ImageFont

def main():
    j = json.loads(sys.stdin.read()); f = ImageFont.truetype(j["file"], 64)
    fam, style = f.getname()
    # a usable font must have real glyphs for basic Latin text
    for ch in "Aa1":
        if f.getmask(ch).getbbox() is None: sys.exit("font has no glyphs for basic Latin text")
    img = Image.new("RGB", (900, 220), (18, 18, 28)); d = ImageDraw.Draw(img)
    d.text((24, 22), j.get("text") or "Your morning deserves better.", font=ImageFont.truetype(j["file"], 54), fill=(255, 255, 255))
    d.text((24, 118), "ABCDEFG abcdefg 0123456789", font=ImageFont.truetype(j["file"], 40), fill=(124, 92, 255))
    img.save(j["out"]); print(json.dumps(dict(family=fam, style=style)))

if __name__ == "__main__":
    main()

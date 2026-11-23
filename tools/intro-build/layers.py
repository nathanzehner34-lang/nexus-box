import numpy as np, cv2
from PIL import Image
src = np.asarray(Image.open('/mnt/user-data/uploads/ddaee8bc-image.png').convert('RGB')).astype(np.float32)/255.
H, W = src.shape[:2]
yy, xx = np.mgrid[0:H, 0:W].astype(np.float32)
lum = src.max(axis=2)
def ss(a, b, x): t = np.clip((x-a)/(b-a), 0, 1); return t*t*(3-2*t)
def blur(m, k): return cv2.GaussianBlur(m, (0, 0), k)
# ---- geometry (in source pixels) ----
cx, cy = 834., 293.
# the big circle around the emblem
circ = np.sqrt(((xx-cx)/303.)**2 + ((yy-cy)/254.)**2)
# the tilted orbital ellipse
ang = np.deg2rad(-10.8); ex, ey = 850., 288.
u = (xx-ex)*np.cos(ang) + (yy-ey)*np.sin(ang); v = -(xx-ex)*np.sin(ang) + (yy-ey)*np.cos(ang)
ell = np.sqrt((u/548.)**2 + (v/104.)**2)
# ---- emblem: the N and everything inside the circle (the core, beam and inner rings) ----
inside = 1 - ss(.86, .93, circ)
npoly = np.zeros((H, W), np.float32)
cv2.fillPoly(npoly, [np.array([[620,126],[1062,126],[1062,486],[620,486]], np.int32)], 1.)
emb = np.maximum(inside, blur(npoly, 3))
# ---- rings: the orbit band and the circle's rim, keyed by brightness so the space behind stays in the backdrop ----
ringBand = np.maximum(1 - ss(.10, .22, np.abs(ell - .97)), 1 - ss(.05, .12, np.abs(circ - 1.0)))
ringBand *= 1 - ss(.0, .3, ((yy-470)/60.).clip(0))   # stop above the planet's limb
rings = ringBand * ss(.22, .55, lum) * (1 - emb)
# ---- the lettering ----
word = np.zeros((H, W), np.float32)
cv2.fillPoly(word, [np.array([[300,548],[1384,548],[1384,700],[300,700]], np.int32)], 1.)
word = blur(word, 4) * ss(.30, .62, lum)
# ---- backdrop: the structure removed (inpainted) and dimmed, so the pieces can arrive one by one ----
wordRect = blur(np.pad(np.ones((160,1100),np.float32),0) if False else cv2.rectangle(np.zeros((H,W),np.float32),(296,544),(1388,704),1.,-1), 5)
hole = np.clip(np.maximum.reduce([emb, ringBand, wordRect]), 0, 1)
hole8 = (cv2.dilate((hole > .15).astype(np.uint8), np.ones((9, 9), np.uint8)) * 255)
s8 = (src*255).astype(np.uint8)
small = cv2.resize(s8, (W//2, H//2)); hs = cv2.resize(hole8, (W//2, H//2))
# where the emblem, rings and lettering will arrive, the backdrop holds only a deep, soft glow of them
fill = cv2.GaussianBlur(s8, (0, 0), 34).astype(np.float32)/255.
fill = np.maximum(fill, cv2.GaussianBlur(cv2.inpaint(small, hs, 9, cv2.INPAINT_TELEA), (0, 0), 8).astype(np.float32)/255. if False else fill)
hm = np.clip(blur(hole8.astype(np.float32)/255., 24)*1.25, 0, 1)[..., None]
bg = src*(1-hm) + fill*hm*.62
OUT = (1280, 720)
def save_rgba(rgb, a, name):
    im = np.dstack([rgb, a[..., None]]).clip(0, 1)
    Image.fromarray((im*255).astype(np.uint8), 'RGBA').resize(OUT, Image.LANCZOS).save(name, 'WEBP', quality=86, method=6)
Image.fromarray((bg.clip(0,1)*255).astype(np.uint8)).resize(OUT, Image.LANCZOS).save('back.jpg', quality=86)
Image.fromarray((src*255).astype(np.uint8)).resize(OUT, Image.LANCZOS).save('final.jpg', quality=88)
save_rgba(src, emb, 'emblem.webp'); save_rgba(src, rings, 'rings.webp'); save_rgba(src, word, 'word.webp')
# previews
prev = Image.fromarray((bg.clip(0,1)*255).astype(np.uint8)); prev.resize((836,470)).save('prev_back.png')
for n, a in [('emb', emb), ('rings', rings), ('word', word)]:
    Image.fromarray((src*a[...,None]*255).astype(np.uint8)).resize((836,470)).save('prev_'+n+'.png')

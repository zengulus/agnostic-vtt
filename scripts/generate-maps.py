"""Generate original, portable SVG sample maps; no external image dependencies."""
from pathlib import Path
import random, math

random.seed(47)
out = Path(__file__).resolve().parents[1] / 'public' / 'assets'
parts = ['''<svg xmlns="http://www.w3.org/2000/svg" width="1600" height="1200" viewBox="0 0 1600 1200">
<defs>
<radialGradient id="ground"><stop stop-color="#698263"/><stop offset=".68" stop-color="#425d43"/><stop offset="1" stop-color="#172b25"/></radialGradient>
<linearGradient id="water" x1="0" y1="0" x2="1" y2="1"><stop stop-color="#356863"/><stop offset=".5" stop-color="#508783"/><stop offset="1" stop-color="#214746"/></linearGradient>
<radialGradient id="tree"><stop stop-color="#748653"/><stop offset=".55" stop-color="#4b6744"/><stop offset="1" stop-color="#2b4936"/></radialGradient>
<radialGradient id="moss"><stop stop-color="#819365"/><stop offset="1" stop-color="#596d4f"/></radialGradient>
<filter id="noise"><feTurbulence type="fractalNoise" baseFrequency=".065" numOctaves="3" stitchTiles="stitch"/><feColorMatrix type="saturate" values="0"/></filter>
<filter id="shadow"><feDropShadow dx="8" dy="13" stdDeviation="7" flood-color="#0c2119" flood-opacity=".6"/></filter>
<pattern id="ripples" width="90" height="62" patternUnits="userSpaceOnUse"><path d="M8 20q18-9 36 0m-4 24q18-9 36 0" fill="none" stroke="#a4c4aa" stroke-opacity=".16" stroke-width="2"/></pattern>
</defs>
<path fill="url(#ground)" d="M0 0h1600v1200H0z"/>
<path d="M478-50C739 105 555 193 796 293S1039 442 871 580S1003 727 999 876 850 1046 1093 1280" fill="none" stroke="#1b3930" stroke-width="345"/>
<path d="M478-50C739 105 555 193 796 293S1039 442 871 580S1003 727 999 876 850 1046 1093 1280" fill="none" stroke="url(#water)" stroke-width="278"/>
<path d="M478-50C739 105 555 193 796 293S1039 442 871 580S1003 727 999 876 850 1046 1093 1280" fill="none" stroke="url(#ripples)" stroke-width="230"/>
<path d="M274 360 421 240 622 291 717 432 808 597 719 786 551 906 337 819 254 614Z" fill="#253c30" filter="url(#shadow)"/>
<path d="m281 342 139-112 184 43 98 159 78 151-78 167-161 126-204-78-80-199Z" fill="url(#moss)" stroke="#a2a080" stroke-width="7"/>
<path d="m938 297 150-77 195 125 47 188-143 157-148-18-103-118Z" fill="#253e31" filter="url(#shadow)"/>
<path d="m942 280 144-73 189 120 39 190-133 150-141-20-97-115Z" fill="#71846a" stroke="#a09f80" stroke-width="6"/>
<path d="m260 584 177-113 158 35 91 152-114 113-175 20" fill="#839477" opacity=".5"/>
<path d="M-10 750 213 670 324 582 480 578 650 679 748 901 831 1240" fill="none" stroke="#5e6b4c" stroke-width="98"/>
<path d="M-10 750 213 670 324 582 480 578 650 679 748 901 831 1240" fill="none" stroke="#989478" stroke-width="62"/>
<path d="m731 545 201-97" stroke="#283c30" stroke-width="100"/>
<path d="m719 534 201-97" stroke="#b4a57c" stroke-width="70"/>
''']
# A weathered crossing built from separate timber planks.
for i in range(16):
    x, y = 725+i*12, 532-i*5.85
    parts.append(f'<path d="m{x-17:.1f} {y-34:.1f} 31 63" stroke="#{random.choice(["9b8864","a79770","877c58"])}" stroke-width="10"/>')
parts.append('<path d="m701 503 201-97m-173 158 201-97" fill="none" stroke="#564f35" stroke-width="5"/>')
# Broken stonework of an ancient grove.
for cx, cy, radius, n in [(1054,440,106,18),(493,441,116,22)]:
    parts.append(f'<circle cx="{cx}" cy="{cy}" r="{radius-13}" fill="#4f6450" stroke="#a9ad88" stroke-width="3" opacity=".65"/>')
    for j in range(n):
        if random.random() < .16: continue
        a = 2*math.pi*j/n
        x,y=cx+math.cos(a)*radius,cy+math.sin(a)*radius
        parts.append(f'<rect x="{x-17:.1f}" y="{y-10:.1f}" width="34" height="21" rx="3" fill="#9f9f85" stroke="#576b53" stroke-width="2" transform="rotate({a*180/math.pi+90:.1f} {x:.1f} {y:.1f})"/>')
    parts.append(f'<path d="m{cx} {cy-42} 33 42-33 42-33-42Z" fill="none" stroke="#c0bd93" stroke-width="2" opacity=".6"/>')
parts.append('<circle cx="1054" cy="440" r="25" fill="#466763"/><circle cx="1054" cy="440" r="11" fill="#abd0b1" opacity=".8"/><circle cx="1054" cy="440" r="53" fill="#b6d3a0" opacity=".07"/>')
# Stones, flowers, moss, and forest vegetation around the playable clearing.
for i in range(260):
    x,y=random.randint(20,1580),random.randint(20,1180)
    if 370<x<1300 and 240<y<940: continue
    r=random.randint(7,26)
    parts.append(f'<ellipse cx="{x}" cy="{y}" rx="{r}" ry="{r*.62:.1f}" fill="{random.choice(["#52654b","#79816a","#657d51"])}" opacity=".7"/>')
    parts.append(f'<path d="m{x-r*.5:.1f} {y-2} {r*.6:.1f} {-r*.3:.1f}" stroke="#b3b695" stroke-width="1.5" opacity=".35"/>')
for i in range(120):
    x,y=random.randint(-50,1650),random.randint(-60,1260)
    if 170<x<1420 and 160<y<1020: continue
    r=random.randint(30,80)
    parts.append(f'<g filter="url(#shadow)"><circle cx="{x}" cy="{y}" r="{r}" fill="#233f30"/>')
    for j in range(6):
        a=j*math.pi/3
        xx,yy=x+math.cos(a)*r*.4,y+math.sin(a)*r*.4
        parts.append(f'<circle cx="{xx:.1f}" cy="{yy:.1f}" r="{r*.64:.1f}" fill="url(#tree)"/>')
    parts.append(f'<circle cx="{x}" cy="{y-6}" r="{r*.48:.1f}" fill="#718357" opacity=".4"/></g>')
for i in range(100):
    x,y=random.randint(250,740),random.randint(290,815)
    if 370<x<615 and 315<y<555: continue
    parts.append(f'<path d="m{x} {y} 3-9 3 8 4-6" stroke="{random.choice(["#9ca779","#6a8558","#abb58d"])}" stroke-width="2" fill="none" opacity=".55"/>')
for x,y in [(343,308),(674,435),(416,812),(1225,353),(1105,615)]:
    parts.append(f'<g filter="url(#shadow)"><ellipse cx="{x}" cy="{y+7}" rx="29" ry="19" fill="#384e3d"/><path d="m{x-24} {y-10} 11-26 25 4 13 21-21 16Z" fill="#9a9e87" stroke="#596d54" stroke-width="3"/><path d="m{x-10} {y-29} 9 29 20-10" fill="none" stroke="#c1c0a3" stroke-width="2" opacity=".6"/></g>')
parts.append('<path fill="#919875" filter="url(#noise)" opacity=".075" d="M0 0h1600v1200H0z"/><rect x="8" y="8" width="1584" height="1184" fill="none" stroke="#c0b988" stroke-opacity=".18" stroke-width="2"/></svg>')
out.joinpath('hollow.svg').write_text(''.join(parts))
# A second scene with a different layout and palette.
parts=['''<svg xmlns="http://www.w3.org/2000/svg" width="1600" height="1200"><defs><radialGradient id="g"><stop stop-color="#5b7372"/><stop offset="1" stop-color="#1e333b"/></radialGradient><radialGradient id="p"><stop stop-color="#a3b5a1"/><stop offset="1" stop-color="#657a72"/></radialGradient><filter id="s"><feDropShadow dx="8" dy="14" stdDeviation="15" flood-color="#122831"/></filter><pattern id="t" width="80" height="80" patternUnits="userSpaceOnUse"><path d="M0 0h80v80H0z" fill="#667b73" stroke="#9eaa921c" stroke-width="2"/></pattern></defs><path d="M0 0h1600v1200H0z" fill="url(#g)"/><path d="m150 600 270-350 380-100 380 100 270 350-270 350-380 100-380-100Z" fill="url(#p)" stroke="#aab49a" stroke-width="9" filter="url(#s)"/><path d="m180 600 260-330 360-95 360 95 260 330-260 330-360 95-360-95Z" fill="url(#t)"/><circle cx="800" cy="600" r="350" stroke="#adba9c" stroke-width="9" fill="none"/><circle cx="800" cy="600" r="275" stroke="#a3b798" stroke-width="3" fill="#526d65"/><circle cx="800" cy="600" r="180" stroke="#b6c3a2" stroke-width="6" fill="#3c6466"/><circle cx="800" cy="600" r="138" stroke="#9bc5af" stroke-width="1" fill="#477c7c"/><circle cx="800" cy="600" r="82" fill="#8fbaa7" opacity=".25"/>''']
for i in range(12):
    a=i*math.pi/6
    x,y=800+math.cos(a)*315,600+math.sin(a)*315
    parts.append(f'<g filter="url(#s)"><circle cx="{x:.1f}" cy="{y:.1f}" r="31" fill="#b1b7a0" stroke="#60736b" stroke-width="5"/><circle cx="{x:.1f}" cy="{y:.1f}" r="19" fill="#8b9c87"/></g>')
for i in range(8):
    a=i*math.pi/4
    x,y=800+math.cos(a)*108,600+math.sin(a)*108
    parts.append(f'<path d="m{x:.1f} {y-11:.1f} 8 11-8 11-8-11Z" stroke="#cee1b8" stroke-width="2" fill="none" opacity=".8"/>')
parts.append('<path d="M600 1200V920h130v280M875 0v285h130V0" fill="#859581" stroke="#aeb698" stroke-width="5"/><path d="m800 514 63 86-63 86-63-86Z" fill="none" stroke="#d3dabb" stroke-width="4"/><circle cx="800" cy="600" r="22" fill="#c9e8c5"/><circle cx="800" cy="600" r="56" fill="#bddbb0" opacity=".15"/><rect x="8" y="8" width="1584" height="1184" fill="none" stroke="#aebca0" stroke-width="2" opacity=".2"/></svg>')
out.joinpath('sanctuary.svg').write_text(''.join(parts))
